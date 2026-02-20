"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowUp, Terminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface LogsChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface LogsChatProps {
  workspaceSlug: string;
}

export function LogsChat({ workspaceSlug }: LogsChatProps) {
  const [messages, setMessages] = useState<LogsChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(
    () => `logs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const isMobile = useIsMobile();

  // Handle scroll events to detect user scrolling
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 80;
      setShouldAutoScroll(isNearBottom);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (!shouldAutoScroll) return;

    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 0);
    return () => clearTimeout(timer);
  }, [messages, shouldAutoScroll]);

  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || isLoading) return;

    // Add user message
    const userMsg: LogsChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/workspaces/${workspaceSlug}/logs-agent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, sessionId }),
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `Request failed (${response.status})`);
      }

      const data = await response.json();

      const assistantMsg: LogsChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.answer || "No response from logs agent.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong";
      toast.error(errorMessage);

      // Add error as assistant message so it's visible in chat
      const errorMsg: LogsChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, workspaceSlug, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleBack = () => {
    const referrer = document.referrer;
    const currentOrigin = window.location.origin;
    if (referrer && referrer.startsWith(currentOrigin)) {
      router.back();
    } else {
      router.push(`/w/${workspaceSlug}/agent-logs`);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-background rounded-xl border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-muted/20">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">
              Logs Chat
            </h2>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className={cn(
          "flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-muted/40",
          isMobile && "pb-28",
        )}
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <div className="text-center space-y-2">
              <Terminal className="w-8 h-8 mx-auto opacity-50" />
              <p>Ask about your logs</p>
              <p className="text-xs opacity-70">
                e.g. &quot;Show me errors from the last hour&quot; or &quot;Why
                is stakgraph failing?&quot;
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            className="space-y-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div
              className={`flex items-end gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`px-4 py-1 rounded-md max-w-full shadow-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-background text-foreground rounded-bl-md border"
                }`}
              >
                <MarkdownRenderer
                  variant={msg.role === "user" ? "user" : "assistant"}
                >
                  {msg.content}
                </MarkdownRenderer>
              </div>
            </div>
          </motion.div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="max-w-[85%] bg-muted rounded-2xl px-4 py-3 shadow-sm">
              <div className="font-medium text-sm text-muted-foreground mb-1 flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5" />
                Logs Agent
              </div>
              <div className="text-sm">Analyzing logs...</div>
              <div className="flex items-center mt-2 text-xs text-muted-foreground">
                <div className="flex space-x-1">
                  <div className="w-1 h-1 bg-current rounded-full animate-pulse"></div>
                  <div
                    className="w-1 h-1 bg-current rounded-full animate-pulse"
                    style={{ animationDelay: "0.2s" }}
                  ></div>
                  <div
                    className="w-1 h-1 bg-current rounded-full animate-pulse"
                    style={{ animationDelay: "0.4s" }}
                  ></div>
                </div>
                <span className="ml-2">Processing...</span>
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className={cn(
          isMobile &&
            "fixed bottom-0 left-0 right-0 z-10 bg-background border-t pt-2 pb-[env(safe-area-inset-bottom)]",
        )}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className={cn(
            "flex items-end gap-2 px-4 py-3 md:px-6 md:py-4 border-t bg-background",
            !isMobile && "sticky bottom-0 z-10",
          )}
        >
          <Textarea
            ref={textareaRef}
            placeholder="Ask about your logs..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 resize-none min-h-[56px] md:min-h-[40px]"
            style={{ maxHeight: "8em", overflowY: "auto" }}
            autoFocus
            disabled={isLoading}
            rows={1}
            data-testid="logs-chat-input"
          />
          <Button
            type="submit"
            size={isMobile ? "icon" : "default"}
            disabled={!input.trim() || isLoading}
            className={isMobile ? "h-11 w-11 rounded-full shrink-0" : ""}
            data-testid="logs-chat-submit"
          >
            {isMobile ? (
              <ArrowUp className="w-5 h-5" />
            ) : isLoading ? (
              "Thinking..."
            ) : (
              "Send"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
