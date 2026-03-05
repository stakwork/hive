"use client";

import { useEffect, useRef } from "react";
import { useVoiceStore, type AgentMessage } from "@/stores/useVoiceStore";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

interface VoiceMessagesDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MessageBubble({ msg }: { msg: AgentMessage }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
      <div className="rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words">
        {msg.message}
      </div>
    </div>
  );
}

export function VoiceMessagesDrawer({ open, onOpenChange }: VoiceMessagesDrawerProps) {
  const messages = useVoiceStore((s) => s.messages);
  const transcription = useVoiceStore((s) => s.transcription);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, transcription, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col">
        <SheetHeader>
          <SheetTitle>Voice Agent</SheetTitle>
          <SheetDescription>Messages from the voice agent</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
          {messages.length === 0 && !transcription && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No messages yet. Start speaking to interact with the agent.
            </p>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}

          {transcription && !transcription.isFinal && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Live</span>
              <div className="rounded-lg border border-dashed border-muted-foreground/30 px-3 py-2 text-sm text-muted-foreground italic">
                {transcription.text}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
