"use client";

import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface CreateDiagramModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  onDiagramCreated: () => void;
  editMode?: boolean;
  diagramId?: string;
  initialName?: string;
}

export function CreateDiagramModal({
  isOpen,
  onClose,
  workspaceSlug,
  onDiagramCreated,
  editMode = false,
  diagramId,
  initialName,
}: CreateDiagramModalProps) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (isCreating) return;
    setName("");
    setPrompt("");
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (!editMode && !name.trim()) return;

    setIsCreating(true);
    setError(null);

    try {
      let response: Response;
      if (editMode) {
        response = await fetch("/api/learnings/diagrams/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: workspaceSlug, diagramId, prompt: prompt.trim() }),
        });
      } else {
        response = await fetch("/api/learnings/diagrams/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: workspaceSlug, name: name.trim(), prompt: prompt.trim() }),
        });
      }

      const data = await response.json();

      if (!response.ok) {
        setError(data?.error ?? (editMode ? "Failed to edit diagram" : "Failed to create diagram"));
        return;
      }

      setName("");
      setPrompt("");
      onDiagramCreated();
      onClose();
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{editMode ? "Edit Diagram" : "New Diagram"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <label htmlFor="diagram-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="diagram-name"
              placeholder="e.g., Authentication Flow"
              value={editMode ? (initialName ?? "") : name}
              onChange={(e) => { if (!editMode) setName(e.target.value); }}
              disabled={isCreating || editMode}
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="diagram-prompt" className="text-sm font-medium">
              Prompt
            </label>
            <Textarea
              id="diagram-prompt"
              placeholder={editMode ? "Describe the changes you want to make..." : "Describe the diagram you want to generate..."}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isCreating}
              className="min-h-28"
            />
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </div>
          )}

          {isCreating && (
            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
              This may take a few minutes while we analyze your codebase...
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isCreating}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || (!editMode && !name.trim()) || !prompt.trim()}>
              {isCreating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  Generating...
                </>
              ) : (
                "Generate"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
