"use client";

/**
 * Compact "My Activity" intro card seeded into the org canvas chat on
 * fresh entry. Replaces the old `AttentionList` ("Top 3 for you") with a
 * richer, navigable snapshot of the user's recent work.
 *
 * Driven by the `/api/profile/activity` feed (same data as `/profile`).
 * Supports live search (debounced, 300 ms) and category chips; both
 * trigger a re-fetch with `limit=5`. Items open in a new tab to preserve
 * canvas state (same pattern as `AttentionList`).
 *
 * Visual language is aligned with `AttentionList` / `ProposalCard`:
 * rounded border, muted card background, uppercase tracking-wide header.
 */

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MessageSquare,
  FileText,
  CheckSquare,
  Flag,
  Search,
  X,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { ActivityItem } from "@/app/api/profile/activity/route";

// ── Icon map (mirrors ActivityFeed.tsx) ──────────────────────────────────────

const KIND_ICONS: Record<ActivityItem["kind"], React.ReactNode> = {
  conversation: <MessageSquare className="h-3.5 w-3.5 shrink-0 text-purple-400" />,
  plan: <FileText className="h-3.5 w-3.5 shrink-0 text-blue-400" />,
  task: <CheckSquare className="h-3.5 w-3.5 shrink-0 text-green-500/80" />,
  milestone: <Flag className="h-3.5 w-3.5 shrink-0 text-orange-400" />,
};

// ── Category chip labels (mirrors ActivityFeed.tsx) ───────────────────────────

type Category = "" | "task" | "plan" | "chat" | "milestone";

const CATEGORY_LABELS: Record<Category, string> = {
  "": "All",
  task: "Tasks",
  plan: "Plans",
  chat: "Chats",
  milestone: "Milestones",
};

const CATEGORIES: Category[] = ["", "task", "plan", "chat", "milestone"];

// ── Props ─────────────────────────────────────────────────────────────────────

interface MyActivityPanelProps {
  initialItems: ActivityItem[];
  onDismiss?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MyActivityPanel({ initialItems, onDismiss }: MyActivityPanelProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [items, setItems] = useState<ActivityItem[]>(initialItems);
  const [loading, setLoading] = useState(false);
  // Skip the very first fetch — `initialItems` already provides the data.
  const isFirstFetch = useRef(true);

  // ── 300 ms debounce on the search input ──────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // ── Re-fetch on query / category change ──────────────────────────────────
  useEffect(() => {
    // Skip the initial mount fetch — we already have `initialItems`.
    if (isFirstFetch.current) {
      isFirstFetch.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);

    const url = new URL("/api/profile/activity", window.location.origin);
    url.searchParams.set("limit", "5");
    if (debouncedQuery) url.searchParams.set("q", debouncedQuery);
    if (category) url.searchParams.set("category", category);

    fetch(url.toString())
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then(({ items: fresh }: { items: ActivityItem[] }) => {
        if (cancelled) return;
        setItems(Array.isArray(fresh) ? fresh : []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `initialItems` intentionally excluded — this effect fires on
    // filter changes, not on parent re-renders with updated props.
  }, [debouncedQuery, category]);

  return (
    <div className="rounded-lg border bg-card text-card-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          My Activity
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            title="Hide for this session"
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mx-3 mb-2">
        <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          className="h-7 pl-7 pr-7 text-xs"
          placeholder="Search activity…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Category chips */}
      <div className="flex gap-1.5 flex-wrap px-3 pb-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors border",
              category === cat
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary text-secondary-foreground border-transparent hover:bg-secondary/80",
            )}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Items list */}
      {loading ? (
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground">
          {query || category ? "No matching activity" : "No recent activity"}
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() =>
                  window.open(item.link, "_blank", "noopener,noreferrer")
                }
                className="group flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
              >
                <div className="mt-0.5 flex-shrink-0">
                  {KIND_ICONS[item.kind]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className="font-medium">{CATEGORY_LABELS[item.category as Category] ?? item.category}</span>
                    {item.workspaceName && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate">{item.workspaceName}</span>
                      </>
                    )}
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 break-words text-sm font-medium leading-snug",
                      item.completed && "line-through text-muted-foreground",
                    )}
                  >
                    {item.title}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(item.timestamp), {
                      addSuffix: true,
                    })}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Footer */}
      <div className="border-t border-border/60 px-3 py-1.5">
        <Link
          href="/profile"
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          View all →
        </Link>
      </div>
    </div>
  );
}
