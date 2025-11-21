"use client";

import React, { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "next-auth/react";
import type { WorkspaceResponse } from "@/types/workspace";
import { ErrorDisplay } from "@/components/ui/error-display";

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (workspace: WorkspaceResponse) => void;
}

export function CreateWorkspaceDialog({ open, onOpenChange, onCreated }: CreateWorkspaceDialogProps) {
  const { data: session } = useSession();
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    slug: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    // Validation
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) newErrors.name = "Name is required";
    if (!formData.slug.trim()) newErrors.slug = "Slug is required";
    // The session callback in nextauth.ts ensures user.id is present
    const userId = (session?.user as { id?: string })?.id;
    if (!userId) newErrors.ownerId = "User not authenticated";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim(),
          slug: formData.slug.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create workspace");
      onCreated?.(data.workspace);
      setFormData({ name: "", description: "", slug: "" });
      setErrors({});
      onOpenChange(false);
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData({ name: "", description: "", slug: "" });
    setErrors({});
    setApiError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Workspace</DialogTitle>
          <DialogDescription>Set up a new workspace. You can add more details later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Workspace Name</Label>
            <Input
              id="name"
              placeholder="e.g., My Team Workspace"
              value={formData.name}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  name: e.target.value,
                })
              }
              className={errors.name ? "border-destructive" : ""}
              disabled={loading}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              placeholder="e.g., my-team"
              value={formData.slug}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  slug: e.target.value,
                })
              }
              className={errors.slug ? "border-destructive" : ""}
              disabled={loading}
            />
            {errors.slug && <p className="text-sm text-destructive">{errors.slug}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe this workspace (optional)"
              value={formData.description}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  description: e.target.value,
                })
              }
              disabled={loading}
            />
          </div>
          <ErrorDisplay error={apiError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
