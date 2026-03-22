"use client";

import React from "react";
import { Clock } from "lucide-react";
import { useState, useCallback } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import type { RecentChatItem } from "@/types/shared-conversation";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  imageData?: string;
  toolCalls?: unknown[];
}

export interface LoadConversationParams {
  messages: ChatMessage[];
  extraWorkspaceSlugs: string[];
  conversationId: string | null;
  isReadOnly: boolean;
}

export interface RecentChatsPopupProps {
  slug: string;
  currentUserId: string;
  onLoadConversation: (params: LoadConversationParams) => void;
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

function extractFirstName(fullName: string | null | undefined): string {
  if (!fullName) return "Unknown";
  return fullName.split(" ")[0];
}

export function RecentChatsPopup({ slug, currentUserId, onLoadConversation }: RecentChatsPopupProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecentChatItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);

  const fetchRecent = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${slug}/chat/recent?limit=10`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      fetchRecent();
    }
  };

  const handleItemClick = async (item: RecentChatItem) => {
    setLoadingItemId(item.id);
    try {
      const res = await fetch(`/api/workspaces/${slug}/chat/conversations/${item.id}`);
      if (!res.ok) return;
      const conv = await res.json();

      // Map stored messages → local Message[] format
      const rawMessages: unknown[] = Array.isArray(conv.messages) ? conv.messages : [];
      const messages: ChatMessage[] = rawMessages
        .filter((m: any) => m.role === "user" || m.role === "assistant")
        .map((m: any, idx: number) => ({
          id: m.id || `loaded-${idx}`,
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string" ? m.content : "",
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
          imageData: m.imageData,
          toolCalls: m.toolCalls,
        }));

      const extraWorkspaceSlugs: string[] = conv.settings?.extraWorkspaceSlugs ?? [];
      const isOwner = conv.userId === currentUserId;

      onLoadConversation({
        messages,
        extraWorkspaceSlugs,
        conversationId: isOwner ? item.id : null,
        isReadOnly: !isOwner,
      });

      setOpen(false);
    } catch {
      // silently fail
    } finally {
      setLoadingItemId(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="pointer-events-auto rounded-full border border-border/50 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground transition-all flex items-center gap-1.5"
        >
          <Clock className="w-3.5 h-3.5" />
          Recent Chats
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-80 p-0 overflow-hidden"
        sideOffset={8}
      >
        <div className="px-3 py-2 border-b border-border/50">
          <p className="text-xs font-medium text-foreground">Recent Chats</p>
          <p className="text-xs text-muted-foreground">Last 10 workspace conversations</p>
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
              <Clock className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No recent chats yet</p>
            </div>
          ) : (
            <div className="py-1">
              {items.map((item) => {
                const firstName = extractFirstName(item.creatorName);
                const label = item.title
                  ? `${item.title} (${firstName})`
                  : `Untitled (${firstName})`;
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
