"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useStreamProcessor } from "@/lib/streaming";
import { useRef, useState } from "react";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { CreateFeatureModal } from "./CreateFeatureModal";
import { toast } from "sonner";
import type { ModelMessage } from "ai";
import { ToolCallIndicator } from "./ToolCallIndicator";

interface ToolCall {
  id: string;
  toolName: string;
  input?: unknown;
  status: string;
  output?: unknown;
  errorText?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  imageData?: string;
  toolCalls?: ToolCall[];
}

export function DashboardChat() {
  const { slug } = useWorkspace();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingFeature, setIsCreatingFeature] = useState(false);
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCall[]>([]);
  const hasReceivedContentRef = useRef(false);
  const { processStream } = useStreamProcessor();

  // Get the most recent image from the messages array
  const currentImageData = messages
    .slice()
    .reverse()
    .find((m) => m.imageData)?.imageData || null;

  const handleSend = async (content: string, clearInput: () => void) => {
    if (!content.trim()) return;

    // Check if the last message is an empty user message with an image
    const lastMessage = messages[messages.length - 1];
    const hasEmptyImageMessage =
      lastMessage &&
      lastMessage.role === "user" &&
      lastMessage.content === "" &&
      lastMessage.imageData;

    let updatedMessages: Message[];

    if (hasEmptyImageMessage) {
      // Update the last message with the text content
      updatedMessages = [
        ...messages.slice(0, -1),
        {
          ...lastMessage,
          content: content.trim(),
          timestamp: new Date(),
        },
      ];
    } else {
      // Create a new user message with the current image (if any)
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
        imageData: currentImageData || undefined,
      };
      updatedMessages = [...messages, userMessage];
    }

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
          messages: updatedMessages
            .filter((m) => m.content.trim()) // Filter out empty messages
            .flatMap((m): ModelMessage[] => {
              // Handle content with images (always from user)
              if (m.imageData) {
                return [{
                  role: "user" as const,
                  content: [
                    { type: "image", image: m.imageData },
                    { type: "text", text: m.content },
                  ],
                }];
              }

              // Build separate messages for tool calls, results, and text (AI SDK format)
              if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
                console.log("========= tool calls:", JSON.stringify(m.toolCalls, null, 2));

                const messages: ModelMessage[] = [];

                // First message: tool calls only
                const toolCallMessage: ModelMessage = {
                  role: m.role,
                  content: m.toolCalls.map(tc => ({
                    type: "tool-call" as const,
                    toolCallId: tc.id,
                    toolName: tc.toolName,
                    input: tc.input || {},
                  })),
                };
                messages.push(toolCallMessage);

                // Second message: tool results (if any tool has output)
                const toolResults = m.toolCalls.filter(tc => tc.output !== undefined || tc.errorText !== undefined);
                if (toolResults.length > 0) {
                  const toolResultMessage = {
                    role: "tool" as const,
                    content: toolResults.map(tc => {
                      // Ensure output is wrapped in AI SDK format
                      let wrappedOutput = tc.output;
                      if (tc.output && typeof tc.output === "object" && !("type" in tc.output)) {
                        wrappedOutput = { type: "json", value: tc.output };
                      }

                      return {
                        type: "tool-result" as const,
                        toolCallId: tc.id,
                        toolName: tc.toolName,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        output: wrappedOutput as any,
                      };
                    }),
                  } satisfies ModelMessage;
                  messages.push(toolResultMessage);
                }

                // Third message: text content (if any)
                if (m.content) {
                  const textMessage: ModelMessage = {
                    role: m.role,
                    content: m.content,
                  };
                  messages.push(textMessage);
                }

                return messages;
              }

              // Simple text message
              return [{
                role: m.role,
                content: m.content,
              }];
            }),
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

          // Store tool calls (with results in AI SDK format) in message state
          const toolCallsForMessage = updatedMessage.toolCalls?.map(call => ({
            id: call.id,
            toolName: call.toolName,
            input: call.input,
            status: call.status,
            output: call.output,
            errorText: call.errorText,
          })) || [];

          // Keep showing tool indicator until we have text content
          const hasTextContent = textContent.trim().length > 0;

          if (!hasTextContent && toolCallsForMessage.length > 0) {
            // Show tool indicator if we have tool calls but no text yet
            setActiveToolCalls(toolCallsForMessage);
          } else if (hasTextContent) {
            // Clear tool indicator once we have text
            setActiveToolCalls([]);
          }

          // Only add/update message if there's actual text content
          if (hasTextContent) {
            setMessages((prev) => {
              const existing = prev.findIndex((m) => m.id === messageId);
              const simpleMessage: Message = {
                id: messageId,
                role: "assistant",
                content: textContent,
                timestamp: new Date(),
                toolCalls: toolCallsForMessage.length > 0 ? toolCallsForMessage : undefined,
              };

              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = simpleMessage;
                return updated;
              }
              return [...prev, simpleMessage];
            });
          }
        }
      );

      // Clear active tool call indicator when streaming is complete
      setActiveToolCalls([]);
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
      setActiveToolCalls([]); // Clear tool calls on error
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteMessage = (messageId: string) => {
    setMessages((prev) => {
      // Find the index of the message to delete
      const deleteIndex = prev.findIndex((m) => m.id === messageId);
      if (deleteIndex === -1) return prev;

      // Delete this message and ALL messages before it
      // This allows clearing the image by deleting the assistant response
      return prev.slice(deleteIndex + 1);
    });
  };

  const handleImageUpload = (imageData: string) => {
    // Add a new user message with just the image (no text yet)
    const imageMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: "", // Empty content, will be filled when user sends
      timestamp: new Date(),
      imageData,
    };
    setMessages((prev) => [...prev, imageMessage]);
  };

  const handleImageRemove = () => {
    // Remove the most recent message with an image
    setMessages((prev) => {
      const lastImageIndex = prev
        .map((m, i) => ({ msg: m, index: i }))
        .reverse()
        .find((item) => item.msg.imageData)?.index;

      if (lastImageIndex === undefined) return prev;
      return prev.filter((_, i) => i !== lastImageIndex);
    });
  };

  const handleOpenFeatureModal = () => {
    setShowFeatureModal(true);
  };

  const handleCreateFeature = async (objective: string) => {
    if (!slug || messages.length === 0) return;

    setIsCreatingFeature(true);

    try {
      // Filter out empty messages and add objective as a user message
      const messagesWithObjective: ModelMessage[] = [
        ...messages
          .filter((m) => m.content.trim()) // Filter out empty messages
          .flatMap((m): ModelMessage[] => {
            // Handle content with images (always from user in this context)
            if (m.imageData) {
              return [{
                role: "user" as const,
                content: [
                  { type: "image" as const, image: m.imageData },
                  { type: "text" as const, text: m.content },
                ],
              }];
            }

            // Build separate messages for tool calls, results, and text (AI SDK format)
            if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
              const messages: ModelMessage[] = [];

              // First message: tool calls only
              const toolCallMessage: ModelMessage = {
                role: m.role,
                content: m.toolCalls.map(tc => ({
                  type: "tool-call" as const,
                  toolCallId: tc.id,
                  toolName: tc.toolName,
                  input: tc.input || {},
                })),
              };
              messages.push(toolCallMessage);

              // Second message: tool results (if any tool has output)
              const toolResults = m.toolCalls.filter(tc => tc.output !== undefined || tc.errorText !== undefined);
              if (toolResults.length > 0) {
                const toolResultMessage = {
                  role: "tool" as const,
                  content: toolResults.map(tc => {
                    // Ensure output is wrapped in AI SDK format
                    let wrappedOutput = tc.output;
                    if (tc.output && typeof tc.output === "object" && !("type" in tc.output)) {
                      wrappedOutput = { type: "json", value: tc.output };
                    }

                    return {
                      type: "tool-result" as const,
                      toolCallId: tc.id,
                      toolName: tc.toolName,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      output: wrappedOutput as any,
                    };
                  }),
                } satisfies ModelMessage;
                messages.push(toolResultMessage);
              }

              // Third message: text content (if any)
              if (m.content) {
                const textMessage: ModelMessage = {
                  role: m.role,
                  content: m.content,
                };
                messages.push(textMessage);
              }

              return messages;
            }

            // Simple text message
            return [{
              role: m.role as "user" | "assistant",
              content: m.content,
            }];
          }),
        {
          role: "user" as const,
          content: `Feature objective: ${objective}`,
        },
      ];

      const response = await fetch("/api/features/create-feature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceSlug: slug,
          transcript: messagesWithObjective,
          deepResearch: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to create feature");
      }

      const data = await response.json();

      console.log("✅ Feature created from chat:", data);

      // Close modal on success
      setShowFeatureModal(false);

      // Show appropriate toast based on whether deep research was started
      toast.success("Feature created!", {
        description: data.run
          ? `"${data.title}" has been added. Starting deep research...`
          : `"${data.title}" has been added to your workspace.`,
      });
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
  // const assistantMessages = messages.filter((m) => m.role === "assistant");
  // const hasAssistantMessages = assistantMessages.length > 0;
  const hasMessages = messages.length > 0;

  return (
    <div className="pointer-events-none">
      {/* Message history */}
      {(messages.length > 0 || activeToolCalls.length > 0) && (
        <div className="max-h-[300px] overflow-y-auto pb-2">
          <div className="space-y-2 px-4">
            {messages.map((message, index) => {
              // Only the last message is streaming
              const isLastMessage = index === messages.length - 1;
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
            {/* Show tool call indicator when tools are active */}
            {activeToolCalls.length > 0 && (
              <ToolCallIndicator toolCalls={activeToolCalls} />
            )}
          </div>
        </div>
      )}

      {/* Input field */}
      <div className="pointer-events-auto">
        <ChatInput
          onSend={handleSend}
          disabled={isLoading}
          showCreateFeature={hasMessages}
          onCreateFeature={handleOpenFeatureModal}
          isCreatingFeature={isCreatingFeature}
          imageData={currentImageData}
          onImageUpload={handleImageUpload}
          onImageRemove={handleImageRemove}
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
