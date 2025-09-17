"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MessageCircle, Lightbulb, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Learnings } from "@/types/learn";

interface LearnSidebarProps {
  workspaceSlug: string;
  onPromptClick?: (prompt: string) => void;
  currentQuestion?: string;
}

export function LearnSidebar({ workspaceSlug, onPromptClick, currentQuestion }: LearnSidebarProps) {
  const [learnings, setLearnings] = useState<Learnings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLearnings = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/learnings?workspace=${encodeURIComponent(workspaceSlug)}`);

        if (!response.ok) {
          throw new Error(`Failed to fetch learnings: ${response.status}`);
        }

        const data = await response.json();
        setLearnings(data);
      } catch (error) {
        console.error("Error fetching learnings:", error);
        setError("Failed to load learnings data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchLearnings();
  }, [workspaceSlug]);

  const refetchLearnings = async () => {
    setIsLoading(true);
    setError(null);
    try {
      let url = `/api/learnings?workspace=${encodeURIComponent(workspaceSlug)}`;
      if (currentQuestion) {
        url += `&question=${encodeURIComponent(currentQuestion)}`;
      }

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch learnings: ${response.status}`);
      }

      const data = await response.json();
      setLearnings(data);
    } catch (error) {
      console.error("Error fetching learnings:", error);
      setError("Failed to load learnings data");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePromptClick = (prompt: string) => {
    if (onPromptClick) {
      onPromptClick(prompt);
    }
  };

  if (isLoading) {
    return (
      <div className="w-80 bg-background border-l border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Learning Resources</h2>
          <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-80 bg-background border-l border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Learning Resources</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={refetchLearnings}
            disabled={!currentQuestion?.trim()}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <div className="text-sm text-muted-foreground text-center py-8">{error}</div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-background border-l border-border flex flex-col position-fixed top-0">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-medium text-muted-foreground">Learning Resources</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={refetchLearnings}
            disabled={!currentQuestion?.trim()}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground/70">Previously asked questions and helpful hints</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Prompts Section */}
        {learnings?.prompts && learnings.prompts.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium text-muted-foreground">Previous Questions</h3>
            </div>
            <div className="space-y-2">
              {learnings.prompts.map((prompt, index) => (
                <motion.button
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.05 }}
                  onClick={() => handlePromptClick(prompt)}
                  className="w-full text-left p-3 text-sm bg-muted/30 hover:bg-muted/50 rounded-lg transition-colors cursor-pointer group"
                >
                  <div className="text-muted-foreground group-hover:text-foreground transition-colors">{prompt}</div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Hints Section */}
        {learnings?.hints && learnings.hints.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium text-muted-foreground">Helpful Hints</h3>
            </div>
            <div className="space-y-2">
              {learnings.hints.map((hint, index) => (
                <motion.button
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.05 }}
                  onClick={() => handlePromptClick(hint)}
                  className="w-full text-left p-3 text-sm bg-muted/30 hover:bg-muted/50 rounded-lg transition-colors cursor-pointer group"
                >
                  <div className="text-muted-foreground group-hover:text-foreground transition-colors">{hint}</div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Empty State */}
        {(!learnings?.prompts || learnings.prompts.length === 0) &&
          (!learnings?.hints || learnings.hints.length === 0) && (
            <div className="text-center py-12">
              <div className="text-muted-foreground text-sm">
                No learning resources available yet.
                <br />
                Start asking questions to build your learning history!
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
