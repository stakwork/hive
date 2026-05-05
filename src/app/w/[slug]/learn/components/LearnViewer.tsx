"use client";

import React, { useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
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
  groupId?: string;
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPublicViewer } = useWorkspace();

  const [docs, setDocs] = useState<Doc[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [diagrams, setDiagrams] = useState<Diagram[]>([]);
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);
  const [isDocsLoading, setIsDocsLoading] = useState(true);
  const [isConceptsLoading, setIsConceptsLoading] = useState(true);
  const [isDiagramsLoading, setIsDiagramsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreateDiagramOpen, setIsCreateDiagramOpen] = useState(false);
  const [editingDiagram, setEditingDiagram] = useState<Diagram | null>(null);

  const setUrlParam = (key: "doc" | "concept" | "diagram", value: string) => {
    const p = new URLSearchParams();
    p.set(key, encodeURIComponent(value));
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  const fetchDiagrams = async (): Promise<Diagram[]> => {
    try {
      const response = await fetch(`/api/learnings/diagrams?workspace=${workspaceSlug}`);
      if (response.ok) {
        const data = await response.json();
        const list: Diagram[] = Array.isArray(data) ? data : [];
        setDiagrams(list);
        return list;
      }
    } catch (error) {
      console.error("Failed to fetch diagrams:", error);
    } finally {
      setIsDiagramsLoading(false);
    }
    return [];
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

          // Auto-select first doc only when no URL param is present
          const hasUrlParam =
            searchParams.get("doc") ||
            searchParams.get("concept") ||
            searchParams.get("diagram");
          if (!hasUrlParam && parsedDocs.length > 0) {
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
          setConcepts(Array.isArray(conceptsData) ? conceptsData : conceptsData.features || []);
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

  // Restore active item from URL params once all data has loaded
  useEffect(() => {
    if (isDocsLoading || isConceptsLoading || isDiagramsLoading) return;

    const docParam = searchParams.get("doc");
    const conceptParam = searchParams.get("concept");
    const diagramParam = searchParams.get("diagram");

    if (docParam) {
      const repoName = decodeURIComponent(docParam);
      const match = docs.find((d) => d.repoName === repoName);
      if (match) {
        setActiveItem({ type: "doc", repoName: match.repoName, name: match.repoName, content: match.content });
      } else if (docs.length > 0) {
        setActiveItem({ type: "doc", repoName: docs[0].repoName, name: docs[0].repoName, content: docs[0].content });
      }
    } else if (conceptParam) {
      const id = decodeURIComponent(conceptParam);
      const match = concepts.find((c) => c.id === id);
      if (match) handleConceptClick(match.id, match.name, match.content || "");
    } else if (diagramParam) {
      const id = decodeURIComponent(diagramParam);

      // Fast path: ID is already the latest version in the list
      const exactMatch = diagrams.find((d) => d.id === id);
      if (exactMatch) {
        setActiveItem({ type: "diagram", id: exactMatch.id, name: exactMatch.name, content: "", body: exactMatch.body, description: exactMatch.description });
      } else {
        // Slow path: ID may refer to an older version — resolve its groupId server-side
        (async () => {
          try {
            const res = await fetch(`/api/learnings/diagrams/${encodeURIComponent(id)}?workspace=${workspaceSlug}`);
            if (res.ok) {
              const { groupId } = await res.json();
              const latestInGroup = diagrams.find((d) => d.groupId === groupId);
              if (latestInGroup) {
                setActiveItem({ type: "diagram", id: latestInGroup.id, name: latestInGroup.name, content: "", body: latestInGroup.body, description: latestInGroup.description });
                // Silently rewrite the URL to the latest version
                if (latestInGroup.id !== id) {
                  setUrlParam("diagram", latestInGroup.id);
                }
                return;
              }
            }
          } catch {
            // fall through to fallback
          }
          // Fallback: unknown/deleted diagram — select first doc
          if (docs.length > 0) {
            const firstDoc = docs[0];
            setActiveItem({ type: "doc", repoName: firstDoc.repoName, name: firstDoc.repoName, content: firstDoc.content });
          }
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDocsLoading, isConceptsLoading, isDiagramsLoading]);

  const refreshConcepts = async () => {
    try {
      const response = await fetch(
        `/api/learnings/features?workspace=${workspaceSlug}`
      );
      if (response.ok) {
        const data = await response.json();
        setConcepts(Array.isArray(data) ? data : data.features || []);
      }
    } catch (error) {
      console.error("Failed to refresh concepts:", error);
    }
  };

  const handleDocClick = (repoName: string, content: string) => {
    setActiveItem({
      type: "doc",
      repoName,
      name: repoName,
      content,
    });
    setUrlParam("doc", repoName);
  };

  const handleConceptClick = async (id: string, name: string, content: string) => {
    setActiveItem({ type: "concept", id, name, content });
    setUrlParam("concept", id);

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
    setUrlParam("diagram", id);
  };

  const handleDiagramCreated = async () => {
    setIsDiagramsLoading(true);
    const fresh = await fetchDiagrams();
    if (activeItem?.type === "diagram" && activeItem.id) {
      const updated = fresh.find((d) => d.name === activeItem.name);
      if (updated) {
        setActiveItem({
          type: "diagram",
          id: updated.id,
          name: updated.name,
          content: "",
          body: updated.body,
          description: updated.description,
        });
      }
    }
  };

  const handleEditDiagram = (diagram: Diagram) => {
    setEditingDiagram(diagram);
    setIsCreateDiagramOpen(true);
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
            readOnly={isPublicViewer}
          />
        )}
      </div>

      {/* Right sidebar */}
      <LearnSidebar
        workspaceSlug={workspaceSlug}
        docs={docs}
        concepts={concepts}
        diagrams={diagrams}
        activeItemKey={getActiveItemKey()}
        onDocClick={handleDocClick}
        onConceptClick={handleConceptClick}
        onDiagramClick={handleDiagramClick}
        onCreateDiagram={() => setIsCreateDiagramOpen(true)}
        onEditDiagram={handleEditDiagram}
        onConceptCreated={refreshConcepts}
        isDocsLoading={isDocsLoading}
        isConceptsLoading={isConceptsLoading}
        isDiagramsLoading={isDiagramsLoading}
      />

      <CreateDiagramModal
        isOpen={isCreateDiagramOpen}
        onClose={() => {
          setIsCreateDiagramOpen(false);
          setEditingDiagram(null);
        }}
        workspaceSlug={workspaceSlug}
        onDiagramCreated={handleDiagramCreated}
        editMode={!!editingDiagram}
        diagramId={editingDiagram?.id}
        initialName={editingDiagram?.name}
      />
    </div>
  );
}
