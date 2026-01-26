"use client";

import React, { memo, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ChatMessage as ChatMessageType, Option, FormContent } from "@/lib/chat";
import { FormArtifact, LongformArtifactPanel, PublishWorkflowArtifact } from "../artifacts";
import { PullRequestArtifact } from "../artifacts/pull-request";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { WorkflowUrlLink } from "./WorkflowUrlLink";

/**
 * Parse message content to extract <logs> sections
 * Returns the message without logs and an array of log sections
 */
function parseLogsFromMessage(message: string): { content: string; logs: string[] } {
  const logsRegex = /<logs>([\s\S]*?)<\/logs>/g;
  const logs: string[] = [];
  let match;

  while ((match = logsRegex.exec(message)) !== null) {
    logs.push(match[1].trim());
  }

  const content = message.replace(logsRegex, "").trim();
  return { content, logs };
}

interface ChatMessageProps {
  message: ChatMessageType;
  replyMessage?: ChatMessageType;
  onArtifactAction: (messageId: string, action: Option, webhook: string) => Promise<void>;
}

// Custom comparison function for React.memo
function arePropsEqual(prevProps: ChatMessageProps, nextProps: ChatMessageProps): boolean {
  const prevArtifacts = prevProps.message.artifacts;
  const nextArtifacts = nextProps.message.artifacts;

  // Check artifact length first (quick check)
  if (prevArtifacts?.length !== nextArtifacts?.length) {
    return false;
  }

  // Check if any artifact content has changed (for PR status updates)
  const artifactsEqual = !prevArtifacts || prevArtifacts.every((prev, i) => {
    const next = nextArtifacts?.[i];
    if (!next) return false;
    if (prev.id !== next.id) return false;
    // Compare content status for artifacts that have it (PR artifacts)
    const prevStatus = (prev.content as { status?: string })?.status;
    const nextStatus = (next.content as { status?: string })?.status;
    return prevStatus === nextStatus;
  });

  const messageEqual =
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.updatedAt === nextProps.message.updatedAt &&
    prevProps.message.workflowUrl === nextProps.message.workflowUrl &&
    artifactsEqual;

  // Compare replyMessage if present
  const replyMessageEqual = prevProps.replyMessage?.id === nextProps.replyMessage?.id;

  return messageEqual && replyMessageEqual;
}

export const ChatMessage = memo(function ChatMessage({ message, replyMessage, onArtifactAction }: ChatMessageProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);

  // Parse logs from message content
  const { content: messageContent, logs } = useMemo(
    () => (message.message ? parseLogsFromMessage(message.message) : { content: "", logs: [] }),
    [message.message]
  );

  return (
    <motion.div
      key={message.id}
      className="space-y-3 relative"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className={`flex items-end gap-3 ${message.role === "USER" ? "justify-end" : "justify-start"}`}>
        {message.message && (
          <div
            className={`px-4 py-1 rounded-md max-w-full shadow-sm relative ${
              message.role === "USER"
                ? "bg-primary text-primary-foreground rounded-br-md"
                : "bg-background text-foreground rounded-bl-md border"
            }`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <MarkdownRenderer variant={message.role === "USER" ? "user" : "assistant"}>
              {messageContent}
            </MarkdownRenderer>

            {/* Collapsible Logs Section */}
            {logs.length > 0 && (
              <div className="mt-2 border-t pt-2">
                <button
                  onClick={() => setLogsExpanded(!logsExpanded)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {logsExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <span>Logs</span>
                </button>
                {logsExpanded && (
                  <div className="mt-2 max-h-64 overflow-auto rounded bg-muted/50 p-2 text-xs font-mono whitespace-pre-wrap">
                    {logs.map((log, index) => (
                      <div key={index}>{log}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Workflow URL Link for message bubble */}
            {message.workflowUrl && (
              <WorkflowUrlLink workflowUrl={message.workflowUrl} className={isHovered ? "opacity-100" : "opacity-0"} />
            )}
          </div>
        )}
      </div>

      {/* Only Form Artifacts in Chat */}
      {message.artifacts
        ?.filter((a) => a.type === "FORM")
        .map((artifact) => {
          // Find which option was selected by matching replyMessage content with optionResponse
          let selectedOption = null;
          if (replyMessage && artifact.content) {
            const formContent = artifact.content as FormContent;
            selectedOption = formContent.options?.find(
              (option: Option) => option.optionResponse === replyMessage.message
            );
          }

          return (
            <div key={artifact.id} className={`flex ${message.role === "USER" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-md">
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                  <FormArtifact
                    messageId={message.id}
                    artifact={artifact}
                    onAction={onArtifactAction}
                    selectedOption={selectedOption}
                    isDisabled={!!replyMessage}
                  />
                </motion.div>
              </div>
            </div>
          );
        })}
      {message.artifacts
        ?.filter((a) => a.type === "LONGFORM")
        .map((artifact) => (
          <div key={artifact.id} className={`flex ${message.role === "USER" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-md w-full">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <LongformArtifactPanel artifacts={[artifact]} workflowUrl={message.workflowUrl ?? undefined} />
              </motion.div>
            </div>
          </div>
        ))}
      {message.artifacts
        ?.filter((a) => a.type === "PULL_REQUEST")
        .map((artifact) => (
          <div key={artifact.id} className={`flex ${message.role === "USER" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-md w-full">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <PullRequestArtifact artifact={artifact} />
              </motion.div>
            </div>
          </div>
        ))}
      {message.artifacts
        ?.filter((a) => a.type === "PUBLISH_WORKFLOW")
        .map((artifact) => (
          <div key={artifact.id} className={`flex ${message.role === "USER" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-md w-full">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <PublishWorkflowArtifact artifact={artifact} />
              </motion.div>
            </div>
          </div>
        ))}
    </motion.div>
  );
}, arePropsEqual);
