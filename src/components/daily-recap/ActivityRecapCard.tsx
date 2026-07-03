"use client";

import React, { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Sparkles, X } from "lucide-react";
import Link from "next/link";

interface ActivityRecapData {
  recap: string | null;
  generatedAt: string | null;
}

interface ActivityRecapCardProps {
  /** When true, renders an X button that hides the card for the session. */
  dismissible?: boolean;
  /** When true, renders a "My Activity →" link to /profile. */
  showActivityLink?: boolean;
}

const SESSION_KEY = "hive:daily-recap-dismissed";

/**
 * Compact recap card.
 * Fetches GET /api/user/daily-recap on mount.
 * Returns null while loading or when no completed recap exists.
 */
export function ActivityRecapCard({ dismissible, showActivityLink }: ActivityRecapCardProps = {}) {
  const [data, setData] = useState<ActivityRecapData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Check session-dismissed flag on mount (dismissible mode only).
  useEffect(() => {
    if (!dismissible) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") {
        setDismissed(true);
      }
    } catch {
      // Private-mode browsers may throw — fall through and show the card.
    }
  }, [dismissible]);

  useEffect(() => {
    fetch("/api/user/daily-recap")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: ActivityRecapData | null) => {
        if (json?.recap) setData(json);
      })
      .catch(() => {/* silent — card simply doesn't render */});
  }, []);

  if (dismissed || !data?.recap) return null;

  const relativeTime = data.generatedAt
    ? formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true })
    : null;

  function handleDismiss() {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Storage unavailable — dismiss in-memory only.
    }
    setDismissed(true);
  }

  return (
    <div
      className="rounded border bg-muted/40 px-3 py-2.5 text-sm space-y-1"
      data-testid="daily-recap-card"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <Sparkles className="h-3 w-3" />
          Recap
        </div>
        {dismissible && (
          <button
            onClick={handleDismiss}
            aria-label="Dismiss recap"
            className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <p className="text-foreground/90 leading-relaxed">{data.recap}</p>
      {(relativeTime || showActivityLink) && (
        <div className="flex items-center justify-between">
          {relativeTime && (
            <p className="text-xs text-muted-foreground">{relativeTime}</p>
          )}
          {showActivityLink && (
            <Link
              href="/profile"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              My Activity →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
