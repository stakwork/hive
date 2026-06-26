"use client";

import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LingoNode } from "@/app/api/mock/lingo/nodes";
import { LINGO_TYPES, type LingoType } from "@/lib/constants/lingo";

interface CreateLingoNodeDialogProps {
  workspaceSlug: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (node: LingoNode) => void;
}

export function CreateLingoNodeDialog({
  workspaceSlug,
  isOpen,
  onClose,
  onCreated,
}: CreateLingoNodeDialogProps) {
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [lingoType, setLingoType] = useState<LingoType | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setDefinition("");
      setLingoType("");
      setError(null);
      setIsSubmitting(false);
      // Autofocus name input
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/lingo/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          definition: definition.trim() || undefined,
          ...(lingoType ? { lingo_type: lingoType } : {}),
        }),
      });

      const json = await res.json() as {
        success: boolean;
        data?: { ref_id?: string; name: string; definition?: string; lingo_type?: LingoType };
        alreadyExists?: boolean;
        error?: string;
      };

      if (!json.success) {
        setError(json.error ?? "Failed to create node");
        return;
      }

      const node: LingoNode = {
        ref_id: json.data?.ref_id ?? "",
        name: json.data?.name ?? trimmedName,
        definition: json.data?.definition,
        node_type: "Lingo",
        date_added_to_graph: Date.now() / 1000,
        lingo_type: lingoType || undefined,
      };

      if (json.alreadyExists) {
        toast("A node with that name already exists — opening it");
      } else {
        toast.success("Lingo node created");
      }

      onCreated(node);
      onClose();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="create-lingo-node-dialog">
        <DialogHeader>
          <DialogTitle>New Lingo Node</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lingo-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="lingo-name"
              ref={nameInputRef}
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              placeholder="e.g. Pod Orchestration"
              disabled={isSubmitting}
              data-testid="lingo-name-input"
            />
            {error && (
              <p className="text-sm text-destructive" data-testid="lingo-create-error">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lingo-definition">Definition <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              id="lingo-definition"
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              placeholder="Describe what this term means in your workspace context…"
              rows={3}
              disabled={isSubmitting}
              data-testid="lingo-definition-input"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lingo-type">Type <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select
              value={lingoType}
              onValueChange={(val) => setLingoType(val as LingoType)}
              disabled={isSubmitting}
            >
              <SelectTrigger id="lingo-type" data-testid="lingo-type-select">
                <SelectValue placeholder="Select a type…" />
              </SelectTrigger>
              <SelectContent>
                {LINGO_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              data-testid="lingo-create-submit"
            >
              {isSubmitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
