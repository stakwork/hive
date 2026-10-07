"use client";

import React, { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface DailyRecapData {
  recap: string | null;
  generatedAt: string | null;
}

interface DailyRecapCardProps {
  /** When true, renders an X button that hides the card for the session. */
  dismissible?: boolean;
  /** When true, renders a "My Activity →" link to /profile. */
  showActivityLink?: boolean;
  /** Extra classes merged onto the card's root element. */
  className?: string;
}

const SESSION_KEY = "hive:daily-recap-dismissed";

/**
 * Compact recap card.
 * Fetches GET /api/user/daily-recap on mount.
 * Returns null while loading or when no completed recap exists.
 */
export function DailyRecapCard({ dismissible, showActivityLink, className }: DailyRecapCardProps = {}) {
  const [data, setData] = useState<DailyRecapData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const reduceMotion = useReducedMotion();

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
      .then((json: DailyRecapData | null) => {
        if (json?.recap) setData(json);
      })
      .catch(() => {
        /* silent — card simply doesn't render */
      });
  }, []);

  const showCard = !dismissed && !!data?.recap;

  const relativeTime = data?.generatedAt ? formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true }) : null;

  function handleDismiss() {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Storage unavailable — dismiss in-memory only.
    }
    setDismissed(true);
  }

  const transition = reduceMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" as const };

  return (
    <AnimatePresence initial={false}>
      {showCard && data && (
        <motion.div
          key="daily-recap"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={transition}
          className="overflow-hidden"
        >
          <div
            className={cn("rounded border bg-muted/40 px-3 py-2.5 text-sm space-y-1", className)}
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
                {relativeTime && <p className="text-xs text-muted-foreground">{relativeTime}</p>}
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
