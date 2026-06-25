"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquare, FileText, CheckSquare, Flag, ArrowUpRight, Loader2, Search, X, Building2 } from "lucide-react";
import { formatRelativeOrDateInTz } from "@/lib/date-utils";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { getUserChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { ActivityItem } from "@/app/api/profile/activity/route";

// ── Icons ─────────────────────────────────────────────────────────────────────

const KIND_ICONS: Record<ActivityItem["kind"], React.ReactNode> = {
  conversation: <MessageSquare className="h-4 w-4 shrink-0 text-purple-400" />,
  plan: <FileText className="h-4 w-4 shrink-0 text-blue-400" />,
  task: <CheckSquare className="h-4 w-4 shrink-0 text-green-500/80" />,
  milestone: <Flag className="h-4 w-4 shrink-0 text-orange-400" />,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="h-4 w-4 rounded" />
      <Skeleton className="h-4 flex-1 rounded" />
      <Skeleton className="h-5 w-20 rounded-full" />
      <Skeleton className="h-4 w-14 rounded" />
    </div>
  );
}

type Category = "task" | "plan" | "chat" | "milestone" | "";

const CATEGORY_LABELS: Record<string, string> = {
  "": "All",
  task: "Tasks",
  plan: "Plans",
  chat: "Chats",
  milestone: "Milestones",
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface ActivityFeedProps {
  userId: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ActivityFeed({ userId }: ActivityFeedProps) {
  const { timezone } = useUserTimezone();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState<Category>("");

  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── Debounce query ──────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // ── Fetch helper ────────────────────────────────────────────────────────────
  const fetchPage = useCallback(
    async (cursor?: string): Promise<{ items: ActivityItem[]; nextCursor: string | null }> => {
      const url = new URL("/api/profile/activity", window.location.origin);
      url.searchParams.set("limit", "20");
      if (cursor) url.searchParams.set("cursor", cursor);
      if (debouncedQuery) url.searchParams.set("q", debouncedQuery);
      if (category) url.searchParams.set("category", category);

      const res = await fetch(url.toString());
      if (!res.ok) return { items: [], nextCursor: null };
      return res.json();
    },
    [debouncedQuery, category]
  );

  // ── Initial / filter load ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems([]);
    setNextCursor(null);
    setExhausted(false);

    fetchPage().then((data) => {
      if (cancelled) return;
      setItems(data.items);
      setNextCursor(data.nextCursor);
      if (!data.nextCursor) setExhausted(true);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setItems([]);
      setLoading(false);
      setExhausted(true);
    });

    return () => { cancelled = true; };
  }, [fetchPage]);

  // ── Infinite scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore && !exhausted && nextCursor) {
          setLoadingMore(true);
          fetchPage(nextCursor).then((data) => {
            setItems((prev) => [...prev, ...data.items]);
            setNextCursor(data.nextCursor);
            if (!data.nextCursor) setExhausted(true);
            setLoadingMore(false);
          }).catch(() => setLoadingMore(false));
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchPage, nextCursor, loadingMore, exhausted]);

  // ── Pusher live updates ─────────────────────────────────────────────────────
  const channel = usePusherChannel(getUserChannelName(userId));

  useEffect(() => {
    if (!channel) return undefined;
    const handler = () => {
      fetchPage().then(({ items: fresh }) => {
        setItems((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          const newOnes = fresh.filter((i) => !existingIds.has(i.id));
          return [...newOnes, ...prev];
        });
      }).catch(() => {});
    };
    channel.bind(PUSHER_EVENTS.ACTIVITY_UPDATED, handler);
    return () => { channel.unbind(PUSHER_EVENTS.ACTIVITY_UPDATED, handler); };
  }, [channel, fetchPage]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9 pr-9"
          placeholder="Search activity…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Category chips */}
      <div className="flex gap-2 flex-wrap">
        {(["", "task", "plan", "chat", "milestone"] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors border",
              category === cat
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary text-secondary-foreground border-transparent hover:bg-secondary/80"
            )}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="divide-y divide-border rounded-lg border">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <p className="text-sm">
            {debouncedQuery && category
              ? `No ${CATEGORY_LABELS[category].toLowerCase()} activity matching "${debouncedQuery}".`
              : debouncedQuery
              ? `No activity matching "${debouncedQuery}".`
              : category
              ? `No ${CATEGORY_LABELS[category].toLowerCase()} activity in the last 30 days.`
              : "No activity in the last 30 days."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors group"
            >
              {KIND_ICONS[item.kind]}

              <span
                className={cn(
                  "flex-1 truncate text-sm font-medium",
                  item.completed && item.kind !== "conversation" && "line-through text-muted-foreground"
                )}
              >
                {item.title}
              </span>

              {item.action === "created" && (
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  Created
                </span>
              )}

              {(() => {
                const isOrgFallback = !item.workspaceName && !!item.orgName;
                const label = item.workspaceName || item.orgName;
                return (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    {isOrgFallback && <Building2 data-testid="org-icon" className="h-3 w-3 shrink-0" />}
                    {label}
                  </span>
                );
              })()}

              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatRelativeOrDateInTz(item.timestamp, timezone)}
              </span>

              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-px" />

      {/* Bottom states */}
      {loadingMore && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {exhausted && items.length > 0 && (
        <p className="text-center text-xs text-muted-foreground py-4">
          {"You're all caught up 🎉"}
        </p>
      )}
    </div>
  );
}
