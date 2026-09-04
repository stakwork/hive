"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { generateTitle } from "@/lib/ai/conversationHelpers";
import {
  buildArchivedRows,
  buildControlPanelGroups,
  matchesControlPanelQuery,
  resolveControlPanelLists,
  visibleControlPanelItems,
  type ActiveChatSnapshot,
} from "@/services/orgs/control-panel-state";
import type { ControlPanelItem } from "@/types/control-panel";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { openOrgConversation, startNewOrgConversation } from "../../_state/openOrgConversation";
import { isTypingTarget, type ControlPanelListProps } from "./ControlPanelList";
import type { ControlPanelStageProps } from "./ControlPanelStage";
import { useControlPanelItems } from "./useControlPanelItems";
import { focusNodeIdOf, type ControlPanelFocus } from "./types";

function focusFromParams(params: URLSearchParams): ControlPanelFocus {
  const plan = params.get("plan");
  if (plan) return { kind: "plan", id: plan };
  const task = params.get("task");
  if (task) return { kind: "task", id: task };
  return { kind: "chat" };
}

export interface ControlPanelState {
  /** Everything the list column needs. */
  list: ControlPanelListProps;
  /** What the right panel puts on stage in control panel mode (the org page adds `onExit`). */
  stage: Omit<ControlPanelStageProps, "onExit">;
  /** The plan/task on stage as a canvas node id — what "this" means to Jamie — or null for a chat. */
  focusNodeId: string | null;
}

/**
 * The control panel's state — the org page's other view (`?view=control-panel`).
 *
 * Jamie chats as the spine, the plans each chat spawned nested under
 * them, grouped by the day of their newest activity; whichever one the
 * user pulled up on the stage. `OrgCanvasView` owns the conversation
 * lifecycle, renders the list in the left panel and hands `stage` to the
 * right panel — the same `<SidebarChat>` the canvas shows, so switching
 * views never remounts the chat. Only the list, the focus and the
 * keyboard live here. While `enabled` is false (the canvas is showing)
 * nothing is fetched, the store is not watched and no keys are bound.
 */
