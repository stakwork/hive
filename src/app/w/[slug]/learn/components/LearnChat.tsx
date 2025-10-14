"use client";

import { useState, useRef } from "react";
import { LearnChatArea } from "./LearnChatArea";
import { LearnSidebar } from "./LearnSidebar";
import { useStreamProcessor } from "@/lib/streaming";
import { learnToolProcessors, ASK_QUESTION_TOOL, type AskQuestionResponse } from "../lib/streaming-config";
import type { LearnMessage } from "@/types/learn";

interface LearnChatProps {
  workspaceSlug: string;
}

export function LearnChat({ workspaceSlug }: LearnChatProps) {
  const [mode, setMode] = useState<"learn" | "chat" | "mic">("chat");
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
  const [currentInput, setCurrentInput] = useState("");
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const { processStream } = useStreamProcessor<LearnMessage>({
    toolProcessors: learnToolProcessors,
    hiddenTools: ["final_answer"],
    hiddenToolTextIds: { final_answer: "final-answer" },
  });
  const hasReceivedContentRef = useRef(false);
  const isLocalhost = typeof window !== "undefined" && window.location.hostname === "localhost";

  const triggerRefetch = () => {
    setRefetchTrigger((prev) => prev + 1);
  };

  const handleSend = async (content: string) => {
    if (!content.trim()) return;

    const userMessage: LearnMessage = {
      id: Date.now().toString(),
      content: content.trim(),
      role: "user",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    hasReceivedContentRef.current = false;

    try {
      const apiEndpoint =
        mode === "chat"
          ? `/api/ask/quick?question=${encodeURIComponent(content.trim())}&workspace=${encodeURIComponent(workspaceSlug)}`
          : `/api/ask?question=${encodeURIComponent(content.trim())}&workspace=${encodeURIComponent(workspaceSlug)}`;

      const response = await fetch(apiEndpoint);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (mode === "chat") {
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
                  (call) => call.toolName === ASK_QUESTION_TOOL && call.status === "output-available"
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
          }
        );
      } else {
        // Handle regular JSON response for learn mode
        const data = await response.json();

        const assistantMessage: LearnMessage = {
          id: (Date.now() + 1).toString(),
          content: data.answer || data.message || "I apologize, but I couldn't generate a response at this time.",
          role: "assistant",
          timestamp: new Date(),
          ref_id: data.ref_id,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      }
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

  const handlePromptClick = (prompt: string) => {
    handleSend(prompt);
  };

  return (
    <div className="relative h-full">
      <div className="h-full pr-80">
        <LearnChatArea
          messages={messages}
          onSend={handleSend}
          isLoading={isLoading}
          onInputChange={setCurrentInput}
          mode={mode}
          onModeChange={setMode}
          onRefetchLearnings={triggerRefetch}
          showMicMode={isLocalhost}
          workspaceSlug={workspaceSlug}
        />
      </div>
      <div className="fixed top-1 right-1 h-full">
        <LearnSidebar
          workspaceSlug={workspaceSlug}
          onPromptClick={handlePromptClick}
          currentQuestion={currentInput.trim() || undefined}
          refetchTrigger={refetchTrigger}
        />
      </div>
    </div>
  );
}
