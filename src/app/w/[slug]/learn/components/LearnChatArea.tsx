"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { generateConversationPDF } from "@/lib/pdf-utils";
import type { LearnMessage } from "@/types/learn";
import { motion } from "framer-motion";
import { BookOpen, Download, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LearnChatInput } from "./LearnChatInput";
import { LearnChatMessage } from "./LearnChatMessage";

interface LearnChatAreaProps {
  messages: LearnMessage[];
  onSend: (message: string) => Promise<void>;
  isLoading?: boolean;
  workspaceSlug?: string;
  scrollToTopTrigger?: number;
}

export function LearnChatArea({
  messages,
  onSend,
  isLoading = false,
  workspaceSlug,
  scrollToTopTrigger = 0,
}: LearnChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // Handle scroll events to detect user scrolling
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider user at bottom if within 100px of bottom
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 80;
      setShouldAutoScroll(isNearBottom);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll only if user hasn't manually scrolled up
  useEffect(() => {
    if (!shouldAutoScroll) return;

    // Default: scroll to bottom
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, shouldAutoScroll]);

  // Handle scroll-to-top trigger
  useEffect(() => {
    if (scrollToTopTrigger > 0 && lastMessageRef.current) {
      // Scroll to show the last message at the top
      lastMessageRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrollToTopTrigger]);

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
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-6 py-6 pb-24 bg-muted/40 border-l border-r">
        <motion.div
          className="space-y-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {messages.map((message, index) => (
            <div key={message.id} ref={index === messages.length - 1 ? lastMessageRef : null}>
              <LearnChatMessage message={message} />
            </div>
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
        <LearnChatInput
          onSend={onSend}
          disabled={isLoading}
          workspaceSlug={workspaceSlug}
        />
      </div>
    </div>
  );
}
