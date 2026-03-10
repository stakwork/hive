"use client";

import React, { useState, useEffect } from "react";
import { LearnSidebar } from "./LearnSidebar";
import { LearnDocViewer } from "./LearnDocViewer";
import { DiagramViewer } from "./DiagramViewer";
import { CreateDiagramModal } from "./CreateDiagramModal";
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

interface Diagram {
  id: string;
  name: string;
  body: string;
  description?: string | null;
}

interface ActiveItem {
  type: "doc" | "concept" | "diagram";
  repoName?: string;
  id?: string;
  name: string;
  content: string;
  body?: string;
  description?: string | null;
}

interface LearnViewerProps {
  workspaceSlug: string;
}

export function LearnViewer({ workspaceSlug }: LearnViewerProps) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [diagrams, setDiagrams] = useState<Diagram[]>([]);
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);
  const [isDocsLoading, setIsDocsLoading] = useState(true);
  const [isConceptsLoading, setIsConceptsLoading] = useState(true);
  const [isDiagramsLoading, setIsDiagramsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreateDiagramOpen, setIsCreateDiagramOpen] = useState(false);

  const fetchDiagrams = async () => {
    try {
      const response = await fetch(`/api/learnings/diagrams?workspace=${workspaceSlug}`);
      if (response.ok) {
        const data = await response.json();
        setDiagrams(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error("Failed to fetch diagrams:", error);
    } finally {
      setIsDiagramsLoading(false);
    }
  };

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch docs, concepts, and diagrams in parallel
        const [docsResponse, conceptsResponse] = await Promise.all([
          fetch(`/api/learnings/docs?workspace=${workspaceSlug}`),
          fetch(`/api/learnings/features?workspace=${workspaceSlug}`),
        ]);

        if (docsResponse.ok) {
          const docsData = await docsResponse.json();
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

      // Fetch diagrams separately so failure doesn't block docs/concepts
      await fetchDiagrams();
    }

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug]);

  const handleDocClick = (repoName: string, content: string) => {
    setActiveItem({
      type: "doc",
      repoName,
      name: repoName,
      content,
    });
  };

  const handleConceptClick = async (id: string, name: string, content: string) => {
    setActiveItem({ type: "concept", id, name, content });

    if (!content) {
      try {
        const response = await fetch(
          `/api/learnings/features/${encodeURIComponent(id)}?workspace=${workspaceSlug}`
        );
        if (response.ok) {
          const data = await response.json();
          const documentation = data?.feature?.documentation || "";
          setActiveItem({ type: "concept", id, name, content: documentation });
          setConcepts((prev) =>
            prev.map((c) => (c.id === id ? { ...c, content: documentation } : c))
          );
        }
      } catch (error) {
        console.error("Failed to fetch concept documentation:", error);
        toast.error("Failed to load concept documentation");
      }
    }
  };

  const handleDiagramClick = (
    id: string,
    name: string,
    body: string,
    description?: string | null
  ) => {
    setActiveItem({ type: "diagram", id, name, content: "", body, description });
  };

  const handleDiagramCreated = async () => {
    setIsDiagramsLoading(true);
    await fetchDiagrams();
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

        if (!response.ok) throw new Error("Failed to save documentation");

        setDocs((prev) =>
          prev.map((doc) =>
            doc.repoName === activeItem.repoName ? { ...doc, content } : doc
          )
        );
        setActiveItem({ ...activeItem, content });
        toast.success("Documentation saved successfully");
      } else if (activeItem.type === "concept" && activeItem.id) {
        const response = await fetch(
          `/api/learnings/features/${encodeURIComponent(activeItem.id)}/documentation`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documentation: content, workspace: workspaceSlug }),
          }
        );

        if (!response.ok) throw new Error("Failed to save concept documentation");

        setConcepts((prev) =>
          prev.map((concept) =>
            concept.id === activeItem.id ? { ...concept, content } : concept
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
    if (activeItem.type === "doc") return `doc-${activeItem.repoName}`;
    if (activeItem.type === "concept") return `concept-${activeItem.id}`;
    return `diagram-${activeItem.id}`;
  };

  return (
    <div className="flex h-full w-full">
      {/* Main content area */}
      <div className="flex-1 pr-80">
        {activeItem?.type === "diagram" ? (
          <DiagramViewer
            name={activeItem.name}
            body={activeItem.body ?? ""}
            description={activeItem.description}
          />
        ) : (
          <LearnDocViewer
            activeItem={activeItem as Parameters<typeof LearnDocViewer>[0]["activeItem"]}
            onSave={handleSave}
            isSaving={isSaving}
          />
        )}
      </div>

      {/* Right sidebar */}
      <LearnSidebar
        docs={docs}
        concepts={concepts}
        diagrams={diagrams}
        activeItemKey={getActiveItemKey()}
        onDocClick={handleDocClick}
        onConceptClick={handleConceptClick}
        onDiagramClick={handleDiagramClick}
        onCreateDiagram={() => setIsCreateDiagramOpen(true)}
        isDocsLoading={isDocsLoading}
        isConceptsLoading={isConceptsLoading}
        isDiagramsLoading={isDiagramsLoading}
      />

      <CreateDiagramModal
        isOpen={isCreateDiagramOpen}
        onClose={() => setIsCreateDiagramOpen(false)}
        workspaceSlug={workspaceSlug}
        onDiagramCreated={handleDiagramCreated}
      />
    </div>
  );
}
