"use client";

import { useState, useRef } from "react";
import { LearnChatArea } from "./LearnChatArea";
import { LearnSidebar } from "./LearnSidebar";
import { useStreamProcessor } from "./StreamingMessage/useStreamProcessor";
import type { LearnMessage } from "@/types/learn";

interface LearnChatProps {
  workspaceSlug: string;
}

export function LearnChat({ workspaceSlug }: LearnChatProps) {
  const [mode, setMode] = useState<"learn" | "chat">("learn");
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
  const { processStream } = useStreamProcessor();
  const hasReceivedContentRef = useRef(false);

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

        await processStream(response, messageId, (updatedMessage) => {
          // Turn off loading as soon as we get the first content
          if (!hasReceivedContentRef.current) {
            hasReceivedContentRef.current = true;
            setIsLoading(false);
          }

          setMessages((prev) => {
            const existingIndex = prev.findIndex((m) => m.id === messageId);
            if (existingIndex >= 0) {
              const updated = [...prev];
              updated[existingIndex] = updatedMessage;
              return updated;
            }
            return [...prev, updatedMessage];
          });
        });
      } else {
        // Handle regular JSON response for learn mode
        const data = await response.json();

        const assistantMessage: LearnMessage = {
          id: (Date.now() + 1).toString(),
          content: data.answer || data.message || "I apologize, but I couldn't generate a response at this time.",
          role: "assistant",
          timestamp: new Date(),
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
        />
      </div>
      <div className="fixed top-1 right-1 h-full">
        <LearnSidebar
          workspaceSlug={workspaceSlug}
          onPromptClick={handlePromptClick}
          currentQuestion={currentInput.trim() || undefined}
        />
      </div>
    </div>
  );
}
