"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CollaboratorAvatars } from "@/components/whiteboard/CollaboratorAvatars";
import { WhiteboardChatPanel } from "@/components/whiteboard/WhiteboardChatPanel";
import { WhiteboardVersionPanel } from "@/components/whiteboard/WhiteboardVersionPanel";
import { useWhiteboardCollaboration } from "@/hooks/useWhiteboardCollaboration";
import { useWorkspace } from "@/hooks/useWorkspace";
import { uploadNewFiles, resolveFilesForDisplay } from "@/hooks/useWhiteboardImages";
import { getInitialAppState } from "@/lib/excalidraw-config";
import { computeVersionChanges } from "@/lib/whiteboard/version-utils";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ArrowLeft, Check, Loader2, Maximize2, Minimize2, Pencil, Scan, Wifi, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false }
);

function computeSnapshot(elements: readonly unknown[], files: Record<string, unknown>): string {
  // Lightweight fingerprint: element count + IDs + versions + file IDs
  const elPart = elements.map((el) => {
    const e = el as { id?: string; version?: number; isDeleted?: boolean };
    return `${e.id}:${e.version}:${e.isDeleted}`;
  }).join(",");
  const filePart = Object.keys(files).sort().join(",");
  return `${elPart}|${filePart}`;
}



interface WhiteboardData {
  id: string;
  name: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  version: number;
  featureId: string | null;
}

