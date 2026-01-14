"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Loader2, ArrowLeft, Pencil, Check, X } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false }
);

interface WhiteboardData {
  id: string;
  name: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export default function WhiteboardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { slug } = useWorkspace();
  const whiteboardId = params.id as string;

  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [whiteboard, setWhiteboard] = useState<WhiteboardData | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

  const loadWhiteboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/whiteboards/${whiteboardId}`);
      const data = await res.json();
      if (data.success) {
        setWhiteboard(data.data);
        setEditName(data.data.name);
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
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save
          </Button>
        }
      />
      <div className="flex-1 mt-4 border rounded-lg overflow-hidden">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          initialData={{
            elements: (whiteboard.elements || []) as never,
            appState: whiteboard.appState as never,
          }}
        />
      </div>
    </div>
  );
}
