"use client";

import { useEffect, useState } from "react";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";

const toMs = (stamp: string | number | undefined): number => {
  if (stamp === undefined) return Number.NaN;
  return typeof stamp === "number" ? stamp : Date.parse(stamp);
};

/**
 * Pick the later of two stamps (ISO strings or epoch ms), so a late or
 * replayed event can never move a page back to an older version.
 */
export function laterStamp(current: string | undefined, next: string | number | undefined): string | undefined {
  const nextMs = toMs(next);
  if (Number.isNaN(nextMs)) return current;
  const currentMs = toMs(current);
  if (!Number.isNaN(currentMs) && currentMs >= nextMs) return current;
  return typeof next === "string" ? next : new Date(nextMs).toISOString();
}

/**
 * A stored HTML page's version stamp, kept live: starts at `initial` and
 * advances when the org channel reports that `slug` was rewritten
 * (`CANVAS_UPDATED` / `html-updated`), so an open frame refetches without
 * a reload. Pass a falsy `slug` for pages that are not stored (no subscription).
 */
export function useHtmlPageStamp(
  githubLogin: string,
  slug: string | null | undefined,
  initial?: string,
): string | undefined {
  const [stamp, setStamp] = useState(initial);

  // A newer stamp from the server (a re-derived card) moves forward, never back.
  useEffect(() => {
    setStamp((current) => laterStamp(current, initial));
  }, [initial]);

  const channel = usePusherChannel(slug ? getOrgChannelName(githubLogin) : null);
  useEffect(() => {
    if (!channel || !slug) return;
    const handler = (payload: { action?: string; slug?: string; updatedAt?: string; timestamp?: number }) => {
      if (payload.action !== "html-updated" || payload.slug !== slug) return;
      setStamp((current) => laterStamp(current, payload.updatedAt ?? payload.timestamp));
    };
    channel.bind(PUSHER_EVENTS.CANVAS_UPDATED, handler);
    return () => {
      channel.unbind(PUSHER_EVENTS.CANVAS_UPDATED, handler);
    };
  }, [channel, slug, githubLogin]);

  return stamp;
}
