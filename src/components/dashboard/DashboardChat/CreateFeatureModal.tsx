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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface CreateFeatureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (objective: string) => void;
  isCreating: boolean;
}

export function CreateFeatureModal({
  open,
  onOpenChange,
  onSubmit,
  isCreating,
}: CreateFeatureModalProps) {
  const [objective, setObjective] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!objective.trim() || isCreating) return;
    onSubmit(objective.trim());
  };

  const handleClose = () => {
    if (!isCreating) {
      setObjective("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[525px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Feature</DialogTitle>
            <DialogDescription>
              Describe the objective or goal of this feature. This will be used
              along with the conversation to generate a detailed feature specification.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="objective">Feature Objective</Label>
              <Textarea
                id="objective"
                placeholder="e.g., Add user authentication with OAuth providers"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                disabled={isCreating}
                rows={4}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!objective.trim() || isCreating}>
              {isCreating ? "Creating..." : "Create Feature"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
