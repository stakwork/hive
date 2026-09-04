"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlPanelItem, ControlPanelResponse } from "@/types/control-panel";

const POLL_MS = 30_000;
/** Chats per page; "Show N more" asks for another page. */
export const CONTROL_PANEL_PAGE = 30;

/**
 * The user's control panel for this org — fetched when enabled, polled
 * every 30 s and refetched on window focus. The page size only ever
 * grows; every refetch asks for everything shown so far. While disabled
 * (the canvas is showing) nothing is fetched and the last list is kept,
 * so coming back shows it at once.
 */
export function useControlPanelItems(
  githubLogin: string,
  enabled: boolean,
): {
  items: ControlPanelItem[];
  /** Chats the user has in this org beyond the ones listed. */
  remaining: number;
  loading: boolean;
  refetch: () => Promise<void>;
  showMore: () => void;
} {
  const [items, setItems] = useState<ControlPanelItem[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const inFlightRef = useRef(false);
  const limitRef = useRef(CONTROL_PANEL_PAGE);

  const refetch = useCallback(async () => {
    if (!githubLogin || !enabled || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(`/api/orgs/${githubLogin}/control-panel?limit=${limitRef.current}`);
      if (!res.ok) return;
      const data = (await res.json()) as ControlPanelResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setRemaining(Math.max(0, (data.chats?.total ?? 0) - (data.chats?.shown ?? 0)));
    } catch {
      // Keep the last good list; the next poll retries.
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [githubLogin, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refetch();
    const id = setInterval(() => void refetch(), POLL_MS);
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refetch]);

  const showMore = useCallback(() => {
    limitRef.current += CONTROL_PANEL_PAGE;
    void refetch();
  }, [refetch]);

  return { items, remaining, loading, refetch, showMore };
}
