"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  ChatMessage as ChatMessageType,
  Option,
  FormContent,
} from "@/lib/chat";
import { FormArtifact, LongformArtifactPanel } from "../artifacts";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { WorkflowUrlLink } from "./WorkflowUrlLink";

interface ChatMessageProps {
  message: ChatMessageType;
  replyMessage?: ChatMessageType;
  onArtifactAction: (
    messageId: string,
    action: Option,
    webhook: string,
  ) => Promise<void>;
}

export function ChatMessage({
  message,
  replyMessage,
  onArtifactAction,
}: ChatMessageProps) {
  const [isHovered, setIsHovered] = useState(false);

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
      <div
        className={`flex items-end gap-3 ${message.role === "USER" ? "justify-end" : "justify-start"}`}
      >
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
            <MarkdownRenderer
              variant={message.role === "USER" ? "user" : "assistant"}
            >
              {message.message}
            </MarkdownRenderer>
            
            {/* Workflow URL Link for message bubble */}
            {message.workflowUrl && (
              <WorkflowUrlLink 
                workflowUrl={message.workflowUrl}
                className={isHovered ? "opacity-100" : "opacity-0"}
              />
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
              (option: Option) =>
                option.optionResponse === replyMessage.message,
            );
          }

          return (
            <div
              key={artifact.id}
              className={`flex ${message.role === "USER" ? "justify-end" : "justify-start"}`}
            >
              <div className="max-w-md">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
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
          <div
            key={artifact.id}
            className={`flex ${message.role === "USER" ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-md w-full">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <LongformArtifactPanel 
                  artifacts={[artifact]} 
                  workflowUrl={message.workflowUrl ?? undefined}
                />
              </motion.div>
            </div>
          </div>
        ))}
    </motion.div>
  );
}