export function useControlPanel(githubLogin: string, enabled: boolean): ControlPanelState {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const {
    items,
    archivedItems,
    remaining,
    loading,
    refetch,
    showMore,
    archiveConversation,
    restoreConversation,
  } = useControlPanelItems(githubLogin, enabled);

  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<ControlPanelFocus>(() => focusFromParams(searchParams));
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  // Chats start collapsed: the row is the chat, its plans open on demand.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const toggleArchived = useCallback(() => setArchivedExpanded((open) => !open), []);

  // Leaving the control panel puts the chat back on stage, so coming
  // back starts clean (the URL's `?plan=`/`?task=` go with it).
  useEffect(() => {
    if (!enabled) setFocus({ kind: "chat" });
  }, [enabled]);

  // What the list needs to know about the chat on stage — primitives
  // only, so streaming's per-chunk store writes don't re-render the page
  // (Jamie's reply is left out until the turn settles for the same
  // reason), and nothing at all while the canvas is showing.
  const activeChat = useCanvasChatStore(
    useShallow((s): ActiveChatSnapshot | null => {
      if (!enabled) return null;
      const conv = s.activeConversationId ? s.conversations[s.activeConversationId] : undefined;
      if (!conv) return null;
      const last = conv.messages[conv.messages.length - 1];
      return {
        localId: conv.id,
        serverId: conv.serverConversationId,
        lastMessageAt: last ? last.timestamp.toISOString() : null,
        lastReply: !conv.isStreaming && last?.role === "assistant" ? last.content : null,
        hasMessages: conv.messages.length > 0,
        isStreaming: conv.isStreaming,
      };
    }),
  );
  const activeLocalId = activeChat?.localId ?? null;
  const activeServerConversationId = activeChat?.serverId ?? null;
  const activeChatKey = activeChat ? `chat:${activeServerConversationId ?? activeChat.localId}` : null;

  // ── Focus + URL ─────────────────────────────────────────────────────
  // `history.replaceState` (never a router navigation) so the deep-link
  // params update without an RSC round-trip — see CANVAS.md "Deep links".
  const changeFocus = useCallback(
    (next: ControlPanelFocus) => {
      setFocus(next);
      const params = new URLSearchParams(window.location.search);
      params.delete("plan");
      params.delete("task");
      if (next.kind === "plan") params.set("plan", next.id);
      if (next.kind === "task") params.set("task", next.id);
      const qs = params.toString();
      window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}`);
    },
    [pathname],
  );

  // A chat that becomes active while the panel is up goes on stage —
  // that covers New chat and Fork from the bar as well as a row click.
  // Not on the first conversation the page starts (a `?plan=` deep link
  // owns the stage then). A fresh chat gets its server row on its first
  // turn: fetch then, so the stand-in row hands over to the real one.
  const newChatStartedAtRef = useRef(new Date().toISOString());
  const prevChatRef = useRef<{ local: string | null; server: string | null }>({ local: null, server: null });
  useEffect(() => {
    const prev = prevChatRef.current;
    prevChatRef.current = { local: activeLocalId, server: activeServerConversationId };
    if (!enabled || !activeLocalId) return;
    if (prev.local !== activeLocalId) {
      if (!activeServerConversationId) newChatStartedAtRef.current = new Date().toISOString();
      if (prev.local !== null) {
        changeFocus({ kind: "chat" });
        setCursorKey(`chat:${activeServerConversationId ?? activeLocalId}`);
      }
      return;
    }
    if (prev.server === null && activeServerConversationId) void refetch();
  }, [enabled, activeLocalId, activeServerConversationId, changeFocus, refetch]);

  // The chat on stage is always in a list, and the list already knows
  // what the store knows about it: a fresh chat has no server row until
  // its first turn lands, so until the server lists it the row is built
  // from the store; once listed, the server's row is brought up to date
  // (read, working while Jamie replies, a message the fetch missed).
  // An archived on-stage chat stays in Archive — never re-prepended into
  // Active after a poll drops it from `items`.
  const chatOnStage = focus.kind === "chat";
  const { displayItems, displayArchivedItems } = useMemo(() => {
    const conv = activeChat ? useCanvasChatStore.getState().conversations[activeChat.localId] : undefined;
    const title = activeChat?.hasMessages && conv ? generateTitle(conv.messages) : "New chat";
    return resolveControlPanelLists(items, archivedItems, activeChat, {
      chatOnStage,
      startedAt: newChatStartedAtRef.current,
      titleForNew: title,
    });
  }, [items, archivedItems, activeChat, chatOnStage]);

  const focusedKey = focus.kind === "chat" ? activeChatKey : `${focus.kind}:${focus.id}`;
  const focusedItem = useMemo(() => {
    if (!focusedKey) return null;
    return (
      displayItems.find((i) => i.key === focusedKey) ??
      displayArchivedItems.find((i) => i.key === focusedKey) ??
      null
    );
  }, [displayItems, displayArchivedItems, focusedKey]);

  const openItem = useCallback(
    async (item: ControlPanelItem) => {
      setCursorKey(item.key);
      if (item.kind === "plan") {
        changeFocus({ kind: "plan", id: item.id });
        return;
      }
      // The chat on stage is already open — nothing to fetch or switch.
      if (item.id === activeServerConversationId || item.id === activeLocalId) {
        changeFocus({ kind: "chat" });
        return;
      }
      const opened = await openOrgConversation(githubLogin, item.id, { syncUrl: true, markSeen: true });
      if (opened) changeFocus({ kind: "chat" });
    },
    [githubLogin, changeFocus, activeServerConversationId, activeLocalId],
  );

  // ── List: search → nest → day groups; keyboard cursor over the rows ──
  const groups = useMemo(
    () => buildControlPanelGroups(displayItems, (item) => matchesControlPanelQuery(item, query)),
    [displayItems, query],
  );
  const archivedRows = useMemo(() => buildArchivedRows(displayArchivedItems), [displayArchivedItems]);
  // A search is asking to see matches, so every chat with a match opens;
  // otherwise what the user opened holds.
  const effectiveExpanded = useMemo(
    () =>
      query
        ? new Set(groups.flatMap((g) => g.rows.filter((r) => (r.childCount ?? 0) > 0).map((r) => r.item.key)))
        : expandedKeys,
    [query, groups, expandedKeys],
  );

  // Rows the keyboard can land on: collapsed chats hide their plans;
  // a collapsed Archive is skipped entirely.
  const visible = useMemo(
    () => visibleControlPanelItems(groups, archivedRows, effectiveExpanded, archivedExpanded),
    [groups, archivedRows, effectiveExpanded, archivedExpanded],
  );

  useEffect(() => {
    if (visible.length === 0) {
      setCursorKey(null);
      return;
    }
    if (!cursorKey || !visible.some((i) => i.key === cursorKey)) {
      setCursorKey(visible[0].key);
    }
  }, [visible, cursorKey]);

  const moveCursor = useCallback(
    (delta: number) => {
      if (visible.length === 0) return;
      const idx = visible.findIndex((i) => i.key === cursorKey);
      const next = idx === -1 ? 0 : Math.min(Math.max(idx + delta, 0), visible.length - 1);
      setCursorKey(visible[next].key);
    },
    [visible, cursorKey],
  );

  const onOpen = useCallback((item: ControlPanelItem) => void openItem(item), [openItem]);
  const onArchive = useCallback(
    (item: ControlPanelItem) => {
      if (item.kind !== "chat") return;
      setArchivedExpanded(true);
      void archiveConversation(item.id);
    },
    [archiveConversation],
  );
  const onRestore = useCallback(
    (item: ControlPanelItem) => {
      if (item.kind !== "chat") return;
      void restoreConversation(item.id);
    },
    [restoreConversation],
  );

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      switch (e.key) {
        case "ArrowDown":
        case "j":
          moveCursor(1);
          break;
        case "ArrowUp":
        case "k":
          moveCursor(-1);
          break;
        case "Enter": {
          const item = visible.find((i) => i.key === cursorKey);
          if (item) void openItem(item);
          break;
        }
        case "n":
          // Same as New chat in the bar; the effect above puts it on stage.
          startNewOrgConversation(githubLogin);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, githubLogin, moveCursor, visible, cursorKey, openItem]);

  return {
    list: {
      groups,
      totalCount: displayItems.length,
      loading,
      query,
      onQueryChange: setQuery,
      expandedKeys: effectiveExpanded,
      onToggleExpanded: toggleExpanded,
      cursorKey,
      focusedKey,
      onOpen,
      remaining,
      onShowMore: showMore,
      archivedRows,
      archivedExpanded,
      onToggleArchived: toggleArchived,
      onArchive,
      onRestore,
    },
    stage: {
      focus,
      focusedItem,
      onFocusChange: changeFocus,
    },
    focusNodeId: focusNodeIdOf(focus),
  };
}
