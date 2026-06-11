"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare, FileText, CheckSquare, ArrowUpRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActivityItem } from "@/app/api/profile/activity/route";

const KIND_ICONS: Record<ActivityItem["kind"], React.ReactNode> = {
  conversation: <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />,
  plan: <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />,
  task: <CheckSquare className="h-4 w-4 shrink-0 text-muted-foreground" />,
};

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

export function ActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/profile/activity")
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data: { items: ActivityItem[] }) => setItems(data.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="divide-y divide-border rounded-lg border">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <p className="text-sm">No activity in the last 30 days.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border rounded-lg border">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.link}
          className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors group"
        >
          {KIND_ICONS[item.kind]}

          <span className="flex-1 truncate text-sm font-medium">{item.title}</span>

          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
            {item.orgName ?? item.workspaceName}
          </span>

          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
          </span>

          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
      ))}
    </div>
  );
}
