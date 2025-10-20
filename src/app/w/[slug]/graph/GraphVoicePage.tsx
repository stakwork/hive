"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { OrbButton } from "./components/OrbButton";
import { Graph } from "@/components/graph/Graph";
import { GraphComponent } from "./index";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import type { LearnMessage } from "@/types/learn";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

interface GraphVoicePageProps {
  workspaceSlug: string;
}

export function GraphVoicePage({ workspaceSlug }: GraphVoicePageProps) {
  const [activeRefId, setActiveRefId] = useState<string | undefined>(undefined);
  const [latestMessage, setLatestMessage] = useState<LearnMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const hasReceivedContentRef = useRef(false);

  // Voice recognition
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  // Enable Ctrl+hold to speak
  useControlKeyHold({
    onStart: startListening,
    onStop: stopListening,
    enabled: isSupported && !isLoading,
  });

  const handleSend = useCallback(async (content: string) => {
    if (!content.trim()) return;

    setIsLoading(true);
    hasReceivedContentRef.current = false;

    try {
      // Use /api/ask (like Learn mode) instead of /api/ask/quick to avoid GitHub PAT requirement
      const apiEndpoint = `/api/ask?question=${encodeURIComponent(content.trim())}&workspace=${encodeURIComponent(workspaceSlug)}`;

      const response = await fetch(apiEndpoint);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Handle JSON response (not streaming)
      const data = await response.json();

      const assistantMessage: LearnMessage = {
        id: Date.now().toString(),
        content: data.answer || data.message || "I apologize, but I couldn't generate a response at this time.",
        role: "assistant",
        timestamp: new Date(),
        ref_id: data.ref_id,
      };

      setLatestMessage(assistantMessage);

      // Update activeRefId when we get a new ref_id
      if (data.ref_id) {
        setActiveRefId(data.ref_id);
      }
    } catch (error) {
      console.error('Error calling ask API:', error);
      const errorMessage: LearnMessage = {
        id: Date.now().toString(),
        content: "I'm sorry, but I encountered an error while processing your question. Please try again later.",
        role: "assistant",
        timestamp: new Date(),
        isError: true,
      };
      setLatestMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceSlug]);

  // Auto-submit when listening stops (handles both button click AND Ctrl+hold release)
  const previousListeningRef = useRef(isListening);
  useEffect(() => {
    const wasListening = previousListeningRef.current;
    previousListeningRef.current = isListening;

    // If we just stopped listening and have a transcript
    if (wasListening && !isListening && transcript.trim()) {
      handleSend(transcript.trim());
      resetTranscript();
    }
  }, [isListening, transcript, handleSend, resetTranscript]);

  const handleToggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, stopListening, startListening]);

  const handleCloseAnswer = useCallback(() => {
    setActiveRefId(undefined);
    setLatestMessage(null);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-background">
      {/* Main area: 3D Graph - full screen */}
      <div className="relative w-full h-full">
        {activeRefId ? (
          <Graph
            endpoint="/api/subgraph"
            params={{
              workspace: workspaceSlug,
              ref_id: activeRefId,
            }}
            layout="layered"
            title=""
            showStats
            height={800}
            emptyMessage="No graph data found for this question"
          />
        ) : (
          <div className="h-full w-full">
            <GraphComponent />
          </div>
        )}

        {/* Floating mic button with transcript - centered and on top */}
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-3">
          {/* Transcript display above mic */}
          <AnimatePresence>
            {transcript.trim() && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="px-4 py-2 rounded-lg bg-background/90 backdrop-blur-sm border shadow-lg max-w-md"
              >
                <p className="text-sm text-foreground">{transcript}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Orb button */}
          <OrbButton
            isListening={isListening}
            isDisabled={!isSupported || isLoading}
            onToggle={handleToggleListening}
            size="lg"
          />
        </div>
      </div>

      {/* Right overlay: Answer panel (same as Learn page shows graph) */}
      <AnimatePresence>
        {(latestMessage || isLoading) && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute right-0 top-0 bottom-0 w-96 border-l bg-card shadow-xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">Answer</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCloseAnswer}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Answer display */}
            <div className="flex-1 overflow-y-auto p-4">
              {latestMessage ? (
                <MarkdownRenderer size="compact">{latestMessage.content}</MarkdownRenderer>
              ) : isLoading ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm">Processing your question...</p>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Loading indicator at bottom */}
            {isLoading && (
              <div className="p-4 border-t bg-muted/50">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                  Processing your question...
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
