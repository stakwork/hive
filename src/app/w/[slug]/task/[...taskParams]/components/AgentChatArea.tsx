"use client";

import React, { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AgentStreamingMessage } from "@/types/agent";
import { AgentChatMessage } from "./AgentChatMessage";
import { ChatInput } from "./ChatInput";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";
import { Button } from "@/components/ui/button";
import type { WorkflowStatus, Artifact } from "@/lib/chat";

interface AgentChatAreaProps {
  messages: AgentStreamingMessage[];
  onSend: (message: string) => Promise<void>;
  inputDisabled?: boolean;
  isLoading?: boolean;
  logs?: LogEntry[];
  pendingDebugAttachment?: Artifact | null;
  onRemoveDebugAttachment?: () => void;
  workflowStatus?: WorkflowStatus | null;
  taskTitle?: string | null;
  workspaceSlug?: string;
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
}: AgentChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const scrollToBottom = () => {
      const ref = messagesEndRef.current;
      if (ref && typeof ref.scrollIntoView === 'function') {
        ref.scrollIntoView({ behavior: 'smooth' });
      }
    };

    const timer = setTimeout(scrollToBottom, 0);
    return () => clearTimeout(timer);
  }, [messages]);

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
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-muted/40">
        {messages.map((msg) => (
          <AgentChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <ChatInput
        logs={logs}
        messages={[]}
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
