"use client";

import { useState } from "react";
import { LearnChatArea } from "./LearnChatArea";
import { LearnSidebar } from "./LearnSidebar";
import type { LearnMessage } from "@/types/learn";

interface LearnChatProps {
  workspaceSlug: string;
}

export function LearnChat({ workspaceSlug }: LearnChatProps) {
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

    try {
      const response = await fetch(
        `/api/ask?question=${encodeURIComponent(content.trim())}&workspace=${encodeURIComponent(workspaceSlug)}`,
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      const assistantMessage: LearnMessage = {
        id: (Date.now() + 1).toString(),
        content: data.answer || data.message || "I apologize, but I couldn't generate a response at this time.",
        role: "assistant",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Error calling ask API:", error);
      const errorMessage: LearnMessage = {
        id: (Date.now() + 1).toString(),
        content: "I'm sorry, but I encountered an error while processing your question. Please try again later.",
        role: "assistant",
        timestamp: new Date(),
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
