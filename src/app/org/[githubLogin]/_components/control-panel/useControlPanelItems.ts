"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { moveChatToActive, moveChatToArchive } from "@/services/orgs/control-panel-state";
import type { ControlPanelItem, ControlPanelResponse } from "@/types/control-panel";

const POLL_MS = 30_000;
/** Chats per page; "Show N more" asks for another page. */
export const CONTROL_PANEL_PAGE = 30;

/**
 * The user's chat list for this org — polled every 30 s and refetched on
 * window focus. The page size only ever grows; every refetch asks for
 * everything shown so far.
 *
 * Archive rides the same fetch (`archivedItems` on the response). There
 * is no second poll and no `?archived=1`. `remaining` / `showMore` stay
 * wired to active chats only.
 */
export function useControlPanelItems(githubLogin: string): {
  items: ControlPanelItem[];
  archivedItems: ControlPanelItem[];
  /** Chats the user has in this org beyond the ones listed. */
  remaining: number;
  loading: boolean;
  refetch: () => Promise<void>;
  showMore: () => void;
  archiveConversation: (id: string) => Promise<void>;
  restoreConversation: (id: string) => Promise<void>;
  /** Resolves true when the rename persisted. */
  renameConversation: (id: string, title: string) => Promise<boolean>;
} {
  const [items, setItems] = useState<ControlPanelItem[]>([]);
  const [archivedItems, setArchivedItems] = useState<ControlPanelItem[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const inFlightRef = useRef(false);
  const pendingRefetchRef = useRef(false);
  const genRef = useRef(0);
  const limitRef = useRef(CONTROL_PANEL_PAGE);
  const itemsRef = useRef(items);
  const archivedItemsRef = useRef(archivedItems);
  itemsRef.current = items;
  archivedItemsRef.current = archivedItems;

  const refetch = useCallback(async () => {
    if (!githubLogin) return;
    if (inFlightRef.current) {
      pendingRefetchRef.current = true;
      return;
    }
    pendingRefetchRef.current = false;
    const gen = ++genRef.current;
    inFlightRef.current = true;
    try {
      const res = await fetch(`/api/orgs/${githubLogin}/control-panel?limit=${limitRef.current}`);
      if (!res.ok) return;
      const data = (await res.json()) as ControlPanelResponse;
      if (gen !== genRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setArchivedItems(Array.isArray(data.archivedItems) ? data.archivedItems : []);
      setRemaining(Math.max(0, (data.chats?.total ?? 0) - (data.chats?.shown ?? 0)));
    } catch {
      // Keep the last good list; the next poll retries.
    } finally {
      if (gen === genRef.current) inFlightRef.current = false;
      setLoading(false);
      if (gen === genRef.current && pendingRefetchRef.current) {
        pendingRefetchRef.current = false;
        void refetch();
      }
    }
  }, [githubLogin]);

  useEffect(() => {
    void refetch();
    const id = setInterval(() => void refetch(), POLL_MS);
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetch]);

  const showMore = useCallback(() => {
    limitRef.current += CONTROL_PANEL_PAGE;
    void refetch();
  }, [refetch]);

  const postArchive = useCallback(
    async (id: string, archived: boolean) => {
      const prevItems = itemsRef.current;
      const prevArchived = archivedItemsRef.current;
      // Invalidate any in-flight poll so it cannot clobber the optimistic move.
      genRef.current += 1;
      inFlightRef.current = false;
      const moved = archived
        ? moveChatToArchive(prevItems, prevArchived, id, new Date().toISOString())
        : moveChatToActive(prevItems, prevArchived, id);
      setItems(moved.items);
      setArchivedItems(moved.archivedItems);

      try {
        const res = await fetch(`/api/orgs/${githubLogin}/chat/conversations/${id}/archive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        });
        if (!res.ok) throw new Error(archived ? "Failed to archive chat" : "Failed to restore chat");
        await refetch();
      } catch (error) {
        setItems(prevItems);
        setArchivedItems(prevArchived);
        toast.error(archived ? "Failed to archive chat" : "Failed to restore chat", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
    [githubLogin, refetch],
  );

  const archiveConversation = useCallback((id: string) => postArchive(id, true), [postArchive]);
  const restoreConversation = useCallback((id: string) => postArchive(id, false), [postArchive]);

  const renameConversation = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      const prevItems = itemsRef.current;
      const prevArchived = archivedItemsRef.current;
      const apply = (list: ControlPanelItem[]) => list.map((i) => (i.id === id ? { ...i, title } : i));
      // Invalidate any in-flight poll so stale data cannot clobber the new title.
      genRef.current += 1;
      inFlightRef.current = false;
      setItems(apply(prevItems));
      setArchivedItems(apply(prevArchived));
      try {
        const res = await fetch(`/api/orgs/${githubLogin}/chat/conversations/${id}/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error("Failed to rename chat");
        await refetch();
        return true;
      } catch (error) {
        setItems(prevItems);
        setArchivedItems(prevArchived);
        toast.error("Failed to rename chat", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
        return false;
      }
    },
    [githubLogin, refetch],
  );

  return {
    items,
    archivedItems,
    renameConversation,
    remaining,
    loading,
    refetch,
    showMore,
    archiveConversation,
    restoreConversation,
  };
}
