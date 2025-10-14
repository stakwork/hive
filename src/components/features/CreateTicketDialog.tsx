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
import { useTicketMutations } from "@/hooks/useTicketMutations";
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

  const { createTicket, loading, error: apiError } = useTicketMutations();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    const newErrors: Record<string, string> = {};
    if (!formData.title.trim()) newErrors.title = "Title is required";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const ticket = await createTicket({
      featureId,
      phaseId,
      title: formData.title,
      description: formData.description,
      assigneeId: formData.assigneeId,
    });

    if (ticket) {
      onCreated?.(ticket);
      setFormData({ title: "", description: "", assigneeId: null });
      setErrors({});
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    setFormData({ title: "", description: "", assigneeId: null });
    setErrors({});
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
              onSelect={async (assigneeId) =>
                setFormData({ ...formData, assigneeId })
              }
              showSpecialAssignees={true}
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
