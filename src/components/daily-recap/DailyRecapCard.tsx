"use client";

import React, { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Sparkles } from "lucide-react";

interface DailyRecapData {
  recap: string | null;
  generatedAt: string | null;
}

/**
 * Compact daily-recap card.
 * Fetches GET /api/user/daily-recap on mount.
 * Returns null while loading or when no completed recap exists.
 */
export function DailyRecapCard() {
  const [data, setData] = useState<DailyRecapData | null>(null);

  useEffect(() => {
    fetch("/api/user/daily-recap")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: DailyRecapData | null) => {
        if (json?.recap) setData(json);
      })
      .catch(() => {/* silent — card simply doesn't render */});
  }, []);

  if (!data?.recap) return null;

  const relativeTime = data.generatedAt
    ? formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true })
    : null;

  return (
    <div
      className="rounded border bg-muted/40 px-3 py-2.5 text-sm space-y-1"
      data-testid="daily-recap-card"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        <Sparkles className="h-3 w-3" />
        Daily Recap
      </div>
      <p className="text-foreground/90 leading-relaxed">{data.recap}</p>
      {relativeTime && (
        <p className="text-xs text-muted-foreground">Generated {relativeTime}</p>
      )}
    </div>
  );
}
