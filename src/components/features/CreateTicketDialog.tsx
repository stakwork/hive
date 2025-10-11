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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import type { TicketListItem } from "@/types/roadmap";

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phaseId: string;
  featureId: string;
  workspaceSlug: string;
  onCreated?: (ticket: TicketListItem) => void;
}

export function CreateTicketDialog({
  open,
  onOpenChange,
  phaseId,
  featureId,
  workspaceSlug,
  onCreated,
}: CreateTicketDialogProps) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    assigneeId: null as string | null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    // Validation
    const newErrors: Record<string, string> = {};
    if (!formData.title.trim()) newErrors.title = "Title is required";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/features/${featureId}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formData.title.trim(),
          description: formData.description.trim() || undefined,
          phaseId,
          assigneeId: formData.assigneeId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create ticket");
      }

      const result = await response.json();
      if (result.success) {
        onCreated?.(result.data);
        setFormData({ title: "", description: "", assigneeId: null });
        setErrors({});
        onOpenChange(false);
      }
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData({ title: "", description: "", assigneeId: null });
    setErrors({});
    setApiError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Ticket</DialogTitle>
          <DialogDescription>
            Add a new ticket to this phase.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Enter ticket title..."
              value={formData.title}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  title: e.target.value,
                })
              }
              className={errors.title ? "border-destructive" : ""}
              disabled={loading}
              autoFocus
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe this ticket (optional)"
              value={formData.description}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  description: e.target.value,
                })
              }
              disabled={loading}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>Assignee</Label>
            <AssigneeCombobox
              workspaceSlug={workspaceSlug}
              currentAssignee={null}
              onSelect={(assigneeId) =>
                setFormData({ ...formData, assigneeId })
              }
            />
          </div>

          {apiError && (
            <p className="text-sm text-destructive">{apiError}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
