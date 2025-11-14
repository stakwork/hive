"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Lightbulb, RefreshCw, Sprout, Box, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Learnings } from "@/types/learn";

interface Feature {
  id: string;
  name: string;
  documentation?: string;
}

interface LearnSidebarProps {
  workspaceSlug: string;
  onPromptClick?: (prompt: string) => void;
  onFeatureClick?: (featureId: string, featureName: string) => void;
  currentQuestion?: string;
  refetchTrigger?: number;
}

export function LearnSidebar({
  workspaceSlug,
  onPromptClick,
  onFeatureClick,
  currentQuestion,
  refetchTrigger,
}: LearnSidebarProps) {
  const [learnings, setLearnings] = useState<Learnings | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFeaturesLoading, setIsFeaturesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [isSeeding, setIsSeeding] = useState(false);
  const [isFeaturesCollapsed, setIsFeaturesCollapsed] = useState(false);
  const [isHintsCollapsed, setIsHintsCollapsed] = useState(false);
  const [isPromptsCollapsed, setIsPromptsCollapsed] = useState(false);

  useEffect(() => {
    const fetchLearnings = async () => {
      setIsLoading(true);
      setError(null);
      try {
        let url = `/api/learnings?workspace=${encodeURIComponent(workspaceSlug)}`;
        if (refetchTrigger && refetchTrigger > 0 && currentQuestion) {
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

    fetchLearnings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, refetchTrigger]);

  useEffect(() => {
    const fetchFeatures = async () => {
      setIsFeaturesLoading(true);
      try {
        const url = `/api/learnings/features?workspace=${encodeURIComponent(workspaceSlug)}`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch features: ${response.status}`);
        }

        const data = await response.json();
        setFeatures(data.features || []);
      } catch (error) {
        console.error("Error fetching features:", error);
      } finally {
        setIsFeaturesLoading(false);
      }
    };

    fetchFeatures();
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

  const handleFeatureClickInternal = (featureId: string, featureName: string) => {
    if (onFeatureClick) {
      onFeatureClick(featureId, featureName);
    }
  };

  const handleSeedKnowledge = async () => {
    if (!budget || isSeeding) return;

    setIsSeeding(true);
    setBudget("");

    fetch(`/api/learnings?workspace=${encodeURIComponent(workspaceSlug)}&budget=${encodeURIComponent(budget)}`, {
      method: "POST",
    })
      .then((response) => {
        if (!response.ok) {
          console.error(`Failed to seed knowledge: ${response.status}`);
        }
      })
      .catch((error) => {
        console.error("Error seeding knowledge:", error);
      });

    setTimeout(() => {
      setIsSeeding(false);
    }, 500);
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
            <Skeleton key={i} className="h-16 w-full" />
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
          <Button variant="ghost" size="sm" onClick={refetchLearnings} disabled={!currentQuestion?.trim()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <div className="text-sm text-muted-foreground text-center py-8">{error}</div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-background border-l border-border flex flex-col fixed top-0 right-0 h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-medium text-muted-foreground">Learning Resources</h2>
          <Button variant="ghost" size="sm" onClick={refetchLearnings} disabled={!currentQuestion?.trim()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground/70">Previously asked questions and helpful hints</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Features Section */}
        {!isFeaturesLoading && features && features.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <button
              onClick={() => setIsFeaturesCollapsed(!isFeaturesCollapsed)}
              className="flex items-center gap-2 mb-3 w-full hover:opacity-70 transition-opacity"
            >
              <Box className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium text-muted-foreground">Concepts</h3>
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground ml-auto transition-transform ${isFeaturesCollapsed ? "-rotate-90" : ""}`}
              />
            </button>
            <AnimatePresence>
              {!isFeaturesCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2 overflow-hidden"
                >
                  {features.map((feature, index) => (
                    <motion.button
                      key={index}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.05 }}
                      onClick={() => handleFeatureClickInternal(feature.id, feature.name)}
                      className="w-full text-left p-3 text-sm bg-muted/30 hover:bg-muted/50 rounded-lg transition-colors cursor-pointer group"
                    >
                      <div className="text-muted-foreground group-hover:text-foreground transition-colors">
                        {feature.name}
                      </div>
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Hints Section */}
        {learnings?.hints && learnings.hints.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <button
              onClick={() => setIsHintsCollapsed(!isHintsCollapsed)}
              className="flex items-center gap-2 mb-3 w-full hover:opacity-70 transition-opacity"
            >
              <Lightbulb className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium text-muted-foreground">Helpful Hints</h3>
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground ml-auto transition-transform ${isHintsCollapsed ? "-rotate-90" : ""}`}
              />
            </button>
            <AnimatePresence>
              {!isHintsCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2 overflow-hidden"
                >
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
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Prompts Section */}
        {learnings?.prompts && learnings.prompts.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <button
              onClick={() => setIsPromptsCollapsed(!isPromptsCollapsed)}
              className="flex items-center gap-2 mb-3 w-full hover:opacity-70 transition-opacity"
            >
              <MessageCircle className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium text-muted-foreground">Previous Prompts</h3>
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground ml-auto transition-transform ${isPromptsCollapsed ? "-rotate-90" : ""}`}
              />
            </button>
            <AnimatePresence>
              {!isPromptsCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2 overflow-hidden"
                >
                  {learnings.prompts.map((prompt, index) => (
                    <motion.button
                      key={index}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.05 }}
                      onClick={() => handlePromptClick(prompt)}
                      className="w-full text-left p-3 text-sm bg-muted/30 hover:bg-muted/50 rounded-lg transition-colors cursor-pointer group"
                    >
                      <div className="text-muted-foreground group-hover:text-foreground transition-colors">
                        {prompt}
                      </div>
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Empty State */}
        {(!learnings?.prompts || learnings.prompts.length === 0) &&
          (!learnings?.hints || learnings.hints.length === 0) &&
          (!features || features.length === 0) &&
          !isFeaturesLoading && (
            <div className="text-center py-12">
              <div className="text-muted-foreground text-sm">
                No learning resources available yet.
                <br />
                Start asking questions to build your learning history!
              </div>
            </div>
          )}
      </div>

      {/* Seed Knowledge Section */}
      <div className="p-4 border-t border-border bg-background">
        <div className="flex items-center gap-2 mb-2">
          <Sprout className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground">Seed Knowledge</h3>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            placeholder="$ amount"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="h-9 text-sm"
            disabled={isSeeding}
          />
          <Button size="sm" onClick={handleSeedKnowledge} disabled={!budget || isSeeding}>
            {isSeeding ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Seed"}
          </Button>
        </div>
      </div>
    </div>
  );
}
