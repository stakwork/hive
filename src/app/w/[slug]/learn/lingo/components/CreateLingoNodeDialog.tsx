"use client";

import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { ImageIcon, X } from "lucide-react";
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

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

interface CreateLingoNodeDialogProps {
  workspaceSlug: string;
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (node: LingoNode) => void;
}

export function CreateLingoNodeDialog({
  workspaceSlug,
  workspaceId,
  isOpen,
  onClose,
  onCreated,
}: CreateLingoNodeDialogProps) {
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [lingoType, setLingoType] = useState<LingoType | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [iconPreviewUrl, setIconPreviewUrl] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleClose = () => {
    // Cleanup object URL to avoid memory leaks
    if (iconPreviewUrl) {
      URL.revokeObjectURL(iconPreviewUrl);
      setIconPreviewUrl(null);
    }
    setSelectedFile(null);
    setIconError(null);
    onClose();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input value so same file can be re-selected
    e.target.value = "";
    if (!file) return;

    // Client-side validation
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setIconError("Invalid file type. Please select a JPEG, PNG, GIF, or WebP image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setIconError("File is too large. Maximum size is 10 MB.");
      return;
    }

    setIconError(null);
    // Revoke previous preview URL
    if (iconPreviewUrl) URL.revokeObjectURL(iconPreviewUrl);
    setSelectedFile(file);
    setIconPreviewUrl(URL.createObjectURL(file));
  };

  const handleRemoveIcon = () => {
    if (iconPreviewUrl) URL.revokeObjectURL(iconPreviewUrl);
    setSelectedFile(null);
    setIconPreviewUrl(null);
    setIconError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Upload icon if selected
      let iconUrl: string | undefined;
      if (selectedFile && workspaceId) {
        // Step 1: Presign
        const presignRes = await fetch("/api/upload/presigned-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            filename: selectedFile.name,
            contentType: selectedFile.type,
            size: selectedFile.size,
            context: "lingo",
          }),
        });
        if (!presignRes.ok) {
          const err = await presignRes.json().catch(() => ({}));
          setError((err as { error?: string }).error ?? "Failed to get upload URL");
          return;
        }
        const { presignedUrl, s3Path } = (await presignRes.json()) as {
          presignedUrl: string;
          s3Path: string;
        };

        // Step 2: PUT to S3
        const putRes = await fetch(presignedUrl, {
          method: "PUT",
          headers: { "Content-Type": selectedFile.type },
          body: selectedFile,
        });
        if (!putRes.ok) {
          setError("Failed to upload icon. Please try again.");
          return;
        }

        iconUrl = s3Path;
      }

      // Step 3: Create the node
      const res = await fetch(`/api/workspaces/${workspaceSlug}/lingo/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          definition: definition.trim() || undefined,
          ...(lingoType ? { lingo_type: lingoType } : {}),
          ...(iconUrl ? { icon_url: iconUrl } : {}),
        }),
      });

      const json = await res.json() as {
        success: boolean;
        data?: { ref_id?: string; name: string; definition?: string; lingo_type?: LingoType; icon_url?: string | null };
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
        icon_url: json.data?.icon_url ?? iconUrl ?? null,
      };

      if (json.alreadyExists) {
        toast("A node with that name already exists — opening it");
      } else {
        toast.success("Lingo node created");
      }

      onCreated(node);
      handleClose();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
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

          {/* Icon picker */}
          <div className="flex flex-col gap-1.5">
            <Label>Icon <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
              data-testid="icon-file-input"
            />
            {iconPreviewUrl ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={iconPreviewUrl}
                  alt="Icon preview"
                  width={40}
                  height={40}
                  className="rounded object-cover border"
                  data-testid="icon-preview"
                />
                <button
                  type="button"
                  onClick={handleRemoveIcon}
                  disabled={isSubmitting}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                  data-testid="remove-icon-button"
                >
                  <X className="w-3.5 h-3.5" />
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
                className="flex items-center gap-2 text-sm text-muted-foreground border border-dashed rounded-lg px-3 py-2 hover:border-primary hover:text-primary transition-colors w-fit disabled:opacity-50"
                data-testid="add-icon-button"
              >
                <ImageIcon className="w-4 h-4" />
                Add icon
              </button>
            )}
            {iconError && (
              <p className="text-sm text-destructive" data-testid="icon-error">
                {iconError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
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
