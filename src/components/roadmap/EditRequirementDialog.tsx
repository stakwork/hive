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
import { X, Plus, Sparkles } from "lucide-react";
import { Requirement } from "./RoadmapContent";

interface EditRequirementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirement: Requirement;
  onUpdateRequirement: (requirement: Requirement) => void;
}

export function EditRequirementDialog({
  open,
  onOpenChange,
  requirement,
  onUpdateRequirement,
}: EditRequirementDialogProps) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    details: "",
    type: "functional" as Requirement["type"],
    priority: "medium" as Requirement["priority"],
    status: "draft" as Requirement["status"],
    source: "",
  });

  const [acceptanceCriteria, setAcceptanceCriteria] = useState<string[]>([""]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isAILoading, setIsAILoading] = useState(false);

  useEffect(() => {
    if (requirement) {
      setFormData({
        title: requirement.title,
        description: requirement.description,
        details: requirement.details || "",
        type: requirement.type,
        priority: requirement.priority,
        status: requirement.status,
        source: requirement.source || "",
      });
      setAcceptanceCriteria(
        requirement.acceptanceCriteria.length > 0
          ? requirement.acceptanceCriteria
          : [""],
      );
    }
  }, [requirement]);

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

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Update requirement
    onUpdateRequirement({
      ...requirement,
      title: formData.title.trim(),
      description: formData.description.trim(),
      details: formData.details.trim() || undefined,
      type: formData.type,
      priority: formData.priority,
      status: formData.status,
      acceptanceCriteria: acceptanceCriteria.filter(
        (criteria) => criteria.trim() !== "",
      ),
      source: formData.source.trim() || undefined,
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

  const fetchAIContext = async () => {
    setIsAILoading(true);
    // Simulate AI context fetching
    setTimeout(() => {
      const suggestions = [
        "Enhanced security protocols required",
        "Must comply with GDPR regulations",
        "Scalability to support 10x current load",
        "Integration with existing legacy systems",
      ];

      // Add AI-generated suggestions to acceptance criteria
      const newCriteria = [...acceptanceCriteria];
      suggestions.forEach((suggestion) => {
        if (!newCriteria.includes(suggestion)) {
          newCriteria.push(suggestion);
        }
      });
      setAcceptanceCriteria(newCriteria);
      setFormData((prev) => ({ ...prev, source: "AI-enhanced context" }));
      setIsAILoading(false);
    }, 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Requirement</DialogTitle>
          <DialogDescription>
            Update the requirement details and specifications.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 flex-1 overflow-y-auto"
        >
          <div className="space-y-2">
            <Label htmlFor="title">Requirement Title</Label>
            <Input
              id="title"
              placeholder="e.g., User Authentication Security"
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
              placeholder="Brief description of what this requirement covers..."
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

          <div className="space-y-2">
            <Label htmlFor="details">Detailed Specification</Label>
            <Textarea
              id="details"
              placeholder="Detailed technical or business specifications..."
              value={formData.details}
              onChange={(e) =>
                setFormData({ ...formData, details: e.target.value })
              }
              className="min-h-[100px]"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select
                value={formData.type}
                onValueChange={(value: Requirement["type"]) =>
                  setFormData({ ...formData, type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="functional">Functional</SelectItem>
                  <SelectItem value="non-functional">Non-Functional</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={formData.priority}
                onValueChange={(value: Requirement["priority"]) =>
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

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value: Requirement["status"]) =>
                  setFormData({ ...formData, status: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="implemented">Implemented</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Acceptance Criteria</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={fetchAIContext}
                  disabled={isAILoading}
                >
                  <Sparkles className="w-4 h-4 mr-1" />
                  {isAILoading ? "Fetching..." : "AI Context"}
                </Button>
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
            <Label htmlFor="source">Source</Label>
            <Input
              id="source"
              placeholder="e.g., Stakeholder meeting, AI-generated, User feedback"
              value={formData.source}
              onChange={(e) =>
                setFormData({ ...formData, source: e.target.value })
              }
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Update Requirement</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
