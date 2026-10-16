"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  buildControlPanelGroups,
  matchesControlPanelQuery,
  resolveControlPanelLists,
  activeChatTitle,
  type ActiveChatSnapshot,
  type BackgroundChat,
} from "@/services/orgs/control-panel-state";
import type { ControlPanelItem, ControlPanelJob, ControlPanelPullRequest } from "@/types/control-panel";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { openOrgConversation, startNewOrgConversation } from "../../_state/openOrgConversation";
import { isTypingTarget, type ControlPanelListProps } from "./ControlPanelList";
import { useControlPanelItems } from "./useControlPanelItems";

/** How long a job's card gets to appear in a chat that is still loading before the scroll gives up. */
const REVEAL_FRAMES = 90;
/** How long ↑↓ wait for the key to rest before opening the chat. */
const KEYBOARD_OPEN_DELAY_MS = 150;

/** Scroll the chat to a job's newest card once it has rendered. */
function revealJob(jobId: string) {
  let frames = 0;
  const tick = () => {
    const cards = document.querySelectorAll<HTMLElement>(`[data-job-id="${CSS.escape(jobId)}"]`);
    const card = cards[cards.length - 1];
    if (card) card.scrollIntoView({ block: "center", behavior: "smooth" });
    else if (++frames < REVEAL_FRAMES) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * The org page's chat list: the user's Jamie chats, each with the jobs it
 * started and the pull requests they reported, grouped by the day of
 * their newest activity. `OrgCanvasView` owns the conversation lifecycle
 * and `ChatsLayout` renders the list beside the chat; this hook holds the
 * list, the search, the keyboard cursor and what opening a row does.
 */
export function useControlPanel(githubLogin: string): Omit<ControlPanelListProps, "onHide"> {
  const { items, archivedItems, remaining, loading, refetch, showMore, archiveConversation, restoreConversation } =
    useControlPanelItems(githubLogin);

  const [query, setQuery] = useState("");
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  // What the list needs to know about the active chat — primitives
  // only, so streaming's per-chunk store writes don't re-render the page.
  const activeChat = useCanvasChatStore(
    useShallow((s): ActiveChatSnapshot | null => {
      const conv = s.activeConversationId ? s.conversations[s.activeConversationId] : undefined;
      if (!conv) return null;
      const last = conv.messages[conv.messages.length - 1];
      return {
        localId: conv.id,
        serverId: conv.serverConversationId,
        lastMessageAt: last ? last.timestamp.toISOString() : null,
        hasMessages: conv.messages.length > 0,
        isStreaming: conv.isStreaming,
        title: conv.title,
      };
    }),
  );
  const activeLocalId = activeChat?.localId ?? null;
  const activeServerId = activeChat?.serverId ?? null;
  const activeId = activeChat ? (activeServerId ?? activeLocalId) : null;

  // Every chat in the store, as one string of primitives: the store's
  // per-chunk writes leave it unchanged, so streaming doesn't re-render
  // the page, and it still moves when a chat starts, settles or is
  // persisted. The background chats and the refetch triggers read it.
  const chatsKey = useCanvasChatStore((s) =>
    JSON.stringify(
      Object.values(s.conversations).map((conv) => [
        conv.id,
        conv.serverConversationId,
        conv.isStreaming,
        conv.messages[0]?.timestamp.toISOString() ?? null,
        conv.messages[conv.messages.length - 1]?.timestamp.toISOString() ?? null,
        conv.messages.length > 0,
        conv.title,
      ]),
    ),
  );
  const chats = useMemo(
    () =>
      (
        JSON.parse(chatsKey) as [string, string | null, boolean, string | null, string | null, boolean, string | null][]
      ).map(([localId, serverId, isStreaming, startedAt, lastMessageAt, hasMessages, title]) => ({
        startedAt,
        chat: { localId, serverId, lastMessageAt, hasMessages, isStreaming, title } satisfies ActiveChatSnapshot,
      })),
    [chatsKey],
  );

  // A fresh chat gets its server row on its first turn: fetch then, so the
  // stand-in row hands over to the real one; and again when a reply settles.
  // Any chat counts, not just the active one — a reply the user switched
  // away from still finishes and persists.
  const newChatStartedAtRef = useRef(new Date().toISOString());
  const prevChatsRef = useRef(new Map<string, { server: string | null; streaming: boolean }>());
  useEffect(() => {
    const prev = prevChatsRef.current;
    const next = new Map<string, { server: string | null; streaming: boolean }>();
    let changed = false;
    for (const { chat } of chats) {
      const before = prev.get(chat.localId);
      if (before && ((before.server === null && chat.serverId) || (before.streaming && !chat.isStreaming))) {
        changed = true;
      }
      next.set(chat.localId, { server: chat.serverId, streaming: chat.isStreaming });
    }
    prevChatsRef.current = next;
    if (changed) void refetch();
  }, [chats, refetch]);

  const prevActiveLocalIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeLocalId || prevActiveLocalIdRef.current === activeLocalId) return;
    prevActiveLocalIdRef.current = activeLocalId;
    if (!activeServerId) newChatStartedAtRef.current = new Date().toISOString();
    setCursorId(activeServerId ?? activeLocalId);
  }, [activeLocalId, activeServerId]);

  // Every live chat is always in a list, brought up to what the store
  // knows; an archived one stays in Archive.
  const { displayItems, displayArchivedItems } = useMemo(() => {
    const { conversations } = useCanvasChatStore.getState();
    const backgroundChats: BackgroundChat[] = chats
      .filter(({ chat }) => chat.hasMessages && chat.localId !== activeLocalId)
      .map(({ chat, startedAt }) => ({
        chat,
        title: activeChatTitle(chat, conversations[chat.localId]?.messages),
        startedAt: startedAt ?? new Date().toISOString(),
      }));
    const conv = activeChat ? conversations[activeChat.localId] : undefined;
    const title = activeChat ? activeChatTitle(activeChat, conv?.messages) : "New chat";
    return resolveControlPanelLists(items, archivedItems, activeChat, {
      startedAt: newChatStartedAtRef.current,
      titleForNew: title,
      backgroundChats,
    });
  }, [items, archivedItems, activeChat, activeLocalId, chats]);

  const openChat = useCallback(
    async (item: ControlPanelItem): Promise<boolean> => {
      setCursorId(item.id);
      if (item.id === activeServerId || item.id === activeLocalId) return true;
      return openOrgConversation(githubLogin, item.id, { syncUrl: true, markSeen: true });
    },
    [githubLogin, activeServerId, activeLocalId],
  );

  const onOpen = useCallback((item: ControlPanelItem) => void openChat(item), [openChat]);
  const onOpenJob = useCallback(
    async (item: ControlPanelItem, job: ControlPanelJob) => {
      if (await openChat(item)) revealJob(job.id);
    },
    [openChat],
  );
  const onOpenPullRequest = useCallback(
    async (item: ControlPanelItem, pr: ControlPanelPullRequest) => {
      // Opening a chat clears the panel (an artifact belongs to its chat), so the PR goes up after.
      if (await openChat(item)) useCanvasChatStore.getState().openArtifactPanel(pr.identity);
    },
    [openChat],
  );

  const groups = useMemo(
    () => buildControlPanelGroups(displayItems.filter((item) => matchesControlPanelQuery(item, query))),
    [displayItems, query],
  );

  // Rows the keyboard can land on: a collapsed Archive is skipped.
  const visible = useMemo(
    () => [...groups.flatMap((g) => g.items), ...(archivedExpanded ? displayArchivedItems : [])],
    [groups, archivedExpanded, displayArchivedItems],
  );

  // ↑↓ open the chat they land on — once the key rests, so holding one
  // opens the last chat rather than every chat it passes.
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(openTimerRef.current), []);
  const moveCursor = useCallback(
    (delta: number) => {
      if (visible.length === 0) return;
      const idx = visible.findIndex((i) => i.id === cursorId);
      const item = visible[idx === -1 ? 0 : Math.min(Math.max(idx + delta, 0), visible.length - 1)];
      setCursorId(item.id);
      clearTimeout(openTimerRef.current);
      openTimerRef.current = setTimeout(() => void openChat(item), KEYBOARD_OPEN_DELAY_MS);
    },
    [visible, cursorId, openChat],
  );

  useEffect(() => {
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
          // Enter on a focused button or link is that control's own.
          if (e.target instanceof Element && e.target.closest("button, a, [role='button']")) return;
          const item = visible.find((i) => i.id === cursorId);
          if (item) void openChat(item);
          break;
        }
        case "n":
          startNewOrgConversation(githubLogin);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [githubLogin, moveCursor, visible, cursorId, openChat]);

  const onToggleArchived = useCallback(() => setArchivedExpanded((open) => !open), []);
  const onArchive = useCallback(
    (item: ControlPanelItem) => {
      setArchivedExpanded(true);
      void archiveConversation(item.id);
    },
    [archiveConversation],
  );
  const onRestore = useCallback((item: ControlPanelItem) => void restoreConversation(item.id), [restoreConversation]);
  const onNewChat = useCallback(() => startNewOrgConversation(githubLogin), [githubLogin]);

  return {
    groups,
    totalCount: displayItems.length,
    loading,
    query,
    onQueryChange: setQuery,
    cursorId,
    activeId,
    onOpen,
    onOpenJob,
    onOpenPullRequest,
    remaining,
    onShowMore: showMore,
    archivedItems: displayArchivedItems,
    archivedExpanded,
    onToggleArchived,
    onArchive,
    onRestore,
    onNewChat,
  };
}
