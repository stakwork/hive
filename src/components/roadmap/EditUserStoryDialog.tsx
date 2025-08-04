"use client";

import React, { useState, useEffect } from "react";
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
import { X, Plus } from "lucide-react";
import { UserStory } from "./RoadmapContent";

interface EditUserStoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  story: UserStory;
  onUpdateStory: (story: UserStory) => void;
}

export function EditUserStoryDialog({
  open,
  onOpenChange,
  story,
  onUpdateStory,
}: EditUserStoryDialogProps) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    asA: "",
    iWant: "",
    soThat: "",
    priority: "medium" as UserStory["priority"],
  });

  const [acceptanceCriteria, setAcceptanceCriteria] = useState<string[]>([""]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (story) {
      setFormData({
        title: story.title,
        description: story.description,
        asA: story.asA,
        iWant: story.iWant,
        soThat: story.soThat,
        priority: story.priority,
      });
      setAcceptanceCriteria(
        story.acceptanceCriteria.length > 0 ? story.acceptanceCriteria : [""],
      );
    }
  }, [story]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    const newErrors: Record<string, string> = {};
    if (!formData.title.trim()) {
      newErrors.title = "Title is required";
    }
    if (!formData.description.trim()) {
      newErrors.description = "Description is required";
    }
    if (!formData.asA.trim()) {
      newErrors.asA = "User role is required";
    }
    if (!formData.iWant.trim()) {
      newErrors.iWant = "User goal is required";
    }
    if (!formData.soThat.trim()) {
      newErrors.soThat = "User benefit is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Update story
    onUpdateStory({
      ...story,
      title: formData.title.trim(),
      description: formData.description.trim(),
      asA: formData.asA.trim(),
      iWant: formData.iWant.trim(),
      soThat: formData.soThat.trim(),
      acceptanceCriteria: acceptanceCriteria.filter(
        (criteria) => criteria.trim() !== "",
      ),
      priority: formData.priority,
    });

    setErrors({});
  };

  const addCriteria = () => {
    setAcceptanceCriteria([...acceptanceCriteria, ""]);
  };

  const removeCriteria = (index: number) => {
    if (acceptanceCriteria.length > 1) {
      setAcceptanceCriteria(acceptanceCriteria.filter((_, i) => i !== index));
    }
  };

  const updateCriteria = (index: number, value: string) => {
    const updated = [...acceptanceCriteria];
    updated[index] = value;
    setAcceptanceCriteria(updated);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit User Story</DialogTitle>
          <DialogDescription>
            Update the user story details and requirements.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 flex-1 overflow-y-auto"
        >
          <div className="space-y-2">
            <Label htmlFor="title">Story Title</Label>
            <Input
              id="title"
              placeholder="e.g., User can login with Google"
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
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Brief description of what this story accomplishes..."
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              className={`min-h-[80px] ${errors.description ? "border-destructive" : ""}`}
            />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description}</p>
            )}
          </div>

          <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
            <h4 className="font-medium">User Story Structure</h4>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="asA">As a...</Label>
                <Input
                  id="asA"
                  placeholder="user, admin, customer, etc."
                  value={formData.asA}
                  onChange={(e) =>
                    setFormData({ ...formData, asA: e.target.value })
                  }
                  className={errors.asA ? "border-destructive" : ""}
                />
                {errors.asA && (
                  <p className="text-sm text-destructive">{errors.asA}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="iWant">I want...</Label>
                <Input
                  id="iWant"
                  placeholder="what the user wants to do"
                  value={formData.iWant}
                  onChange={(e) =>
                    setFormData({ ...formData, iWant: e.target.value })
                  }
                  className={errors.iWant ? "border-destructive" : ""}
                />
                {errors.iWant && (
                  <p className="text-sm text-destructive">{errors.iWant}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="soThat">So that...</Label>
                <Input
                  id="soThat"
                  placeholder="the benefit or value the user gets"
                  value={formData.soThat}
                  onChange={(e) =>
                    setFormData({ ...formData, soThat: e.target.value })
                  }
                  className={errors.soThat ? "border-destructive" : ""}
                />
                {errors.soThat && (
                  <p className="text-sm text-destructive">{errors.soThat}</p>
                )}
              </div>
            </div>

            {formData.asA && formData.iWant && formData.soThat && (
              <div className="p-3 bg-background border rounded-md">
                <p className="text-sm">
                  <span className="font-medium">As a</span> {formData.asA},{" "}
                  <span className="font-medium">I want</span> {formData.iWant},{" "}
                  <span className="font-medium">so that</span> {formData.soThat}
                  .
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Acceptance Criteria</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCriteria}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>

            <div className="space-y-2">
              {acceptanceCriteria.map((criteria, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder={`Acceptance criteria ${index + 1}`}
                    value={criteria}
                    onChange={(e) => updateCriteria(index, e.target.value)}
                  />
                  {acceptanceCriteria.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => removeCriteria(index)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Select
              value={formData.priority}
              onValueChange={(value: UserStory["priority"]) =>
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Update Story</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
