"use client";

import { motion } from "framer-motion";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  ChatMessage as ChatMessageType,
  Option,
  FormContent,
} from "@/lib/chat";
import { FormArtifact, LongformArtifactPanel } from "../artifacts";

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
  return (
    <motion.div
      key={message.id}
      className="space-y-3"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div
        className={`flex items-end gap-3 ${message.role === "USER" ? "justify-end" : "justify-start"}`}
      >
        {message.role === "ASSISTANT" && (
          <Avatar>
            <AvatarImage src="" alt="Assistant" />
            <AvatarFallback>A</AvatarFallback>
          </Avatar>
        )}
        <div
          className={`px-4 py-2 rounded-xl text-sm max-w-xs shadow-sm whitespace-pre-wrap ${
            message.role === "USER"
              ? "bg-primary text-primary-foreground rounded-br-none"
              : "bg-background text-foreground rounded-bl-none border"
          }`}
        >
          {message.message}
        </div>
        {message.role === "USER" && (
          <Avatar>
            <AvatarImage src="" alt="You" />
            <AvatarFallback>Y</AvatarFallback>
          </Avatar>
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
                <LongformArtifactPanel artifacts={[artifact]} />
              </motion.div>
            </div>
          </div>
        ))}
    </motion.div>
  );
}
