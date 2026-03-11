"use client";

import React, { useState } from "react";
import { ChevronDown, BookOpen, Lightbulb, GitBranch, Plus, Pencil } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

interface LearnSidebarProps {
  docs: Doc[];
  concepts: Concept[];
  diagrams: Diagram[];
  activeItemKey: string | null;
  onDocClick: (repoName: string, content: string) => void;
  onConceptClick: (id: string, name: string, content: string) => void;
  onDiagramClick: (id: string, name: string, body: string, description?: string | null) => void;
  onCreateDiagram: () => void;
  onEditDiagram: (diagram: Diagram) => void;
  isDocsLoading: boolean;
  isConceptsLoading: boolean;
  isDiagramsLoading: boolean;
}

export function LearnSidebar({
  docs,
  concepts,
  diagrams,
  activeItemKey,
  onDocClick,
  onConceptClick,
  onDiagramClick,
  onCreateDiagram,
  onEditDiagram,
  isDocsLoading,
  isConceptsLoading,
  isDiagramsLoading,
}: LearnSidebarProps) {
  const [isDocsExpanded, setIsDocsExpanded] = useState(true);
  const [isConceptsExpanded, setIsConceptsExpanded] = useState(true);
  const [isDiagramsExpanded, setIsDiagramsExpanded] = useState(true);

  return (
    <div className="fixed right-0 top-0 bottom-0 w-80 border-l bg-background overflow-y-auto">
      <div className="p-4 space-y-6">
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
    </div>
  );
}
