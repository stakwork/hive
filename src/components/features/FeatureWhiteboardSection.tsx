"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { PenLine, Plus, Maximize2, Minimize2, Unlink, Loader2, CheckCircle2, Wifi, WifiOff } from "lucide-react";
import { useWhiteboardCollaboration } from "@/hooks/useWhiteboardCollaboration";
import { CollaboratorAvatars } from "@/components/whiteboard/CollaboratorAvatars";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false }
);

interface WhiteboardItem {
  id: string;
  name: string;
  featureId: string | null;
}

interface WhiteboardData {
  id: string;
  name: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  version: number;
}

interface FeatureWhiteboardSectionProps {
  featureId: string;
  workspaceId: string;
}

export function FeatureWhiteboardSection({
  featureId,
  workspaceId,
}: FeatureWhiteboardSectionProps) {
  const [whiteboard, setWhiteboard] = useState<WhiteboardData | null>(null);
  const [availableWhiteboards, setAvailableWhiteboards] = useState<WhiteboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoadRef = useRef(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const versionRef = useRef<number>(0);

  // Collaboration hook
  const {
    collaborators,
    excalidrawCollaborators,
    isConnected,
    broadcastElements,
    broadcastCursor,
    senderId,
  } = useWhiteboardCollaboration({
    whiteboardId: whiteboard?.id || "",
    excalidrawAPI,
  });

  const loadWhiteboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/whiteboards?featureId=${featureId}`);
      const data = await res.json();
      if (data.success && data.data) {
        setWhiteboard(data.data);
        versionRef.current = data.data.version || 0;
      } else {
        setWhiteboard(null);
      }
    } catch (error) {
      console.error("Error loading whiteboard:", error);
    } finally {
      setLoading(false);
    }
  }, [featureId]);

  const loadAvailableWhiteboards = useCallback(async () => {
    try {
      const res = await fetch(`/api/whiteboards?workspaceId=${workspaceId}`);
      const data = await res.json();
      if (data.success) {
        // Filter to only unlinked whiteboards
        setAvailableWhiteboards(
          data.data.filter((wb: WhiteboardItem) => !wb.featureId)
        );
      }
    } catch (error) {
      console.error("Error loading whiteboards:", error);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadWhiteboard();
    loadAvailableWhiteboards();
  }, [loadWhiteboard, loadAvailableWhiteboards]);

  // Reset initial load flag when whiteboard changes
  useEffect(() => {
    isInitialLoadRef.current = true;
  }, [whiteboard?.id]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/whiteboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          featureId,
          name: "Architecture Diagram",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setWhiteboard(data.data);
        versionRef.current = data.data.version || 0;
      }
    } catch (error) {
      console.error("Error creating whiteboard:", error);
    } finally {
      setCreating(false);
    }
  };

  const handleLink = async (whiteboardId: string) => {
    setLinking(true);
    try {
      const res = await fetch(`/api/whiteboards/${whiteboardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId }),
      });
      const data = await res.json();
      if (data.success) {
        // Reload whiteboard data
        await loadWhiteboard();
        await loadAvailableWhiteboards();
      }
    } catch (error) {
      console.error("Error linking whiteboard:", error);
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async () => {
    if (!whiteboard) return;
    setLinking(true);
    try {
      const res = await fetch(`/api/whiteboards/${whiteboard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId: null }),
      });
      if (res.ok) {
        setWhiteboard(null);
        await loadAvailableWhiteboards();
      }
    } catch (error) {
      console.error("Error unlinking whiteboard:", error);
    } finally {
      setLinking(false);
    }
  };

  // Save to database (debounced)
  const saveToDatabase = useCallback(
    async (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles
    ) => {
      if (!whiteboard) return;

      setSaving(true);
      setSaved(false);
      try {
        const data = {
          elements,
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
            gridSize: appState.gridSize,
          },
          files,
          broadcast: false, // Don't broadcast again, we already did real-time
          senderId,
        };

        const res = await fetch(`/api/whiteboards/${whiteboard.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!res.ok) {
          throw new Error("Failed to save");
        }

        const result = await res.json();
        if (result.data?.version) {
          versionRef.current = result.data.version;
        }

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
      // Skip on initial load
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        return;
      }

      // Broadcast immediately for real-time collaboration (100ms throttle in hook)
      broadcastElements(elements, appState);

      // Clear existing save timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Debounce database save by 2 seconds
      saveTimeoutRef.current = setTimeout(() => {
        saveToDatabase(elements, appState, files);
      }, 2000);
    },
    [broadcastElements, saveToDatabase]
  );

  // Handle pointer/cursor updates for collaboration
  const handlePointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number }; button: string }) => {
      if (payload.pointer) {
        broadcastCursor(payload.pointer.x, payload.pointer.y);
      }
    },
    [broadcastCursor]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

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
      <div className="space-y-2">
        <Label className="text-base font-semibold">Whiteboard</Label>
        <Card className="h-64 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </Card>
      </div>
    );
  }

  if (!whiteboard) {
    return (
      <div className="space-y-2">
        <Label className="text-base font-semibold">Whiteboard</Label>
        <Card className="border-dashed p-6">
          <div className="text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <PenLine className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No whiteboard linked</p>
              <p className="text-xs text-muted-foreground">
                Create a new whiteboard or link an existing one
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                Create Whiteboard
              </Button>
              {availableWhiteboards.length > 0 && (
                <Select onValueChange={handleLink} disabled={linking}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Link existing..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableWhiteboards.map((wb) => (
                      <SelectItem key={wb.id} value={wb.id}>
                        {wb.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">Whiteboard</Label>
        <div className="flex items-center gap-2">
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

          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
            {saving && (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            )}
            {saved && !saving && (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>Saved</span>
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleUnlink}
            disabled={linking}
          >
            {linking ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Unlink className="w-4 h-4 mr-2" />
            )}
            Unlink
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
            title="Enter fullscreen"
          >
            <Maximize2 className="w-4 h-4 mr-2" />
            Full Screen
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className={
          isFullscreen
            ? "fixed inset-0 z-50 bg-white"
            : ""
        }
      >
        {isFullscreen && (
          <Button
            variant="outline"
            size="icon"
            onClick={toggleFullscreen}
            className="absolute top-4 right-4 z-50"
            title="Exit fullscreen"
          >
            <Minimize2 className="w-4 h-4" />
          </Button>
        )}
        <Card className={isFullscreen ? "h-full rounded-none border-0" : "h-[500px] overflow-hidden"}>
          <Excalidraw
            excalidrawAPI={(api) => setExcalidrawAPI(api)}
            initialData={{
              elements: (whiteboard.elements || []) as never,
              appState: whiteboard.appState as never,
            }}
            onChange={handleChange}
            onPointerUpdate={handlePointerUpdate}
            isCollaborating={excalidrawCollaborators.size > 0}
            collaborators={excalidrawCollaborators}
          />
        </Card>
      </div>
    </div>
  );
}
