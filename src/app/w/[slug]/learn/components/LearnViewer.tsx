"use client";

import React, { useState, useEffect } from "react";
import { LearnSidebar } from "./LearnSidebar";
import { LearnDocViewer } from "./LearnDocViewer";
import { toast } from "sonner";

interface Doc {
  repoName: string;
  content: string;
}

interface Concept {
  id: string;
  name: string;
  content?: string;
}

interface ActiveItem {
  type: "doc" | "concept";
  repoName?: string;
  id?: string;
  name: string;
  content: string;
}

interface LearnViewerProps {
  workspaceSlug: string;
}

export function LearnViewer({ workspaceSlug }: LearnViewerProps) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);
  const [isDocsLoading, setIsDocsLoading] = useState(true);
  const [isConceptsLoading, setIsConceptsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch docs and concepts in parallel
        const [docsResponse, conceptsResponse] = await Promise.all([
          fetch(`/api/learnings/docs?workspace=${workspaceSlug}`),
          fetch(`/api/learnings/features?workspace=${workspaceSlug}`),
        ]);

        if (docsResponse.ok) {
          const docsData = await docsResponse.json();
          // Parse docs response format: [{ "repo/name": { documentation: string } }]
          const parsedDocs: Doc[] = [];
          if (Array.isArray(docsData)) {
            docsData.forEach((item) => {
              Object.entries(item).forEach(([repoName, data]) => {
                if (
                  typeof data === "object" &&
                  data !== null &&
                  "documentation" in data
                ) {
                  parsedDocs.push({
                    repoName,
                    content: (data as { documentation: string }).documentation,
                  });
                }
              });
            });
          }
          setDocs(parsedDocs);

          // Auto-select first doc
          if (parsedDocs.length > 0) {
            const firstDoc = parsedDocs[0];
            setActiveItem({
              type: "doc",
              repoName: firstDoc.repoName,
              name: firstDoc.repoName,
              content: firstDoc.content,
            });
          }
        }
        setIsDocsLoading(false);

        if (conceptsResponse.ok) {
          const conceptsData = await conceptsResponse.json();
          setConcepts(Array.isArray(conceptsData) ? conceptsData : []);
        }
        setIsConceptsLoading(false);
      } catch (error) {
        console.error("Failed to fetch data:", error);
        setIsDocsLoading(false);
        setIsConceptsLoading(false);
        toast.error("Failed to load documentation and concepts");
      }
    }

    fetchData();
  }, [workspaceSlug]);

  const handleDocClick = (repoName: string, content: string) => {
    setActiveItem({
      type: "doc",
      repoName,
      name: repoName,
      content,
    });
  };

  const handleConceptClick = (id: string, name: string, content: string) => {
    setActiveItem({
      type: "concept",
      id,
      name,
      content,
    });
  };

  const handleSave = async (content: string) => {
    if (!activeItem) return;

    setIsSaving(true);
    try {
      if (activeItem.type === "doc" && activeItem.repoName) {
        const response = await fetch("/api/learnings/docs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: activeItem.repoName,
            documentation: content,
            workspace: workspaceSlug,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to save documentation");
        }

        // Update local state
        setDocs((prev) =>
          prev.map((doc) =>
            doc.repoName === activeItem.repoName
              ? { ...doc, content }
              : doc
          )
        );
        setActiveItem({ ...activeItem, content });

        toast.success("Documentation saved successfully");
      } else if (activeItem.type === "concept" && activeItem.id) {
        const response = await fetch(
          `/api/learnings/features/${activeItem.id}/documentation`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              documentation: content,
              workspace: workspaceSlug,
            }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to save concept documentation");
        }

        // Update local state
        setConcepts((prev) =>
          prev.map((concept) =>
            concept.id === activeItem.id
              ? { ...concept, content }
              : concept
          )
        );
        setActiveItem({ ...activeItem, content });

        toast.success("Concept documentation saved successfully");
      }
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const getActiveItemKey = () => {
    if (!activeItem) return null;
    return activeItem.type === "doc"
      ? `doc-${activeItem.repoName}`
      : `concept-${activeItem.id}`;
  };

  return (
    <div className="flex h-full w-full">
      {/* Main content area */}
      <div className="flex-1 pr-80">
        <LearnDocViewer
          activeItem={activeItem}
          onSave={handleSave}
          isSaving={isSaving}
        />
      </div>

      {/* Right sidebar */}
      <LearnSidebar
        docs={docs}
        concepts={concepts}
        activeItemKey={getActiveItemKey()}
        onDocClick={handleDocClick}
        onConceptClick={handleConceptClick}
        isDocsLoading={isDocsLoading}
        isConceptsLoading={isConceptsLoading}
      />
    </div>
  );
}
