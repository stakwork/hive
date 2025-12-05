"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RefreshCw, Pencil } from "lucide-react";

interface CreateFeatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  onFeatureCreated?: () => void;
}

export function CreateFeatureModal({ isOpen, onClose, workspaceSlug, onFeatureCreated }: CreateFeatureModalProps) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditingDescription, setIsEditingDescription] = useState(false);

  const getTemplateText = () => {
    const featureName = name.trim() || "this feature";
    return `Please return to me documentation (in markdown format) of how ${featureName} works in this repo. Include a list of the key files pertaining to this feature.`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const finalPrompt = isEditingDescription ? prompt : getTemplateText();

    if (!name.trim() || !finalPrompt.trim()) {
      setError("Please fill in all fields");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/learnings/features/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspace: workspaceSlug,
          name: name.trim(),
          prompt: finalPrompt.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create feature");
      }

      const data = await response.json();

      if (data.success) {
        // Success!
        onFeatureCreated?.();
        handleClose();
      } else {
        throw new Error("Unexpected response format");
      }
    } catch (err) {
      console.error("Error creating feature:", err);
      setError(err instanceof Error ? err.message : "Failed to create feature");
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (isCreating) return; // Don't allow closing while creating
    setName("");
    setPrompt("");
    setError(null);
    setIsEditingDescription(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Feature</DialogTitle>
          <DialogDescription>
            Generate documentation for a specific feature or concept in your codebase. This process can take a few
            minutes.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="name" className="text-sm font-medium">
                Feature Name
              </label>
              <Input
                id="name"
                placeholder="e.g., Authentication System"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isCreating}
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="prompt" className="text-sm font-medium">
                  Description
                </label>
                {!isEditingDescription && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => {
                      setPrompt(getTemplateText());
                      setIsEditingDescription(true);
                    }}
                    disabled={isCreating}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
              {isEditingDescription ? (
                <Textarea
                  id="prompt"
                  placeholder="What would you like to know about this feature?"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={isCreating}
                  className="min-h-24"
                />
              ) : (
                <div className="rounded-md border border-input bg-background px-3 py-2 text-sm min-h-24 text-foreground/70">
                  Please document how{" "}
                  <span className={name.trim() ? "text-foreground" : ""}>{name.trim() || "the feature"}</span>{" "}
                  {name.trim() && name.trim().endsWith("s") ? "work" : "works"} in this repo. Include a list of the key
                  files pertaining to this feature.
                </div>
              )}
            </div>

            {error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>}

            {isCreating && (
              <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                This may take a few minutes while we analyze your codebase...
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isCreating}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || !name.trim()}>
              {isCreating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
