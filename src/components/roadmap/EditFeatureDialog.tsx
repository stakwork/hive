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
import { Feature } from "./RoadmapContent";

interface EditFeatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: Feature;
  onUpdateFeature: (feature: Feature) => void;
}

export function EditFeatureDialog({
  open,
  onOpenChange,
  feature,
  onUpdateFeature,
}: EditFeatureDialogProps) {
  const [formData, setFormData] = useState({
    title: feature.title,
    brief: feature.brief,
    status: feature.status,
    priority: feature.priority,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = "Title is required";
    }

    if (!formData.brief.trim()) {
      newErrors.brief = "Brief description is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const updatedFeature: Feature = {
      ...feature,
      ...formData,
      updatedAt: new Date(),
    };

    onUpdateFeature(updatedFeature);
    onOpenChange(false);
  };

  const resetForm = () => {
    setFormData({
      title: feature.title,
      brief: feature.brief,
      status: feature.status,
      priority: feature.priority,
    });
    setErrors({});
  };

  const handleCancel = () => {
    resetForm();
    onOpenChange(false);
  };

  // Reset form when feature changes
  React.useEffect(() => {
    setFormData({
      title: feature.title,
      brief: feature.brief,
      status: feature.status,
      priority: feature.priority,
    });
    setErrors({});
  }, [feature]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Edit Feature</DialogTitle>
          <DialogDescription>
            Update the feature details. Changes will be saved immediately.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">Feature Title</Label>
            <Input
              id="edit-title"
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
            <Label htmlFor="edit-brief">Feature Brief</Label>
            <Textarea
              id="edit-brief"
              placeholder="Describe what this feature will accomplish..."
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
              <Label htmlFor="edit-status">Status</Label>
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
              <Label htmlFor="edit-priority">Priority</Label>
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
            <Button type="submit">Update Feature</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
