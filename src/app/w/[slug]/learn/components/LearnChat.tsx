"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LearnChatArea } from "./LearnChatArea";
import { LearnSidebar } from "./LearnSidebar";
import { useStreamProcessor } from "@/lib/streaming";
import { learnToolProcessors, ASK_QUESTION_TOOL, type AskQuestionResponse } from "../lib/streaming-config";
import type { LearnMessage } from "@/types/learn";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { ModelMessage } from "ai";

interface LearnChatProps {
  workspaceSlug: string;
}

export function LearnChat({ workspaceSlug }: LearnChatProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const { workspace } = useWorkspace();
  const repositories = workspace?.repositories ?? [];
  const [selectedRepoId, setSelectedRepoId] = useState<string>("");
  const [messages, setMessages] = useState<LearnMessage[]>([
    {
      id: "1",
      content:
        "Hello! I'm your learning assistant. I can help you understand concepts, explain code, answer questions, and guide you through learning new skills. What would you like to learn about today?",
      role: "assistant",
      timestamp: new Date(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [scrollToTopTrigger, setScrollToTopTrigger] = useState(0);
  const { processStream } = useStreamProcessor<LearnMessage>({
    toolProcessors: learnToolProcessors,
  });
  const hasReceivedContentRef = useRef(false);
  const hasLoadedFeatureRef = useRef(false);

  // Default to first repository when repositories load
  useEffect(() => {
    if (repositories.length > 0 && !selectedRepoId) {
      setSelectedRepoId(repositories[0].id);
    }
  }, [repositories, selectedRepoId]);

  const loadFeatureById = async (featureId: string, featureName?: string) => {
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/learnings/features/${encodeURIComponent(featureId)}?workspace=${encodeURIComponent(workspaceSlug)}`,
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const feature = data.feature;

      const userMessage: LearnMessage = {
        id: Date.now().toString(),
        content: `Tell me about the "${featureName || feature?.name || "this"}" feature`,
        role: "user",
        timestamp: new Date(),
      };

      const assistantMessage: LearnMessage = {
        id: (Date.now() + 1).toString(),
        content: feature?.documentation || "No documentation available for this feature.",
        role: "assistant",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);

      // Trigger scroll to top by incrementing counter
      setScrollToTopTrigger((prev) => prev + 1);
    } catch (error) {
      console.error("Error fetching feature documentation:", error);
      const errorMessage: LearnMessage = {
        id: (Date.now() + 1).toString(),
        content:
          "I'm sorry, but I encountered an error while fetching the feature documentation. Please try again later.",
        role: "assistant",
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Only run on initial mount if there's a feature_id in the URL
    const featureId = searchParams.get("feature_id");
    if (featureId && !hasLoadedFeatureRef.current) {
      hasLoadedFeatureRef.current = true;
      loadFeatureById(featureId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount

  const handleSend = async (content: string) => {
    if (!content.trim()) return;

    const userMessage: LearnMessage = {
      id: Date.now().toString(),
      content: content.trim(),
      role: "user",
      timestamp: new Date(),
    };

    // Filter out the initial greeting message and include the new user message
    const conversationHistory = [
      ...messages.filter(
        (m) => !(m.role === "assistant" && m.content.startsWith("Hello! I'm your learning assistant")),
      ),
      userMessage,
    ];

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    hasReceivedContentRef.current = false;

    try {
      // Convert LearnMessages to ModelMessages format for AI SDK
      const modelMessages = conversationHistory.flatMap((m): ModelMessage[] => {
        // Handle assistant messages with tool calls
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          const messages: ModelMessage[] = [];

          // Tool calls message
          const toolCallMessage: ModelMessage = {
            role: "assistant",
            content: m.toolCalls.map((tc) => ({
              type: "tool-call" as const,
              toolCallId: tc.id,
              toolName: tc.toolName,
              input: tc.input || {},
            })),
          };
          messages.push(toolCallMessage);

          // Tool results message (if any tool has output)
          const toolResults = m.toolCalls.filter((tc) => tc.output !== undefined || tc.errorText !== undefined);
          if (toolResults.length > 0) {
            const toolResultMessage = {
              role: "tool" as const,
              content: toolResults.map((tc) => {
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

          // Text content message (if any)
          if (m.content) {
            const textMessage: ModelMessage = {
              role: "assistant",
              content: m.content,
            };
            messages.push(textMessage);
          }

          return messages;
        }

        // Simple user or assistant message with just text
        return [
          {
            role: m.role,
            content: m.content,
          },
        ];
      });

      const response = await fetch(`/api/ask/quick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: modelMessages,
          workspaceSlug,
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

          setMessages((prev) => {
            // Extract ref_id from ask_question tool call if present
            let ref_id: string | undefined;

            // Check if we already have ref_id from previous update
            const existingIndex = prev.findIndex((m) => m.id === messageId);
            if (existingIndex >= 0 && prev[existingIndex].ref_id) {
              ref_id = prev[existingIndex].ref_id;
            }

            // Extract from current message if not already set
            if (!ref_id && updatedMessage.toolCalls) {
              const askQuestionCall = updatedMessage.toolCalls.find(
                (call) => call.toolName === ASK_QUESTION_TOOL && call.status === "output-available",
              );
              if (askQuestionCall?.output && typeof askQuestionCall.output === "object") {
                const askResponse = askQuestionCall.output as AskQuestionResponse;
                ref_id = askResponse.ref_id;
              }
            }

            const messageWithRefId = { ...updatedMessage, ref_id };
            if (existingIndex >= 0) {
              const updated = [...prev];
              updated[existingIndex] = messageWithRefId;
              return updated;
            }
            return [...prev, messageWithRefId];
          });
        },
        // Additional fields specific to LearnMessage
        {
          role: "assistant" as const,
          timestamp: new Date(),
        },
      );
    } catch (error) {
      console.error("Error calling ask API:", error);
      const errorMessage: LearnMessage = {
        id: (Date.now() + 1).toString(),
        content: "I'm sorry, but I encountered an error while processing your question. Please try again later.",
        role: "assistant",
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeatureClick = async (featureId: string, featureName: string) => {
    // Update URL with feature_id
    const params = new URLSearchParams(searchParams.toString());
    params.set("feature_id", featureId);
    router.push(`?${params.toString()}`, { scroll: false });

    // Load the feature immediately
    await loadFeatureById(featureId, featureName);
  };

  return (
    <div className="relative h-full">
      <div className={isMobile ? "h-full" : "h-full pr-80"}>
        <LearnChatArea
          messages={messages}
          onSend={handleSend}
          isLoading={isLoading}
          workspaceSlug={workspaceSlug}
          scrollToTopTrigger={scrollToTopTrigger}
        />
      </div>
      {!isMobile && (
        <div className="fixed top-1 right-1 h-full">
          <LearnSidebar
            workspaceSlug={workspaceSlug}
            onFeatureClick={handleFeatureClick}
            repositories={repositories}
            selectedRepoId={selectedRepoId}
            onRepoChange={setSelectedRepoId}
          />
        </div>
      )}
    </div>
  );
}
