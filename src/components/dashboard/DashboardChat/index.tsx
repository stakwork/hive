"use client";

import { useState, useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useStreamProcessor } from "@/lib/streaming";
import { SIDEBAR_WIDTH } from "@/lib/constants";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function DashboardChat() {
  const { slug } = useWorkspace();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const hasReceivedContentRef = useRef(false);
  const { processStream } = useStreamProcessor();

  const handleSend = async (content: string) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
    };

    // Add user message to state
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    hasReceivedContentRef.current = false;

    try {
      const response = await fetch(`/api/ask/quick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          workspaceSlug: slug,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const messageId = (Date.now() + 1).toString();

      await processStream(
        response,
        messageId,
        (updatedMessage) => {
          // Turn off loading as soon as we get the first content
          if (!hasReceivedContentRef.current) {
            hasReceivedContentRef.current = true;
            setIsLoading(false);
          }

          // Extract only text content (no tool calls or reasoning)
          const textContent =
            updatedMessage.textParts?.map((part) => part.content).join("") ||
            updatedMessage.content ||
            "";

          setMessages((prev) => {
            const existing = prev.findIndex((m) => m.id === messageId);
            const simpleMessage: Message = {
              id: messageId,
              role: "assistant",
              content: textContent,
              timestamp: new Date(),
            };

            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = simpleMessage;
              return updated;
            }
            return [...prev, simpleMessage];
          });
        },
        // Additional fields for streaming message
        {
          role: "assistant" as const,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      console.error("Error calling ask API:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content:
          "I'm sorry, but I encountered an error while processing your question. Please try again later.",
        role: "assistant",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Only show assistant messages
  const assistantMessages = messages.filter((m) => m.role === "assistant");

  return (
    <div className="fixed bottom-[35px] left-0 md:left-64 right-0 z-20 pointer-events-none">
      {/* Message history */}
      {assistantMessages.length > 0 && (
        <div className="max-h-[300px] overflow-y-auto pb-2 pointer-events-auto">
          <div className="space-y-2 px-4">
            {assistantMessages.map((message, index) => {
              // Only the last message is streaming
              const isLastMessage = index === assistantMessages.length - 1;
              const isMessageStreaming = isLastMessage && isLoading;
              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isStreaming={isMessageStreaming}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Input field */}
      <div className="pointer-events-auto">
        <ChatInput onSend={handleSend} disabled={isLoading} />
      </div>
    </div>
  );
}
