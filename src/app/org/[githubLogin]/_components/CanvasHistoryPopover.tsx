"use client";

import React, { useState, useCallback } from "react";
import { History, PlusCircle } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ConversationListItem } from "@/types/shared-conversation";
import { UNTITLED_CONVERSATION } from "@/lib/ai/conversationHelpers";
import { getDraft, slotHasAttachments } from "@/lib/conversationDrafts";
import { useCanvasChatStore } from "../_state/canvasChatStore";
import { openOrgConversation, startNewOrgConversation } from "../_state/openOrgConversation";

/** A history row that exists only in this tab. `id` is a synthetic key, never a `conv-*` server id. */
export interface LocalHistoryItem extends ConversationListItem {
  local: true;
  localId: string;
}

function isLocalHistoryItem(item: ConversationListItem | LocalHistoryItem): item is LocalHistoryItem {
  return (item as LocalHistoryItem).local === true;
}

function unsavedHistoryRows(githubLogin: string): LocalHistoryItem[] {
  const { conversations } = useCanvasChatStore.getState();
  const scope = { userId: null, scope: `org:${githubLogin}` };
  const rows: LocalHistoryItem[] = [];
  for (const conv of Object.values(conversations)) {
    if (conv.serverConversationId) continue;
    const draft = getDraft({ ...scope, conversationKey: conv.id });
    const hasFiles = slotHasAttachments(conv.id);
    const hasMessages = (conv.messages?.length ?? 0) > 0;
    if (!draft && !hasFiles && !hasMessages) continue;
    const preview = draft || (hasFiles ? "Unsent attachment" : null);
    rows.push({
      local: true,
      localId: conv.id,
      id: `local:${conv.id}`,
      title: draft ? null : hasMessages ? conv.title : null,
      lastMessageAt: new Date().toISOString(),
      preview,
      source: "org-canvas",
      isShared: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      unread: false,
    });
  }
  return rows;
}

interface CanvasHistoryPopoverProps {
  githubLogin: string;
}

export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function CanvasHistoryPopover({ githubLogin }: CanvasHistoryPopoverProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Array<ConversationListItem | LocalHistoryItem>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  const draftRevision = useCanvasChatStore((s) => s.draftRevision ?? 0);
  const storeSlots = useCanvasChatStore((s) =>
    Object.values(s.conversations)
      .filter((conv) => !conv.serverConversationId)
      .map((conv) => conv.id)
      .join(","),
  );

  const fetchList = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/orgs/${githubLogin}/chat/conversations?limit=10`);
      if (res.ok) {
        const data = await res.json();
        // Overlay after fetch. Synthetic ids stay out of ConversationListItem.id.
        const local = unsavedHistoryRows(githubLogin);
        const server: ConversationListItem[] = data.items ?? [];
        setItems([...local, ...server]);
      }
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  }, [githubLogin, draftRevision, storeSlots]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      fetchList();
    }
  };

  const handleItemClick = async (item: ConversationListItem | LocalHistoryItem) => {
    if (isLocalHistoryItem(item)) {
      useCanvasChatStore.getState().setActiveConversation(item.localId);
      setOpen(false);
      return;
    }
    setLoadingItemId(item.id);
    try {
      // Hydrates the store, syncs `?chat=<id>` (shareable, survives a
      // refresh) and fires the `seen` POST so the next list load agrees
      // with the optimistic unread clear below.
      const opened = await openOrgConversation(githubLogin, item.id, {
        syncUrl: true,
        markSeen: true,
      });
      if (!opened) return;

      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, unread: false } : it)));
      setOpen(false);
    } finally {
      setLoadingItemId(null);
    }
  };

  const handleNewConversation = () => {
    startNewOrgConversation(githubLogin);
    setOpen(false);
  };

  return (
    <Tooltip delayDuration={200}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        {/* The popover's trigger stays its direct child; the tooltip's trigger
          composes onto the same button through Radix's Slot chain. */}
        <PopoverTrigger asChild>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Conversation history"
              className="p-1.5 rounded hover:bg-muted transition-colors"
            >
              <History className="w-4 h-4" />
            </button>
          </TooltipTrigger>
        </PopoverTrigger>
        <TooltipContent side="bottom">Conversation history</TooltipContent>
        <PopoverContent align="end" className="w-80 p-0 overflow-hidden" sideOffset={8}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
            <p className="text-xs font-medium text-foreground">Recent Conversations</p>
            <button
              type="button"
              onClick={handleNewConversation}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              title="New conversation"
            >
              <PlusCircle className="w-3 h-3" />
              New
            </button>
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {isLoading ? (
              <div className="p-3 space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-1 animate-pulse">
                    <div className="h-3 bg-muted rounded w-3/4" />
                    <div className="h-2.5 bg-muted/60 rounded w-1/3" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <History className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No previous conversations</p>
              </div>
            ) : (
              <div className="py-1">
                {items.map((item) => {
                  // A stored placeholder title (legacy rows created before
                  // title self-heal) is treated as empty so the first-user-
                  // message preview wins.
                  const meaningfulTitle = item.title && item.title !== UNTITLED_CONVERSATION ? item.title : null;
                  const label = meaningfulTitle || item.preview || "Untitled";
                  const isLoadingThis = loadingItemId === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleItemClick(item)}
                      disabled={isLoadingThis}
                      className="w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors flex flex-col gap-0.5 disabled:opacity-60"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        {item.unread && (
                          <span
                            aria-label="Unread"
                            title="New activity since you last viewed"
                            className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500"
                          />
                        )}
                        <span className="text-xs font-medium text-foreground truncate block">{label}</span>
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(item.lastMessageAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </Tooltip>
  );
}
