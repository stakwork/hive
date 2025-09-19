"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, User, Download, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { LearnMessage } from "@/types/learn";
import { generateLearningPDF } from "@/lib/pdf-utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface LearnChatMessageProps {
  message: LearnMessage;
  previousMessage?: LearnMessage;
}

export function LearnChatMessage({ message, previousMessage }: LearnChatMessageProps) {
  const isUser = message.role === "user";
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  // Check if we should show the download button
  const isInitialGreeting = message.id === "1";
  const showDownloadButton = !isUser && !message.isError && !isInitialGreeting;

  const handleDownloadPDF = async () => {
    try {
      setIsGeneratingPDF(true);

      // Find the previous user question
      const question = previousMessage?.role === "user" ? previousMessage.content : undefined;

      await generateLearningPDF({
        question,
        answer: message.content,
        timestamp: message.timestamp,
        elementId: `message-content-${message.id}`,
      });
    } catch (error) {
      console.error("Error generating PDF:", error);
      // Could add a toast notification here for error feedback
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`relative max-w-[85%] rounded-2xl px-4 py-3 shadow-sm group ${
        isUser
          ? "bg-primary text-primary-foreground ml-12"
          : "bg-muted mr-12"
      }`}>
        {!isUser && (
          <div className="font-medium text-sm text-muted-foreground mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Learning Assistant
            </div>
            {showDownloadButton && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleDownloadPDF}
                      disabled={isGeneratingPDF}
                      size="sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 transition-opacity h-6 px-2"
                    >
                      {isGeneratingPDF ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Download</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        )}
        {isUser && (
          <div className="font-medium text-sm text-primary-foreground/80 mb-1 flex items-center gap-2 justify-end">
            <span>You</span>
            <User className="w-4 h-4" />
          </div>
        )}
        <div
          id={`message-content-${message.id}`}
          className={`text-sm ${isUser ? "text-primary-foreground" : ""}`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-gray [&>*]:!text-foreground [&_*]:!text-foreground">
              <ReactMarkdown>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}