"use client";

import React, { useState, useEffect } from "react";
import {
  ChevronDown,
  BookOpen,
  Lightbulb,
  GitBranch,
  Plus,
  Pencil,
  RefreshCw,
  Sprout,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/hooks/useWorkspace";
import { UsageDisplay } from "./UsageDisplay";
import { CreateFeatureModal } from "./CreateFeatureModal";
import { formatRelativeOrDate } from "@/lib/date-utils";

interface Doc {
  repoName: string;
  content: string;
}

interface Concept {
  id: string;
  name: string;
  content?: string;
}

interface Diagram {
  id: string;
  name: string;
  body: string;
  description?: string | null;
}

interface CumulativeUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface LearnSidebarProps {
  workspaceSlug: string;
  docs: Doc[];
  concepts: Concept[];
  diagrams: Diagram[];
  activeItemKey: string | null;
  onDocClick: (repoName: string, content: string) => void;
  onConceptClick: (id: string, name: string, content: string) => void;
  onDiagramClick: (id: string, name: string, body: string, description?: string | null) => void;
  onCreateDiagram: () => void;
  onEditDiagram: (diagram: Diagram) => void;
  onConceptCreated?: () => void;
  isDocsLoading: boolean;
  isConceptsLoading: boolean;
  isDiagramsLoading: boolean;
}

export function LearnSidebar({
  workspaceSlug,
  docs,
  concepts,
  diagrams,
  activeItemKey,
  onDocClick,
  onConceptClick,
  onDiagramClick,
  onCreateDiagram,
  onEditDiagram,
  onConceptCreated,
  isDocsLoading,
  isConceptsLoading,
  isDiagramsLoading,
}: LearnSidebarProps) {
  const { workspace } = useWorkspace();
  const repositories = workspace?.repositories ?? [];

  const [isDocsExpanded, setIsDocsExpanded] = useState(true);
  const [isConceptsExpanded, setIsConceptsExpanded] = useState(true);
  const [isDiagramsExpanded, setIsDiagramsExpanded] = useState(true);

  // Process Repository state
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [isSeeding, setIsSeeding] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastProcessed, setLastProcessed] = useState<string | null>(null);
  const [cumulativeUsage, setCumulativeUsage] = useState<CumulativeUsage | null>(null);
  const [autoLearnEnabled, setAutoLearnEnabled] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Set default selected repo
  useEffect(() => {
    if (repositories.length > 0 && !selectedRepoId) {
      setSelectedRepoId(repositories[0].id);
    }
  }, [repositories, selectedRepoId]);

  // Fetch processing state
  useEffect(() => {
    const fetchProcessingState = async () => {
      try {
        const response = await fetch(
          `/api/learnings/features?workspace=${encodeURIComponent(workspaceSlug)}`
        );
        if (response.ok) {
          const data = await response.json();
          setLastProcessed(data.lastProcessedTimestamp || null);
          setIsProcessing(data.processing || false);
          setCumulativeUsage(data.cumulativeUsage || null);
        }
      } catch (error) {
        console.error("Error fetching processing state:", error);
      }
    };

    fetchProcessingState();
  }, [workspaceSlug]);

  // Fetch auto-learn config
  useEffect(() => {
    const fetchLearnConfig = async () => {
      setIsLoadingConfig(true);
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceSlug)}/learn/config`
        );
        if (response.ok) {
          const data = await response.json();
          setAutoLearnEnabled(data.config?.autoLearnEnabled ?? false);
        }
      } catch (error) {
        console.error("Error fetching learn config:", error);
      } finally {
        setIsLoadingConfig(false);
      }
    };

    fetchLearnConfig();
  }, [workspaceSlug]);

  const handleSeedKnowledge = async () => {
    if (isSeeding) return;
    setIsSeeding(true);

    try {
      const params = new URLSearchParams({ workspace: workspaceSlug });
      if (selectedRepoId) {
        params.set("repositoryId", selectedRepoId);
      }
      const response = await fetch(`/api/learnings?${params.toString()}`, {
        method: "POST",
      });

      if (!response.ok) {
        console.error(`Failed to process repository: ${response.status}`);
      } else {
        // Re-fetch to get updated state
        const featuresResponse = await fetch(
          `/api/learnings/features?workspace=${encodeURIComponent(workspaceSlug)}`
        );
        if (featuresResponse.ok) {
          const data = await featuresResponse.json();
          setLastProcessed(data.lastProcessedTimestamp || null);
          setIsProcessing(data.processing || false);
          setCumulativeUsage(data.cumulativeUsage || null);
        }
      }
    } catch (error) {
      console.error("Error processing repository:", error);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleAutoLearnToggle = async (checked: boolean) => {
    setAutoLearnEnabled(checked);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/learn/config`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoLearnEnabled: checked }),
        }
      );
      if (!response.ok) {
        setAutoLearnEnabled(!checked);
        console.error("Failed to update auto-learn setting");
      }
    } catch (error) {
      setAutoLearnEnabled(!checked);
      console.error("Error updating auto-learn setting:", error);
    }
  };

  const handleFeatureCreated = () => {
    onConceptCreated?.();
  };

  return (
    <div className="fixed right-0 top-0 bottom-0 w-80 border-l bg-background flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Docs Section */}
        <div data-testid="learn-docs-section">
          <Button
            variant="ghost"
            className="w-full justify-between p-2 h-auto"
            onClick={() => setIsDocsExpanded(!isDocsExpanded)}
          >
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              <span className="font-medium">Docs</span>
              <Badge variant="secondary" className="ml-1">
                {docs.length}
              </Badge>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                isDocsExpanded && "rotate-180"
              )}
            />
          </Button>

          <AnimatePresence>
            {isDocsExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-2 space-y-1">
                  {isDocsLoading ? (
                    <div className="space-y-2 p-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-8 bg-muted/30 rounded animate-pulse" />
                      ))}
                    </div>
                  ) : docs.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No documentation available
                    </div>
                  ) : (
                    docs.map((doc) => {
                      const itemKey = `doc-${doc.repoName}`;
                      const isActive = activeItemKey === itemKey;
                      return (
                        <button
                          key={doc.repoName}
                          data-testid="learn-doc-item"
                          onClick={() => onDocClick(doc.repoName, doc.content)}
                          className={cn(
                            "w-full text-left p-2 rounded-md text-sm transition-colors",
                            isActive
                              ? "bg-muted/60 font-medium"
                              : "bg-muted/30 hover:bg-muted/50"
                          )}
                        >
                          {doc.repoName}
                        </button>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Concepts Section */}
        <div data-testid="learn-concepts-section">
          <Button
            variant="ghost"
            className="w-full justify-between p-2 h-auto"
            onClick={() => setIsConceptsExpanded(!isConceptsExpanded)}
          >
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              <span className="font-medium">Concepts</span>
              <Badge variant="secondary" className="ml-1">
                {concepts.length}
              </Badge>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                isConceptsExpanded && "rotate-180"
              )}
            />
          </Button>

          <AnimatePresence>
            {isConceptsExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-2 space-y-1">
                  {isConceptsLoading ? (
                    <div className="space-y-2 p-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-8 bg-muted/30 rounded animate-pulse" />
                      ))}
                    </div>
                  ) : concepts.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No concepts discovered yet
                    </div>
                  ) : (
                    concepts.map((concept) => {
                      const itemKey = `concept-${concept.id}`;
                      const isActive = activeItemKey === itemKey;
                      return (
                        <button
                          key={concept.id}
                          data-testid="learn-concept-item"
                          onClick={() =>
                            onConceptClick(concept.id, concept.name, concept.content || "")
                          }
                          className={cn(
                            "w-full text-left p-2 rounded-md text-sm transition-colors",
                            isActive
                              ? "bg-muted/60 font-medium"
                              : "bg-muted/30 hover:bg-muted/50"
                          )}
                        >
                          {concept.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Diagrams Section */}
        <div data-testid="learn-diagrams-section">
          <Button
            variant="ghost"
            className="w-full justify-between p-2 h-auto"
            onClick={() => setIsDiagramsExpanded(!isDiagramsExpanded)}
          >
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              <span className="font-medium">Diagrams</span>
              <Badge variant="secondary" className="ml-1">
                {diagrams.length}
              </Badge>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateDiagram();
                }}
                className="ml-1 h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
                title="New diagram"
                data-testid="create-diagram-button"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                isDiagramsExpanded && "rotate-180"
              )}
            />
          </Button>

          <AnimatePresence>
            {isDiagramsExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-2 space-y-1">
                  {isDiagramsLoading ? (
                    <div className="space-y-2 p-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-8 bg-muted/30 rounded animate-pulse" />
                      ))}
                    </div>
                  ) : diagrams.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No diagrams yet
                    </div>
                  ) : (
                    diagrams.map((diagram) => {
                      const itemKey = `diagram-${diagram.id}`;
                      const isActive = activeItemKey === itemKey;
                      return (
                        <div key={diagram.id} className="group relative flex items-center gap-1">
                          <button
                            data-testid="learn-diagram-item"
                            onClick={() =>
                              onDiagramClick(diagram.id, diagram.name, diagram.body, diagram.description)
                            }
                            className={cn(
                              "flex-1 text-left p-2 rounded-md text-sm transition-colors",
                              isActive
                                ? "bg-muted/60 font-medium"
                                : "bg-muted/30 hover:bg-muted/50"
                            )}
                          >
                            {diagram.name}
                          </button>
                          <button
                            data-testid="edit-diagram-button"
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditDiagram(diagram);
                            }}
                            title="Edit diagram"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Process Repository Section - pinned to bottom */}
      <div className="p-4 border-t border-border bg-background">
        <div className="flex items-center gap-2 mb-2">
          <Sprout className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground">Process Repository</h3>
          <div className="ml-auto">
            {cumulativeUsage && <UsageDisplay usage={cumulativeUsage} />}
          </div>
        </div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {lastProcessed
                ? `Last processed: ${formatRelativeOrDate(lastProcessed)}`
                : "Never processed"}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between mb-3 py-2 px-3 bg-muted/30 rounded-lg">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-foreground">Auto-learn on PR merge</span>
          </div>
          <Switch
            checked={autoLearnEnabled}
            onCheckedChange={handleAutoLearnToggle}
            disabled={isLoadingConfig}
          />
        </div>
        {repositories.length > 1 && (
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Repository</span>
            </div>
            <Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select repository" />
              </SelectTrigger>
              <SelectContent>
                {repositories.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id} className="text-xs">
                    {repo.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleSeedKnowledge}
            disabled={isSeeding || isProcessing}
            className="flex-1"
          >
            {isSeeding || isProcessing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                Processing...
              </>
            ) : (
              "Process"
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsCreateModalOpen(true)}
            disabled={isSeeding || isProcessing}
            className="px-3"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <CreateFeatureModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        workspaceSlug={workspaceSlug}
        onFeatureCreated={handleFeatureCreated}
        repositories={repositories}
        selectedRepoId={selectedRepoId}
        onRepoChange={setSelectedRepoId}
      />
    </div>
  );
}
