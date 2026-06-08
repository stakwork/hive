"use client";

import React, { useState, useCallback } from "react";
import { History, PlusCircle } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import type { ConversationListItem } from "@/types/shared-conversation";
import { UNTITLED_CONVERSATION } from "@/lib/ai/conversationHelpers";
import {
  useCanvasChatStore,
  type CanvasChatMessage,
} from "../_state/canvasChatStore";

interface CanvasHistoryPopoverProps {
  githubLogin: string;
}

function formatRelativeTime(dateStr: string | null): string {
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
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/orgs/${githubLogin}/chat/conversations?limit=10`,
      );
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  }, [githubLogin]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      fetchList();
    }
  };

  const handleItemClick = async (item: ConversationListItem) => {
    setLoadingItemId(item.id);
    try {
      const res = await fetch(
        `/api/orgs/${githubLogin}/chat/conversations/${item.id}`,
      );
      if (!res.ok) return;
      const conv = await res.json();

      const rawMessages: unknown[] = Array.isArray(conv.messages)
        ? conv.messages
        : [];
      const messages: CanvasChatMessage[] = rawMessages
        .filter((m: any) => m.role === "user" || m.role === "assistant")
        .map((m: any, idx: number) => ({
          id: m.id || `loaded-${idx}`,
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string" ? m.content : "",
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
          toolCalls: m.toolCalls,
          artifactIds: m.artifactIds,
          approval: m.approval,
          rejection: m.rejection,
          approvalResult: m.approvalResult,
          source: m.source,
        }));

      const store = useCanvasChatStore.getState();
      const activeId = store.activeConversationId;
      const context = activeId
        ? store.conversations[activeId]?.context
        : undefined;

      // Use a fallback context if none exists yet
      const resolvedContext: Parameters<typeof store.startConversation>[0] = context ?? {
        orgId: "",
        githubLogin,
        workspaceSlug: null,
        workspaceSlugs: conv.settings?.extraWorkspaceSlugs ?? [],
        currentCanvasRef: "",
        currentCanvasBreadcrumb: "",
        selectedNodeId: null,
        selectedNodeIds: [],
      };

      const newId = store.startConversation(
        resolvedContext,
        messages,
        undefined,
        messages.length, // ephemeralSeedCount prevents re-saving already-persisted messages
      );
      store.setServerConversationId(newId, item.id);

      setOpen(false);
    } catch {
      // silently fail
    } finally {
      setLoadingItemId(null);
    }
  };

  const handleNewConversation = () => {
    useCanvasChatStore.getState().clearActiveConversation();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Conversation history"
          className="p-1.5 rounded hover:bg-muted transition-colors"
        >
          <History className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0 overflow-hidden"
        sideOffset={8}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
          <p className="text-xs font-medium text-foreground">
            Recent Conversations
          </p>
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
              <p className="text-xs text-muted-foreground">
                No previous conversations
              </p>
            </div>
          ) : (
            <div className="py-1">
              {items.map((item) => {
                // A stored placeholder title (legacy rows created before
                // title self-heal) is treated as empty so the first-user-
                // message preview wins.
                const meaningfulTitle =
                  item.title && item.title !== UNTITLED_CONVERSATION
                    ? item.title
                    : null;
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
                    <span className="text-xs font-medium text-foreground truncate block">
                      {label}
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
  );
}
