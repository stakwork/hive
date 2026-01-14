"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
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
import { PenLine, Plus, ExternalLink, Unlink, Loader2, Save } from "lucide-react";
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
}

interface FeatureWhiteboardSectionProps {
  featureId: string;
  workspaceId: string;
  workspaceSlug: string;
}

export function FeatureWhiteboardSection({
  featureId,
  workspaceId,
  workspaceSlug,
}: FeatureWhiteboardSectionProps) {
  const router = useRouter();
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [whiteboard, setWhiteboard] = useState<WhiteboardData | null>(null);
  const [availableWhiteboards, setAvailableWhiteboards] = useState<WhiteboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadWhiteboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/whiteboards?featureId=${featureId}`);
      const data = await res.json();
      if (data.success && data.data) {
        setWhiteboard(data.data);
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

  const handleSave = async () => {
    if (!excalidrawAPI || !whiteboard) return;

    setSaving(true);
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
      };

      const res = await fetch(`/api/whiteboards/${whiteboard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        throw new Error("Failed to save");
      }
    } catch (error) {
      console.error("Error saving whiteboard:", error);
    } finally {
      setSaving(false);
    }
  };

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
        <div className="flex gap-2">
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
            onClick={() =>
              router.push(`/w/${workspaceSlug}/whiteboards/${whiteboard.id}`)
            }
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Full Screen
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save
          </Button>
        </div>
      </div>
      <Card className="h-[500px] overflow-hidden">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          initialData={{
            elements: (whiteboard.elements || []) as never,
            appState: whiteboard.appState as never,
          }}
        />
      </Card>
    </div>
  );
}
