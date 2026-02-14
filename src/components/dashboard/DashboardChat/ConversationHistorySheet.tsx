"use client";

import React, { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare } from "lucide-react";
import { formatDistanceToNow, format, isToday, isYesterday, isThisWeek } from "date-fns";
import type { ConversationListItem } from "@/types/shared-conversation";

interface ConversationHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoadConversation: (conversationId: string) => void;
  workspaceSlug: string;
}

export function ConversationHistorySheet({
  open,
  onOpenChange,
  onLoadConversation,
  workspaceSlug,
}: ConversationHistorySheetProps) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && workspaceSlug) {
      fetchConversations();
    }
  }, [open, workspaceSlug]);

  const fetchConversations = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/chat/conversations?limit=10`);

      if (!response.ok) {
        throw new Error("Failed to fetch conversations");
      }

      const data = await response.json();
      setConversations(data.conversations || []);
    } catch (err) {
      console.error("Error fetching conversations:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string | Date) => {
    const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;

    if (isToday(date)) {
      return formatDistanceToNow(date, { addSuffix: true });
    } else if (isYesterday(date)) {
      return "Yesterday";
    } else if (isThisWeek(date)) {
      return format(date, "EEEE"); // Day of week
    } else {
      return format(date, "MMM d"); // e.g., "Jan 15"
    }
  };

  const handleConversationClick = (conversationId: string) => {
    onLoadConversation(conversationId);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>Conversation History</SheetTitle>
          <SheetDescription>View and load your recent conversations</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-2">
          {isLoading && (
            <>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              ))}
            </>
          )}

          {!isLoading && error && (
            <div className="text-center py-8 text-destructive">
              <p>Failed to load conversations</p>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
            </div>
          )}

          {!isLoading && !error && conversations.length === 0 && (
            <div className="text-center py-12">
              <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">No conversation history yet</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                Start a conversation to see it here
              </p>
            </div>
          )}

          {!isLoading && !error && conversations.length > 0 && (
            <div className="space-y-1">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => handleConversationClick(conversation.id)}
                  className="w-full text-left p-3 rounded-lg border border-border/50 hover:bg-accent transition-colors"
                >
                  <h3 className="font-medium text-sm mb-1 line-clamp-1">
                    {conversation.title}
                  </h3>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                    {conversation.preview}
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    {formatTimestamp(conversation.lastMessageAt)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default ConversationHistorySheet;