export default function WhiteboardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { slug } = useWorkspace();
  const whiteboardId = params.id as string;

  const [whiteboard, setWhiteboard] = useState<WhiteboardData | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onChangeSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const programmaticUpdateCountRef = useRef(1); // 1 for initial load
  const containerRef = useRef<HTMLDivElement>(null);
  const versionRef = useRef<number>(0);
  const resolvedFilesRef = useRef<BinaryFiles>({});
  const lastSavedSnapshotRef = useRef<string>("");
  const savePausedRef = useRef(false);
  const lastVersionSnapshotRef = useRef<Set<string>>(new Set());

  // Collaboration hook
  const {
    collaborators,
    excalidrawCollaborators,
    isConnected,
    broadcastElements,
    broadcastCursor,
    senderId,
  } = useWhiteboardCollaboration({
    whiteboardId,
    excalidrawAPI,
  });

  const loadWhiteboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/whiteboards/${whiteboardId}`);
      const data = await res.json();
      if (data.success) {
        setWhiteboard(data.data);
        setEditName(data.data.name);
        versionRef.current = data.data.version || 0;

        // Resolve stored S3 image references to presigned URLs
        const files = (data.data.files as Record<string, unknown>) || {};
        if (Object.keys(files).length > 0) {
          const resolved = await resolveFilesForDisplay(whiteboardId, files);
          resolvedFilesRef.current = resolved;
        }
        lastSavedSnapshotRef.current = computeSnapshot(
          data.data.elements || [],
          data.data.files || {}
        );

        // Initialise the version-snapshot baseline from the loaded elements
        const loadedElements = (data.data.elements || []) as Array<{ id?: string }>;
        lastVersionSnapshotRef.current = new Set(
          loadedElements.map((el) => el.id).filter(Boolean) as string[]
        );
      } else {
        router.push(`/w/${slug}/whiteboards`);
      }
    } catch (error) {
      console.error("Error loading whiteboard:", error);
      router.push(`/w/${slug}/whiteboards`);
    } finally {
      setLoading(false);
    }
  }, [whiteboardId, router, slug]);

  useEffect(() => {
    loadWhiteboard();
  }, [loadWhiteboard]);

  // Save to database (debounced)
  const saveToDatabase = useCallback(
    async (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles
    ) => {
      if (!whiteboard) return;

      // Skip save if nothing actually changed
      const snapshot = computeSnapshot(elements, files);
      if (snapshot === lastSavedSnapshotRef.current) return;

      // Clear any pending onChange save — a save is already in flight
      if (onChangeSaveTimeoutRef.current) {
        clearTimeout(onChangeSaveTimeoutRef.current);
        onChangeSaveTimeoutRef.current = null;
      }

      setSaving(true);
      setSaved(false);
      try {
        // Upload any new images to S3 before saving; store only s3Key refs in DB
        const cleanedFiles = await uploadNewFiles(whiteboard.id, files);

        const data = {
          elements,
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
            gridSize: appState.gridSize,
          },
          files: cleanedFiles,
          expectedVersion: versionRef.current,
          broadcast: false, // Don't broadcast again, we already did real-time
          senderId,
        };

        const res = await fetch(`/api/whiteboards/${whiteboard.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (res.status === 409) {
          const body = await res.json().catch(() => ({}));

          if (body.generating) {
            // Diagram generation in progress — keep local edits, Pusher will reload when done
            toast.warning("Diagram is being generated. Your edits will be saved after generation completes.");
            return;
          }

          if (body.stale && body.currentVersion != null) {
            // Version conflict — update version and retry once (files already uploaded)
            versionRef.current = body.currentVersion;
            const retryData = { ...data, expectedVersion: body.currentVersion };
            const retryRes = await fetch(`/api/whiteboards/${whiteboard.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(retryData),
            });

            if (retryRes.ok) {
              const retryResult = await retryRes.json();
              if (retryResult.data?.version) {
                versionRef.current = retryResult.data.version;
              }
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
            } else {
              toast.error("Could not save — please try again.");
            }
            return;
          }

          // Unknown 409 variant — keep local edits, log for debugging
          console.warn("Unhandled 409 response:", body);
          toast.error("Save conflict. Your edits are preserved — please try again.");
          return;
        }

        if (!res.ok) {
          throw new Error("Failed to save");
        }

        const result = await res.json();
        if (result.data?.version) {
          versionRef.current = result.data.version;
        }
        lastSavedSnapshotRef.current = snapshot;

        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (error) {
        console.error("Error saving whiteboard:", error);
      } finally {
        setSaving(false);
      }
    },
    [whiteboard, senderId]
  );

  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      // Skip programmatic updates (initial load, updateScene calls)
      if (programmaticUpdateCountRef.current > 0) {
        programmaticUpdateCountRef.current--;
        return;
      }

      // Broadcast immediately for real-time collaboration (100ms throttle in hook)
      broadcastElements(elements, appState);

      // Debounced save as fallback for keyboard-only edits (typing, copy/paste, undo/redo)
      if (onChangeSaveTimeoutRef.current) {
        clearTimeout(onChangeSaveTimeoutRef.current);
      }
      onChangeSaveTimeoutRef.current = setTimeout(() => {
        saveToDatabase(elements, appState, files);
      }, 2500);
    },
    [broadcastElements, saveToDatabase]
  );

  // Save on user interaction (pointerup) — never fires from programmatic updateScene
  const handlePointerUp = useCallback(() => {
    if (!excalidrawAPI) return;

    // Clear any previously scheduled save (both pointer and onChange)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (onChangeSaveTimeoutRef.current) {
      clearTimeout(onChangeSaveTimeoutRef.current);
      onChangeSaveTimeoutRef.current = null;
    }

    // Short debounce to batch rapid interactions
    saveTimeoutRef.current = setTimeout(() => {
      const elements = excalidrawAPI.getSceneElements();
      const appState = excalidrawAPI.getAppState();
      const files = excalidrawAPI.getFiles();
      saveToDatabase(elements, appState, files);
    }, 500);
  }, [excalidrawAPI, saveToDatabase]);

  // Attach pointerup listener to the canvas container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("pointerup", handlePointerUp);
    return () => {
      container.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerUp]);

  // Auto-snapshot: every 20s check if ≥3 elements have changed since last snapshot
  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (!whiteboard || !excalidrawAPI || savePausedRef.current) return;

      const currentElements = excalidrawAPI
        .getSceneElements()
        .filter((el) => !el.isDeleted);
      const currentIds = new Set(currentElements.map((el) => el.id));

      const changeCount = computeVersionChanges(currentIds, lastVersionSnapshotRef.current);
      if (changeCount < 3) return;

      const appState = excalidrawAPI.getAppState();
      const files = excalidrawAPI.getFiles();
      const label = new Date().toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

      try {
        const res = await fetch(`/api/whiteboards/${whiteboard.id}/versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            elements: currentElements,
            appState: {
              viewBackgroundColor: appState.viewBackgroundColor,
              gridSize: appState.gridSize,
            },
            files,
            label,
          }),
        });

        if (res.ok) {
          lastVersionSnapshotRef.current = currentIds;
        }
      } catch {
        // Silently ignore — versioning is best-effort
      }
    }, 20_000);

    return () => clearInterval(intervalId);
  }, [whiteboard, excalidrawAPI]);

  // Handle pointer/cursor updates for collaboration
  const handlePointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number }; button: string }) => {
      if (payload.pointer) {
        broadcastCursor(payload.pointer.x, payload.pointer.y);
      }
    },
    [broadcastCursor]
  );

  // Flush pending save on unmount, then clear timeouts
  useEffect(() => {
    return () => {
      const hasPendingSave = saveTimeoutRef.current || onChangeSaveTimeoutRef.current;

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (onChangeSaveTimeoutRef.current) {
        clearTimeout(onChangeSaveTimeoutRef.current);
        onChangeSaveTimeoutRef.current = null;
      }

      if (hasPendingSave && excalidrawAPI) {
        try {
          const elements = excalidrawAPI.getSceneElements();
          const appState = excalidrawAPI.getAppState();
          const files = excalidrawAPI.getFiles();
          const data = {
            elements,
            appState: {
              viewBackgroundColor: appState.viewBackgroundColor,
              gridSize: appState.gridSize,
            },
            files,
            expectedVersion: versionRef.current,
            broadcast: false,
            senderId,
          };

          // keepalive: true allows the request to survive page navigation
          fetch(`/api/whiteboards/${whiteboardId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
            keepalive: true,
          }).catch(() => {
            // Fire-and-forget — silently ignore errors on unmount
          });
        } catch {
          // Silently ignore — component is unmounting
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excalidrawAPI, whiteboardId, senderId]);

  // Inject resolved S3 image files into Excalidraw once the API is ready
  useEffect(() => {
    if (!excalidrawAPI) return;
    const resolved = resolvedFilesRef.current;
    if (Object.keys(resolved).length > 0) {
      excalidrawAPI.addFiles(Object.values(resolved));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excalidrawAPI]);

  // Update Excalidraw scene when whiteboard version changes (e.g. after diagram generation)
  useEffect(() => {
    if (whiteboard && excalidrawAPI && programmaticUpdateCountRef.current === 0) {
      programmaticUpdateCountRef.current++;
      excalidrawAPI.updateScene({
        elements: whiteboard.elements as readonly ExcalidrawElement[],
        appState: whiteboard.appState as unknown as AppState,
      });
      setTimeout(() => {
        excalidrawAPI.scrollToContent(undefined, {
          fitToViewport: true,
          viewportZoomFactor: 0.9,
          animate: true,
          duration: 300,
        });
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboard?.id, whiteboard?.version, excalidrawAPI]);

  const handleSaveName = async () => {
    if (!whiteboard || !editName.trim()) return;

    try {
      const res = await fetch(`/api/whiteboards/${whiteboard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });

      if (res.ok) {
        setWhiteboard((prev) =>
          prev ? { ...prev, name: editName.trim() } : null
        );
        setEditing(false);
      }
    } catch (error) {
      console.error("Error saving name:", error);
    }
  };

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // Handle Escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        <PageHeader title="Whiteboard" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!whiteboard) {
    return null;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push(`/w/${slug}/whiteboards`)}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            {editing ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8 w-48"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") {
                      setEditing(false);
                      setEditName(whiteboard.name);
                    }
                  }}
                />
                <Button variant="ghost" size="icon" onClick={handleSaveName}>
                  <Check className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditing(false);
                    setEditName(whiteboard.name);
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <button
                className="flex items-center gap-2 hover:text-primary transition-colors"
                onClick={() => setEditing(true)}
              >
                {whiteboard.name}
                <Pencil className="w-3 h-3 opacity-50" />
              </button>
            )}
          </div>
        }
        actions={
          <div className="flex items-center gap-3">
            {/* Collaborators */}
            <CollaboratorAvatars collaborators={collaborators} />

            {/* Connection status */}
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              {isConnected ? (
                <Wifi className="w-4 h-4 text-green-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-red-500" />
              )}
            </div>

            {/* Save status */}
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`w-2.5 h-2.5 rounded-full transition-colors ${saving ? "bg-amber-500 animate-pulse" : saved ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {saving ? "Saving..." : saved ? "Saved" : "No unsaved changes"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <WhiteboardVersionPanel
              whiteboardId={whiteboardId}
              onReloadWhiteboard={loadWhiteboard}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => excalidrawAPI?.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true, duration: 300 })}
              title="Zoom to fit"
              disabled={!excalidrawAPI}
            >
              <Scan className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </Button>
          </div>
        }
      />
      <div className="relative flex-1 overflow-hidden mt-4">
        <div
          ref={containerRef}
          className={
            isFullscreen
              ? "fixed inset-0 z-50 bg-white"
              : "w-full h-full border rounded-lg overflow-hidden bg-white"
          }
        >
          {isFullscreen && (
            <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => excalidrawAPI?.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true, duration: 300 })}
                title="Zoom to fit"
                disabled={!excalidrawAPI}
              >
                <Scan className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleFullscreen}
                title="Exit fullscreen"
              >
                <Minimize2 className="w-4 h-4" />
              </Button>
            </div>
          )}
          <Excalidraw
            excalidrawAPI={(api: ExcalidrawImperativeAPI) => setExcalidrawAPI(api)}
            initialData={{
              elements: whiteboard.elements as readonly ExcalidrawElement[],
              appState: getInitialAppState(whiteboard.appState as Partial<AppState>) as Partial<AppState>,
              files: resolvedFilesRef.current,
            }}
            onChange={handleChange}
            onPointerUpdate={handlePointerUpdate}
            isCollaborating={excalidrawCollaborators.size > 0}
            // @ts-expect-error - collaborators prop exists at runtime but not in types for v0.18
            collaborators={excalidrawCollaborators}
          />
        </div>
        {!isFullscreen && (
          <WhiteboardChatPanel
            whiteboardId={whiteboardId}
            featureId={whiteboard.featureId ?? null}
            excalidrawAPI={excalidrawAPI}
            onReloadWhiteboard={loadWhiteboard}
          />
        )}
      </div>
    </div>
  );
}
