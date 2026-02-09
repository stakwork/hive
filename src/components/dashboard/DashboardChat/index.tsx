"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useStreamProcessor } from "@/lib/streaming";
import { useRef, useState, useEffect } from "react";
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { CreateFeatureModal } from "./CreateFeatureModal";
import { ProvenanceTree, type ProvenanceData } from "./ProvenanceTree";
import { toast } from "sonner";
import type { ModelMessage } from "ai";
import { ToolCallIndicator } from "./ToolCallIndicator";
import { X } from "lucide-react";

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
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [provenanceData, setProvenanceData] = useState<ProvenanceData | null>(null);
  const [isProvenanceSidebarOpen, setIsProvenanceSidebarOpen] = useState(false);
  const [_isSharing, setIsSharing] = useState(false);
  const hasReceivedContentRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { processStream } = useStreamProcessor();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeToolCalls]);

  // Subscribe to Pusher for follow-up questions and provenance data
  useEffect(() => {
    if (!slug || !process.env.NEXT_PUBLIC_PUSHER_KEY) return;

    const channelName = getWorkspaceChannelName(slug);
    const pusher = getPusherClient();
    const channel = pusher.subscribe(channelName);

    const handleFollowUpQuestions = (payload: { questions: string[]; timestamp: number }) => {
      // Always store questions - display logic will wait for loading to complete
      console.log("follow up questions:", payload.questions);
      setFollowUpQuestions(payload.questions);
    };

    const handleProvenanceData = (payload: { provenance: ProvenanceData; timestamp: number }) => {
      console.log("provenance data received:", payload.provenance);
      setProvenanceData(payload.provenance);
    };

    channel.bind(PUSHER_EVENTS.FOLLOW_UP_QUESTIONS, handleFollowUpQuestions);
    channel.bind(PUSHER_EVENTS.PROVENANCE_DATA, handleProvenanceData);

    return () => {
      channel.unbind(PUSHER_EVENTS.FOLLOW_UP_QUESTIONS, handleFollowUpQuestions);
      channel.unbind(PUSHER_EVENTS.PROVENANCE_DATA, handleProvenanceData);
      pusher.unsubscribe(channelName);
    };
  }, [slug]);

  // Get the most recent image from the messages array
  const currentImageData =
    messages
      .slice()
      .reverse()
      .find((m) => m.imageData)?.imageData || null;

  const handleSend = async (content: string, clearInput: () => void) => {
    if (!content.trim()) return;

    // Clear follow-up questions and provenance when user sends a message
    setFollowUpQuestions([]);
    setProvenanceData(null);
    setIsProvenanceSidebarOpen(false);

    // Check if the last message is an empty user message with an image
    const lastMessage = messages[messages.length - 1];
    const hasEmptyImageMessage =
      lastMessage && lastMessage.role === "user" && lastMessage.content === "" && lastMessage.imageData;

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
            .filter((m) => m.content.trim() || m.toolCalls) // Keep messages with content or tool calls
            .flatMap((m): ModelMessage[] => {
              // Handle content with images (always from user)
              if (m.imageData) {
                return [
                  {
                    role: "user" as const,
                    content: [
                      { type: "image", image: m.imageData },
                      { type: "text", text: m.content },
                    ],
                  },
                ];
              }

              // Build separate messages for tool calls, results, and text (AI SDK format)
              if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
                console.log("========= tool calls:", JSON.stringify(m.toolCalls, null, 2));

                const messages: ModelMessage[] = [];

                // First message: tool calls only
                const toolCallMessage: ModelMessage = {
                  role: m.role,
                  content: m.toolCalls.map((tc) => ({
                    type: "tool-call" as const,
                    toolCallId: tc.id,
                    toolName: tc.toolName,
                    input: tc.input || {},
                  })),
                };
                messages.push(toolCallMessage);

                // Second message: tool results (if any tool has output)
                const toolResults = m.toolCalls.filter((tc) => tc.output !== undefined || tc.errorText !== undefined);
                if (toolResults.length > 0) {
                  const toolResultMessage = {
                    role: "tool" as const,
                    content: toolResults.map((tc) => {
                      // Ensure output is wrapped in AI SDK format
                      let wrappedOutput = tc.output;
                      if (tc.output && typeof tc.output === "object" && !("type" in tc.output)) {
                        wrappedOutput = { type: "json", value: tc.output };
                      }

                      return {
                        type: "tool-result" as const,
                        toolCallId: tc.id,
                        toolName: tc.toolName,

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
              return [
                {
                  role: m.role,
                  content: m.content,
                },
              ];
            }),
          workspaceSlug: slug,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const messageId = (Date.now() + 1).toString();

      await processStream(response, messageId, (updatedMessage) => {
        // Turn off loading as soon as we get the first content
        if (!hasReceivedContentRef.current) {
          hasReceivedContentRef.current = true;
          setIsLoading(false);
          clearInput(); // Clear input when response starts
        }

        // Use timeline to split messages at tool call boundaries
        const timeline = updatedMessage.timeline || [];

        // Build messages from timeline
        const timelineMessages: Message[] = [];
        let currentText = "";
        let currentToolCalls: ToolCall[] = [];
        let msgCounter = 0;

        for (const item of timeline) {
          if (item.type === "text") {
            currentText += (item.data as { content: string }).content;
          } else if (item.type === "toolCall") {
            // Flush any accumulated text as a message
            if (currentText.trim()) {
              timelineMessages.push({
                id: `${messageId}-${msgCounter++}`,
                role: "assistant",
                content: currentText,
                timestamp: new Date(),
              });
              currentText = "";
            }

            // Add tool call to current batch
            const toolCall = item.data as {
              id: string;
              toolName: string;
              input?: unknown;
              output?: unknown;
              status: string;
            };
            currentToolCalls.push({
              id: toolCall.id,
              toolName: toolCall.toolName,
              input: toolCall.input,
              status: toolCall.status,
              output: toolCall.output,
              errorText: toolCall.status === "output-error" ? "Tool call failed" : undefined,
            });
          }
        }

        // Flush any remaining tool calls as a message
        if (currentToolCalls.length > 0) {
          timelineMessages.push({
            id: `${messageId}-${msgCounter++}`,
            role: "assistant",
            content: "", // Empty content for tool message
            timestamp: new Date(),
            toolCalls: currentToolCalls,
          });
          currentToolCalls = [];
        }

        // Flush any remaining text as a message
        if (currentText.trim()) {
          timelineMessages.push({
            id: `${messageId}-${msgCounter++}`,
            role: "assistant",
            content: currentText,
            timestamp: new Date(),
          });
        }

        // Show tool indicator if the last message has tool calls but no following text yet
        const lastMsg = timelineMessages[timelineMessages.length - 1];
        if (lastMsg?.toolCalls && lastMsg.toolCalls.length > 0) {
          setActiveToolCalls(lastMsg.toolCalls);
        } else {
          setActiveToolCalls([]);
        }

        // Update messages state
        setMessages((prev) => {
          // Remove old messages for this response
          const filteredPrev = prev.filter((m) => !m.id.startsWith(messageId));
          return [...filteredPrev, ...timelineMessages];
        });
      });

      // Clear active tool call indicator when streaming is complete
      setActiveToolCalls([]);
    } catch (error) {
      console.error("Error calling ask API:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: "I'm sorry, but I encountered an error while processing your question. Please try again later.",
        role: "assistant",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setActiveToolCalls([]); // Clear tool calls on error
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearAll = () => {
    setMessages([]);
    setFollowUpQuestions([]);
    setProvenanceData(null);
    setIsProvenanceSidebarOpen(false);
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

  const handleFollowUpClick = (question: string) => {
    // Clear follow-up questions immediately
    setFollowUpQuestions([]);

    // Create a dummy clearInput function since we don't need to clear anything
    const noop = () => {};

    // Send the question as a new message
    handleSend(question, noop);
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
          .filter((m) => m.content.trim() || m.toolCalls) // Keep messages with content or tool calls
          .flatMap((m): ModelMessage[] => {
            // Handle content with images (always from user in this context)
            if (m.imageData) {
              return [
                {
                  role: "user" as const,
                  content: [
                    { type: "image" as const, image: m.imageData },
                    { type: "text" as const, text: m.content },
                  ],
                },
              ];
            }

            // Build separate messages for tool calls, results, and text (AI SDK format)
            if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
              const messages: ModelMessage[] = [];

              // First message: tool calls only
              const toolCallMessage: ModelMessage = {
                role: m.role,
                content: m.toolCalls.map((tc) => ({
                  type: "tool-call" as const,
                  toolCallId: tc.id,
                  toolName: tc.toolName,
                  input: tc.input || {},
                })),
              };
              messages.push(toolCallMessage);

              // Second message: tool results (if any tool has output)
              const toolResults = m.toolCalls.filter((tc) => tc.output !== undefined || tc.errorText !== undefined);
              if (toolResults.length > 0) {
                const toolResultMessage = {
                  role: "tool" as const,
                  content: toolResults.map((tc) => {
                    // Ensure output is wrapped in AI SDK format
                    let wrappedOutput = tc.output;
                    if (tc.output && typeof tc.output === "object" && !("type" in tc.output)) {
                      wrappedOutput = { type: "json", value: tc.output };
                    }

                    return {
                      type: "tool-result" as const,
                      toolCallId: tc.id,
                      toolName: tc.toolName,

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
            return [
              {
                role: m.role as "user" | "assistant",
                content: m.content,
              },
            ];
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

  const handleShare = async () => {
    if (!slug || messages.length === 0) return;

    setIsSharing(true);

    try {
      // Generate title from first user message
      const firstUserMessage = messages.find((m) => m.role === "user" && m.content.trim());
      const title = firstUserMessage 
        ? firstUserMessage.content.slice(0, 50) + (firstUserMessage.content.length > 50 ? "..." : "")
        : "Shared Conversation";

      const response = await fetch(`/api/workspaces/${slug}/chat/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          title,
          followUpQuestions: followUpQuestions || [],
          provenanceData: provenanceData || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to share conversation");
      }

      const data = await response.json();
      const shareUrl = `${window.location.origin}${data.url}`;

      // Copy to clipboard
      await navigator.clipboard.writeText(shareUrl);

      toast.success("Share link copied to clipboard!");
    } catch (error) {
      console.error("Error sharing conversation:", error);
      toast.error("Failed to share conversation", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSharing(false);
    }
  };

  // Only show assistant messages
  // const assistantMessages = messages.filter((m) => m.role === "assistant");
  // const hasAssistantMessages = assistantMessages.length > 0;
  const hasMessages = messages.length > 0;

  // Check if provenance has any files to show
  const hasProvenanceFiles =
    provenanceData?.concepts.some((concept) => concept.files && concept.files.length > 0) ?? false;

  return (
    <div className="pointer-events-none flex flex-col justify-end max-h-[85vh]">
      {/* Message history with optional provenance sidebar */}
      {(messages.length > 0 || activeToolCalls.length > 0) && (
        <div className="flex flex-col min-h-0">
          {/* Clear all button - above scrollable area */}
          <div className="flex justify-end px-4 pb-1">
            <button
              onClick={handleClearAll}
              className="pointer-events-auto p-1.5 rounded-full bg-muted/50 hover:bg-muted opacity-50 hover:opacity-100 transition-opacity"
              aria-label="Clear all messages"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-4 flex-1 min-h-0">
            {/* Message history */}
            <div className="flex-1 overflow-y-auto pb-2 pointer-events-auto">
              <div className="space-y-2 px-4">
                {messages.map((message, index) => {
                  // Only the last message is streaming
                  const isLastMessage = index === messages.length - 1;
                  const isMessageStreaming = isLastMessage && isLoading;
                  return <ChatMessage key={message.id} message={message} isStreaming={isMessageStreaming} />;
                })}
                {/* Show tool call indicator when tools are active */}
                {activeToolCalls.length > 0 && <ToolCallIndicator toolCalls={activeToolCalls} />}
                {/* Follow-up question bubbles */}
                {followUpQuestions.length > 0 && !isLoading && messages.length > 0 && (
                  <div className="pointer-events-auto pt-2">
                    <div className="flex flex-col items-end gap-1.5">
                      {followUpQuestions.map((question, index) => (
                        <button
                          key={index}
                          onClick={() => handleFollowUpClick(question)}
                          className="rounded-full border border-border/50 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-all hover:border-border hover:bg-muted/60 hover:text-foreground"
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Scroll anchor */}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Provenance sidebar - only shows when toggled AND data available */}
            {isProvenanceSidebarOpen && provenanceData && (
              <div className="w-80 overflow-y-auto pointer-events-auto">
                <div className="backdrop-blur-md bg-background/20 border border-border/50 rounded-lg p-4 shadow-lg">
                  <ProvenanceTree provenanceData={provenanceData} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Input field */}
      <div className="pointer-events-auto shrink-0">
        <ChatInput
          onSend={handleSend}
          disabled={isLoading}
          showCreateFeature={hasMessages}
          onCreateFeature={handleOpenFeatureModal}
          isCreatingFeature={isCreatingFeature}
          imageData={currentImageData}
          onImageUpload={handleImageUpload}
          onImageRemove={handleImageRemove}
          showProvenanceToggle={hasProvenanceFiles}
          isProvenanceSidebarOpen={isProvenanceSidebarOpen}
          onToggleProvenance={() => setIsProvenanceSidebarOpen(!isProvenanceSidebarOpen)}
          showShareButton={messages.length > 0}
          onShare={handleShare}
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
