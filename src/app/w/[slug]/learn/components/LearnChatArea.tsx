"use client";

import { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, Download, Loader2 } from "lucide-react";
import { LearnChatMessage } from "./LearnChatMessage";
import { LearnChatInput } from "./LearnChatInput";
import { ModeToggle } from "@/components/ModeToggle";
import type { LearnMessage } from "@/types/learn";
import { generateConversationPDF } from "@/lib/pdf-utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface LearnChatAreaProps {
  messages: LearnMessage[];
  onSend: (message: string) => Promise<void>;
  isLoading?: boolean;
  onInputChange?: (input: string) => void;
  mode: "learn" | "chat";
  onModeChange: (mode: "learn" | "chat") => void;
}

export function LearnChatArea({
  messages,
  onSend,
  isLoading = false,
  onInputChange,
  mode,
  onModeChange,
}: LearnChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Only show download if there's at least one Q&A exchange (not counting initial greeting)
  const hasValidConversation =
    messages.length > 1 && messages.some((m) => m.role === "assistant" && m.id !== "1" && !m.isError);

  const handleDownloadPDF = async () => {
    try {
      setIsGeneratingPDF(true);
      await generateConversationPDF({
        messages,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error("Error generating PDF:", error);
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  return (
    <div className="h-full flex flex-col relative">
      {/* Header - Fixed */}
      <motion.div
        className="px-6 py-4 border-b bg-muted/20 flex-shrink-0 rounded-t-xl border shadow-sm"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <BookOpen className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">Learning Assistant</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Ask questions, get explanations, and learn new concepts
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle mode={mode} onModeChange={onModeChange} />
            {hasValidConversation && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={handleDownloadPDF} disabled={isGeneratingPDF} size="sm" variant="outline">
                      {isGeneratingPDF ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      <span className="ml-2">Export</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Download conversation as PDF</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </motion.div>

      {/* Messages - Scrollable area with bottom padding for input */}
      <div className="flex-1 px-6 py-6 pb-24 bg-muted/40 border-l border-r">
        <motion.div
          className="space-y-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {messages.map((message) => (
            <LearnChatMessage key={message.id} message={message} />
          ))}

          {isLoading && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
              <div className="max-w-[85%] bg-muted rounded-2xl px-4 py-3 shadow-sm">
                <div className="font-medium text-sm text-muted-foreground mb-1 flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  Learning Assistant
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-1 h-1 bg-current rounded-full animate-pulse"></div>
                  <div
                    className="w-1 h-1 bg-current rounded-full animate-pulse"
                    style={{ animationDelay: "0.2s" }}
                  ></div>
                  <div
                    className="w-1 h-1 bg-current rounded-full animate-pulse"
                    style={{ animationDelay: "0.4s" }}
                  ></div>
                  <span className="ml-2 text-sm text-muted-foreground">Thinking...</span>
                </div>
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </motion.div>
      </div>

      {/* Input - Fixed at bottom of viewport */}
      <div className="absolute bottom-0 left-0 right-0 bg-background border-t shadow-lg">
        <LearnChatInput onSend={onSend} disabled={isLoading} onInputChange={onInputChange} />
      </div>
    </div>
  );
}
