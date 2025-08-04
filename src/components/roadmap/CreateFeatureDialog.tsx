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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Feature } from "@/components/roadmap/RoadmapContent";

interface CreateFeatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateFeature: (
    feature: Omit<Feature, "id" | "createdAt" | "updatedAt">,
  ) => void;
}

export function CreateFeatureDialog({
  open,
  onOpenChange,
  onCreateFeature,
}: CreateFeatureDialogProps) {
  const [formData, setFormData] = useState({
    title: "",
    brief: "",
    status: "planning" as Feature["status"],
    priority: "medium" as Feature["priority"],
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    const newErrors: Record<string, string> = {};
    if (!formData.title.trim()) {
      newErrors.title = "Title is required";
    }
    if (!formData.brief.trim()) {
      newErrors.brief = "Brief description is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Create feature
    onCreateFeature({
      title: formData.title.trim(),
      brief: formData.brief.trim(),
      status: formData.status,
      priority: formData.priority,
      userStories: [],
      requirements: [],
    });

    // Reset form
    setFormData({
      title: "",
      brief: "",
      status: "planning",
      priority: "medium",
    });
    setErrors({});
  };

  const handleCancel = () => {
    setFormData({
      title: "",
      brief: "",
      status: "planning",
      priority: "medium",
    });
    setErrors({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Create New Feature</DialogTitle>
          <DialogDescription>
            Add a new feature to your roadmap. You can add user stories and
            requirements later.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Feature Title</Label>
            <Input
              id="title"
              placeholder="e.g., User Authentication System"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              className={errors.title ? "border-destructive" : ""}
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="brief">Brief Description</Label>
            <Textarea
              id="brief"
              placeholder="Provide a brief overview of what this feature does and why it's important..."
              value={formData.brief}
              onChange={(e) =>
                setFormData({ ...formData, brief: e.target.value })
              }
              className={`min-h-[100px] ${errors.brief ? "border-destructive" : ""}`}
            />
            {errors.brief && (
              <p className="text-sm text-destructive">{errors.brief}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value: Feature["status"]) =>
                  setFormData({ ...formData, status: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="on-hold">On Hold</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={formData.priority}
                onValueChange={(value: Feature["priority"]) =>
                  setFormData({ ...formData, priority: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit">Create Feature</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
