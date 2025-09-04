"use client";

import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChatMessage as ChatMessageType,
  Option,
  Artifact,
  WorkflowStatus,
} from "@/lib/chat";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { getAgentIcon } from "@/lib/icons";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";

interface ChatAreaProps {
  messages: ChatMessageType[];
  onSend: (message: string) => Promise<void>;
  onArtifactAction: (
    messageId: string,
    action: Option,
    webhook: string,
  ) => Promise<void>;
  inputDisabled?: boolean;
  isLoading?: boolean;
  hasNonFormArtifacts?: boolean;
  isChainVisible?: boolean;
  lastLogLine?: string;
  logs?: LogEntry[];
  pendingDebugAttachment?: Artifact | null;
  onRemoveDebugAttachment?: () => void;
  workflowStatus?: WorkflowStatus | null;
  taskTitle?: string | null;
}

export function ChatArea({
  messages,
  onSend,
  onArtifactAction,
  inputDisabled = false,
  isLoading = false,
  hasNonFormArtifacts = false,
  isChainVisible = false,
  lastLogLine = "",
  logs = [],
  pendingDebugAttachment = null,
  onRemoveDebugAttachment,
  workflowStatus,
  taskTitle,
}: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <motion.div
      className={
        "flex h-full min-w-0 flex-col bg-background rounded-xl border shadow-sm overflow-hidden"
      }
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
            <AnimatePresence mode="wait">
              <motion.h2
                key={taskTitle} // This will trigger re-animation when title changes
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="text-lg font-semibold text-foreground truncate"
                title={taskTitle}
              >
                {taskTitle.length > 80 ? `${taskTitle.slice(0, 80)}...` : taskTitle}
              </motion.h2>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-muted/40">
        {messages
          .filter((msg) => !msg.replyId) // Hide messages that are replies
          .map((msg) => {
            // Find if this message has been replied to
            const replyMessage = messages.find((m) => m.replyId === msg.id);

            return (
              <ChatMessage
                key={msg.id}
                message={msg}
                replyMessage={replyMessage}
                onArtifactAction={onArtifactAction}
              />
            );
          })}

        {isChainVisible && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex justify-start"
          >
            <div className="max-w-[85%] bg-muted rounded-2xl px-4 py-3 shadow-sm">
              <div className="font-medium text-sm text-muted-foreground mb-1 flex items-center gap-2">
                {getAgentIcon()}
                Hive
              </div>
              <div className="text-sm">
                {lastLogLine ? lastLogLine : `Communicating with workflow...`}
              </div>
              {/* Optional: Add a subtle loading indicator */}
              {isChainVisible && (
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
              )}
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
