"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { HelpCircle, Loader2, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface BountyRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceTaskId: string;
  sourceWorkspaceSlug: string;
  sourceTaskTitle: string;
  sourceTaskDescription?: string | null;
}

export function BountyRequestModal({
  isOpen,
  onClose,
  sourceTaskId,
  sourceWorkspaceSlug,
  sourceTaskTitle,
  sourceTaskDescription,
}: BountyRequestModalProps) {
  const router = useRouter();
  const [title, setTitle] = useState(sourceTaskTitle);
  const [description, setDescription] = useState(sourceTaskDescription || "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update title when source task title changes
  useEffect(() => {
    setTitle(sourceTaskTitle);
  }, [sourceTaskTitle]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle(sourceTaskTitle);
      setDescription(sourceTaskDescription || "");
    }
  }, [isOpen, sourceTaskTitle, sourceTaskDescription]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/bounty-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          sourceTaskId,
          sourceWorkspaceSlug,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create bounty request");
      }

      const result = await response.json();

      // Close modal
      onClose();

      // Open Sphinx Tribes URL in new tab
      if (result.bountyUrl) {
        window.open(result.bountyUrl, "_blank");
      }

      // Navigate to new task in leetbox workspace
      if (result.taskId) {
        router.push(`/w/leetbox/task/${result.taskId}`);
      }

      toast.success("Bounty request created successfully");
    } catch (error) {
      console.error("Error creating bounty request:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create bounty request");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5" />
            Need Help?
          </DialogTitle>
          <DialogDescription>
            Create a bounty request for human assistance
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="bounty-title" className="text-sm font-medium">
              Title
            </Label>
            <Input
              id="bounty-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of what you need help with"
              disabled={isSubmitting}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="bounty-description" className="text-sm font-medium">
              Description
            </Label>
            <Textarea
              id="bounty-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide more details about the help you need..."
              className="min-h-[120px] resize-none"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Describe the problem, expected outcome, and any relevant context
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !title.trim()}>
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <ExternalLink className="w-4 h-4 mr-2" />
                Create Bounty
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
