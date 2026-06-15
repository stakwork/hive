/**
 * useTimelineRange
 *
 * Shared hook for the Bifrost gateway SPA that persists the timeline
 * period selection in the URL query string (`?range=7d`).
 *
 * Because the gateway SPA uses wouter for client-side routing, each
 * tab route unmounts and remounts when navigating. Storing the range
 * in component-local state therefore resets it to "24h" on every tab
 * switch. Encoding it in the URL query string means every tab reads
 * from the same source of truth automatically.
 *
 * Usage (drop-in replacement for `useState("24h")`):
 *
 *   const [range, setRange] = useTimelineRange();
 *
 * `setRange` updates `?range=` in-place via wouter's navigate with
 * `replace: true`, preserving the active tab path.
 */
import { useSearch, useLocation } from "wouter";

export const VALID_RANGES = ["1h", "24h", "7d", "30d"] as const;
export type TimelineRange = (typeof VALID_RANGES)[number];

export function useTimelineRange(): [TimelineRange, (r: TimelineRange) => void] {
  const search = useSearch();
  const [location, navigate] = useLocation();

  const params = new URLSearchParams(search);
  const raw = params.get("range") ?? "";
  const range: TimelineRange = (VALID_RANGES as readonly string[]).includes(raw)
    ? (raw as TimelineRange)
    : "24h";

  const setRange = (next: TimelineRange) => {
    const p = new URLSearchParams(search);
    p.set("range", next);
    // Replace in-place — keep the current tab path, only update the query string.
    navigate(`${location}?${p.toString()}`, { replace: true });
  };

  return [range, setRange];
}
