"use client";

import React, { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, GitCommit } from "lucide-react";
import { useRouter } from "next/navigation";
import { AgentChatMessage } from "./AgentChatMessage";
import { ChatInput } from "./ChatInput";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";
import { Button } from "@/components/ui/button";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import type { WorkflowStatus, Artifact, ChatMessage } from "@/lib/chat";

interface AgentChatAreaProps {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  inputDisabled?: boolean;
  isLoading?: boolean;
  logs?: LogEntry[];
  pendingDebugAttachment?: Artifact | null;
  onRemoveDebugAttachment?: () => void;
  workflowStatus?: WorkflowStatus | null;
  taskTitle?: string | null;
  workspaceSlug?: string;
  onCommit?: () => Promise<void>;
  isCommitting?: boolean;
}

export function AgentChatArea({
  messages,
  onSend,
  inputDisabled = false,
  isLoading = false,
  logs = [],
  pendingDebugAttachment = null,
  onRemoveDebugAttachment,
  workflowStatus,
  taskTitle,
  workspaceSlug,
  onCommit,
  isCommitting = false,
}: AgentChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const router = useRouter();

  // Handle scroll events to detect user scrolling
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider user at bottom if within 100px of bottom
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 80;
      setShouldAutoScroll(isNearBottom);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll only if user hasn't manually scrolled up
  useEffect(() => {
    if (!shouldAutoScroll) return;

    const scrollToBottom = () => {
      const ref = messagesEndRef.current;
      if (ref && typeof ref.scrollIntoView === "function") {
        ref.scrollIntoView({ behavior: "smooth" });
      }
    };

    const timer = setTimeout(scrollToBottom, 0);
    return () => clearTimeout(timer);
  }, [messages, shouldAutoScroll]);

  const handleBackToTasks = () => {
    if (workspaceSlug) {
      router.push(`/w/${workspaceSlug}/tasks`);
    } else {
      router.back();
    }
  };

  return (
    <motion.div
      className={"flex h-full min-w-0 flex-col bg-background rounded-xl border shadow-sm overflow-hidden"}
      layout
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Task Title Header */}
      <AnimatePresence mode="wait">
        {taskTitle && (
          <motion.div
            key="title-header"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="px-4 py-3 border-b bg-muted/20"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Button variant="ghost" size="sm" onClick={handleBackToTasks} className="flex-shrink-0">
                  <ArrowLeft className="w-4 h-4" />
                </Button>

                <AnimatePresence mode="wait">
                  <motion.h2
                    key={taskTitle}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="text-lg font-semibold text-foreground truncate flex-1"
                    title={taskTitle}
                    data-testid="task-title"
                  >
                    {taskTitle.length > 60 ? `${taskTitle.slice(0, 60)}...` : taskTitle}
                  </motion.h2>
                </AnimatePresence>
              </div>

              {/* Commit Button */}
              {onCommit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCommit}
                  disabled={isCommitting}
                  className="flex-shrink-0 gap-1"
                >
                  <GitCommit className="w-3 h-3" />
                  {isCommitting ? "Generating..." : "Commit"}
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-muted/40">
        {messages.map((msg) => (
          <AgentChatMessage key={msg.id} message={msg} />
        ))}

        {/* Show thinking indicator when loading but no assistant message streaming yet */}
        {isLoading && messages.length > 0 && messages[messages.length - 1].role === "USER" && (
          <motion.div
            className="space-y-3 relative"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-end gap-3 justify-start">
              <div className="px-4 py-1 rounded-md max-w-full shadow-sm relative bg-background text-foreground rounded-bl-md border">
                <ThinkingIndicator />
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <ChatInput
        logs={logs}
        onSend={onSend}
        disabled={inputDisabled}
        isLoading={isLoading}
        pendingDebugAttachment={pendingDebugAttachment}
        onRemoveDebugAttachment={onRemoveDebugAttachment}
        workflowStatus={workflowStatus}
      />
    </motion.div>
  );
}
