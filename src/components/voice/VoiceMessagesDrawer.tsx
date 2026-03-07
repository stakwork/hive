"use client";

import React, { useEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { useVoiceStore, type AgentMessage } from "@/stores/useVoiceStore";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  const isUser = msg.sender === "user";
  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
      <div
        className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words max-w-[85%] ${
          isUser ? "bg-primary text-primary-foreground ml-auto" : "bg-muted"
        }`}
      >
        {msg.message}
      </div>
    </div>
  );
}

export function VoiceMessagesDrawer({ open, onOpenChange }: VoiceMessagesDrawerProps) {
  const messages = useVoiceStore((s) => s.messages);
  const transcription = useVoiceStore((s) => s.transcription);
  const isConnected = useVoiceStore((s) => s.isConnected);
  const sendMessage = useVoiceStore((s) => s.sendMessage);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, transcription, open]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text) return;
    sendMessage(text);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col h-full">
        <SheetHeader>
          <SheetTitle>Voice Agent</SheetTitle>
          <SheetDescription>Chat with Jamie</SheetDescription>
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

          {transcription && transcription.text && (
            <div className="flex flex-col gap-1">
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  transcription.isFinal
                    ? "bg-muted/50 text-foreground"
                    : "border border-dashed border-muted-foreground/30 text-muted-foreground italic"
                }`}
              >
                {transcription.text}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="border-t pt-3 px-4 pb-4 flex gap-2">
          <Input
            placeholder={isConnected ? "Type a message…" : "Connect to start chatting"}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isConnected}
            className="flex-1"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!isConnected}
            aria-label="Send message"
          >
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
