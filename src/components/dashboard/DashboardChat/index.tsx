"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useStreamProcessor } from "@/lib/streaming";
import { useRef, useState } from "react";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { CreateFeatureModal } from "./CreateFeatureModal";
import { toast } from "sonner";
import type { ModelMessage } from "ai";

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
  const [isCreatingFeature, setIsCreatingFeature] = useState(false);
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const hasReceivedContentRef = useRef(false);
  const { processStream } = useStreamProcessor();

  const handleSend = async (content: string, clearInput: () => void) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
    };

    // Create the updated messages array (includes current messages + new user message)
    const updatedMessages = [...messages, userMessage];

    // Add user message to state
    setMessages(updatedMessages);
    setIsLoading(true);
    hasReceivedContentRef.current = false;

    try {
      const response = await fetch(`/api/ask/quick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({
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
            clearInput(); // Clear input when response starts
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

  const handleDeleteMessage = (messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

  const handleOpenFeatureModal = () => {
    setShowFeatureModal(true);
  };

  const handleCreateFeature = async (objective: string, imageData?: string) => {
    if (!slug || messages.length === 0) return;

    setIsCreatingFeature(true);

    try {
      // Add objective as a user message to the conversation
      const messagesWithObjective: ModelMessage[] = [
        ...messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        {
          role: "user" as const,
          content: imageData
            ? [
                { type: "text" as const, text: `Feature objective: ${objective}` },
                { type: "image" as const, image: imageData },
              ]
            : `Feature objective: ${objective}`,
        },
      ];

      const response = await fetch("/api/features/create-feature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceSlug: slug,
          transcript: messagesWithObjective,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to create feature");
      }

      const data = await response.json();

      toast.success("Feature created!", {
        description: `"${data.title}" has been added to your workspace.`,
      });

      console.log("✅ Feature created from chat:", data);

      // Close modal on success
      setShowFeatureModal(false);
    } catch (error) {
      console.error("❌ Error creating feature from chat:", error);
      toast.error("Failed to create feature", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsCreatingFeature(false);
    }
  };

  // Only show assistant messages
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const hasAssistantMessages = assistantMessages.length > 0;

  return (
    <div className="pointer-events-none">
      {/* Message history */}
      {assistantMessages.length > 0 && (
        <div className="max-h-[300px] overflow-y-auto pb-2">
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
                  onDelete={handleDeleteMessage}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Input field */}
      <div className="pointer-events-auto">
        <ChatInput
          onSend={handleSend}
          disabled={isLoading}
          showCreateFeature={hasAssistantMessages}
          onCreateFeature={handleOpenFeatureModal}
          isCreatingFeature={isCreatingFeature}
        />
      </div>

      {/* Create Feature Modal */}
      <CreateFeatureModal
        open={showFeatureModal}
        onOpenChange={setShowFeatureModal}
        onSubmit={handleCreateFeature}
        isCreating={isCreatingFeature}
      />
    </div>
  );
}
