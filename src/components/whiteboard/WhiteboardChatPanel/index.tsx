"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getPusherClient, getWhiteboardChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { serializeDiagramContext } from "@/services/excalidraw-layout";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { ChevronLeft, ChevronRight, Loader2, Mic, MicOff, Send } from "lucide-react";
import { toast } from "sonner";

interface WhiteboardMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
  userId: string | null;
}

interface WhiteboardChatPanelProps {
  whiteboardId: string;
  featureId: string | null;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onReloadWhiteboard: () => Promise<void>;
}

export function WhiteboardChatPanel({
  whiteboardId,
  featureId: _featureId,
  excalidrawAPI,
  onReloadWhiteboard,
}: WhiteboardChatPanelProps) {
  const [messages, setMessages] = useState<WhiteboardMessage[]>([]);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pusherRef = useRef<ReturnType<typeof getPusherClient> | null>(null);
  const preVoiceInputRef = useRef("");

  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  // Sync speech transcript into textarea
  useEffect(() => {
    if (transcript) {
      const newValue = preVoiceInputRef.current
        ? `${preVoiceInputRef.current} ${transcript}`.trim()
        : transcript;
      setInput(newValue);
    }
  }, [transcript]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      preVoiceInputRef.current = input;
      startListening();
    }
  }, [isListening, stopListening, startListening, input]);

  useControlKeyHold({
    onStart: () => {
      preVoiceInputRef.current = input;
      startListening();
    },
    onStop: stopListening,
    enabled: isSupported && !generating,
  });

  // Fetch messages on mount
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await fetch(`/api/whiteboards/${whiteboardId}/messages`);
        const data = await res.json();
        if (data.success) {
          setMessages(data.data || []);
        }
      } catch (error) {
        console.error("Error loading messages:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, [whiteboardId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages]);

  // Pusher subscription for real-time ASSISTANT messages
  useEffect(() => {
    const pusher = getPusherClient();
    pusherRef.current = pusher;
    const channelName = getWhiteboardChannelName(whiteboardId);
    const channel = pusher.subscribe(channelName);

    channel.bind(
      PUSHER_EVENTS.WHITEBOARD_CHAT_MESSAGE,
      async (data: { message: WhiteboardMessage }) => {
        // Append the assistant message
        setMessages((prev) => [...prev, data.message]);
        setGenerating(false);

        // Reload whiteboard and scroll to fit
        await onReloadWhiteboard();
        excalidrawAPI?.scrollToContent(undefined, {
          fitToViewport: true,
          viewportZoomFactor: 0.9,
          animate: true,
          duration: 300,
        });
      }
    );

    return () => {
      channel.unbind(PUSHER_EVENTS.WHITEBOARD_CHAT_MESSAGE);
      pusher.unsubscribe(channelName);
    };
  }, [whiteboardId, excalidrawAPI, onReloadWhiteboard]);

  const handleSend = useCallback(async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || generating) return;

    // Optimistic USER message
    const optimisticMessage: WhiteboardMessage = {
      id: `temp-${Date.now()}`,
      role: "USER",
      content: trimmedInput,
      createdAt: new Date().toISOString(),
      userId: null,
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setInput("");
    if (isListening) stopListening();
    resetTranscript();
    preVoiceInputRef.current = "";
    setGenerating(true);

    try {
      // Extract compact diagram context from current canvas elements
      const diagramContext = excalidrawAPI
        ? serializeDiagramContext(
            excalidrawAPI.getSceneElements() as unknown as readonly Record<string, unknown>[]
          )
        : null;

      const res = await fetch(`/api/whiteboards/${whiteboardId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmedInput, layout: "layered", diagramContext }),
      });

      if (res.status === 409) {
        // Remove optimistic message on conflict
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id));
        toast.error("Diagram generation already in progress");
        setGenerating(false);
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to send message");
      }

      const data = await res.json();
      // Replace optimistic message with real one
      if (data.success && data.data.message) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticMessage.id ? data.data.message : m
          )
        );
      }
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id));
      toast.error("Failed to send message");
      setGenerating(false);
    }
  }, [input, generating, whiteboardId, excalidrawAPI, isListening, stopListening, resetTranscript]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isCollapsed) {
    return (
      <div className="absolute right-2 top-2 z-10">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsCollapsed(false)}
          title="Expand chat"
          className="h-8 w-8"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 flex flex-col w-80 bg-sidebar border-l border-sidebar-border shadow-lg z-10 rounded-r-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-sidebar-border">
        <h3 className="font-medium text-sm">Chat</h3>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(true)}
          title="Collapse chat"
          className="h-6 w-6"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground text-center px-4">
            No messages yet. Ask a question to update the diagram.
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "USER" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    message.role === "USER"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-sidebar-border space-y-2">
        {generating && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Generating diagram...</span>
          </div>
        )}
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? "Listening..." : "Ask to update the diagram..."}
            disabled={generating}
            className="min-h-[80px] max-h-[160px] resize-none overflow-y-auto pr-10"
          />
          {isSupported && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={toggleListening}
                    disabled={generating}
                    size="icon"
                    variant="ghost"
                    data-testid="mic-button"
                    className={`absolute right-1.5 top-1.5 h-7 w-7 ${isListening ? "text-red-500 bg-red-500/10 hover:bg-red-500/20" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {isListening ? (
                      <MicOff className="w-3.5 h-3.5" />
                    ) : (
                      <Mic className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isListening ? "Stop recording" : "Start voice input (or hold Ctrl)"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <Button
          onClick={handleSend}
          disabled={!input.trim() || generating}
          size="sm"
          className="w-full"
        >
          <Send className="w-3.5 h-3.5 mr-2" />
          Send
        </Button>
      </div>
    </div>
  );
}
