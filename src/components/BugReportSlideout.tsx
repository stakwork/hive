"use client";

import React, { useState, useEffect } from "react";
import { X, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

interface BugReportSlideoutProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
];

export function BugReportSlideout({
  open,
  onOpenChange,
}: BugReportSlideoutProps) {
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const { workspace } = useWorkspace();
  const { data: session } = useSession();

  // Cleanup preview URL when file changes or component unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return "Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "File size exceeds 10MB limit.";
    }
    return null;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const error = validateFile(file);
    if (error) {
      toast.error(error);
      e.target.value = ""; // Reset input
      return;
    }

    // Clean up previous preview URL
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleRemoveFile = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
  };

  const resetForm = () => {
    setDescription("");
    handleRemoveFile();
    setIsSubmitting(false);
  };

  // Drag-and-drop handlers
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the container itself
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleImageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    // Filter to only image files
    const imageFiles = Array.from(files).filter((file) =>
      ALLOWED_IMAGE_TYPES.includes(file.type)
    );

    if (imageFiles.length === 0) {
      toast.error("Please drop an image file (JPEG, PNG, GIF, or WebP)");
      return;
    }

    if (imageFiles.length > 1) {
      toast.error("Please drop only one image at a time");
    }

    // Use the first image file
    const file = imageFiles[0];
    const error = validateFile(file);
    if (error) {
      toast.error(error);
      return;
    }

    // Clean up previous preview URL
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (description.trim().length < 10) {
      toast.error("Description must be at least 10 characters.");
      return;
    }

    if (!workspace) {
      toast.error("No workspace selected.");
      return;
    }

    setIsSubmitting(true);

    try {
      const currentUrl = window.location.href;

      // Step 1: Create Feature
      const featureResponse = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Bug Report: ${description.substring(0, 50)}${description.length > 50 ? "..." : ""}`,
          workspaceId: workspace.id,
          status: "BACKLOG",
          priority: "HIGH",
          brief: `**Reported from:** ${currentUrl}\n\n${description}`,
        }),
      });

      if (!featureResponse.ok) {
        const error = await featureResponse.json();
        throw new Error(error.message || "Failed to create bug report");
      }

      const featureResult = await featureResponse.json();
      const feature = featureResult.data;

      // Step 2: If screenshot attached, upload it
      if (selectedFile && feature?.id) {
        try {
          // Get presigned upload URL
          const uploadResponse = await fetch("/api/upload/image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              featureId: feature.id,
              filename: selectedFile.name,
              contentType: selectedFile.type,
              size: selectedFile.size,
            }),
          });

          if (!uploadResponse.ok) {
            const error = await uploadResponse.json();
            throw new Error(error.message || "Failed to get upload URL");
          }

          const { presignedUrl, publicUrl } = await uploadResponse.json();

          // Upload file to S3
          const s3Response = await fetch(presignedUrl, {
            method: "PUT",
            body: selectedFile,
            headers: {
              "Content-Type": selectedFile.type,
            },
          });

          if (!s3Response.ok) {
            throw new Error("Failed to upload screenshot to S3");
          }

          // Update feature brief with image
          const updateResponse = await fetch(`/api/features/${feature.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              brief: `![Bug Screenshot](${publicUrl})\n\n**Reported from:** ${currentUrl}\n\n${description}`,
            }),
          });

          if (!updateResponse.ok) {
            const error = await updateResponse.json();
            throw new Error(
              error.message || "Failed to update feature with screenshot"
            );
          }
        } catch (uploadError) {
          // Feature was created but image upload failed
          console.error("Image upload error:", uploadError);
          toast.error(
            uploadError instanceof Error
              ? uploadError.message
              : "Failed to upload screenshot, but bug report was created."
          );
          // Still close and reset since the bug report was created
          resetForm();
          onOpenChange(false);
          return;
        }
      }

      // Success!
      toast.success("Bug report submitted. Thank you for helping us improve!");
      resetForm();
      onOpenChange(false);
    } catch (error) {
      console.error("Bug report submission error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to submit bug report"
      );
      // Keep slideout open on error
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDescriptionValid = description.trim().length >= 10;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Report a Bug</SheetTitle>
          <SheetDescription>
            Help us improve by reporting issues you encounter
          </SheetDescription>
        </SheetHeader>

        <div className="px-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-4">
            {/* Description Field */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="bug-description">
                Bug Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="bug-description"
                placeholder="Describe the issue you encountered..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                required
                className="resize-none"
                data-testid="bug-description-textarea"
              />
              <p className="text-xs text-muted-foreground">
                Minimum 10 characters ({description.length}/10)
              </p>
            </div>

            {/* Screenshot Upload */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="bug-screenshot">Screenshot (optional)</Label>
              {!selectedFile ? (
                <div
                  className="relative"
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleImageDrop}
                  data-testid="bug-screenshot-dropzone"
                >
                  <input
                    id="bug-screenshot"
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                    onChange={handleFileSelect}
                    className="hidden"
                    data-testid="bug-screenshot-input"
                  />
                  <label htmlFor="bug-screenshot">
                    <div
                      className={cn(
                        "border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors",
                        isDragging
                          ? "border-primary bg-primary/10"
                          : "border-muted-foreground/25 hover:border-muted-foreground/50"
                      )}
                    >
                      <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {isDragging
                          ? "Drop image here"
                          : "Click to upload or drag and drop"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        JPEG, PNG, GIF, WebP (max 10MB)
                      </p>
                    </div>
                  </label>
                </div>
              ) : (
                <div className="relative border rounded-md p-2">
                  <div className="flex items-start gap-2">
                    {previewUrl && (
                      <img
                        src={previewUrl}
                        alt="Screenshot preview"
                        className="w-20 h-20 object-cover rounded"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleRemoveFile}
                      className="shrink-0"
                      data-testid="remove-screenshot-button"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={!isDescriptionValid || isSubmitting}
              className="w-full"
              data-testid="submit-bug-report-button"
            >
              {isSubmitting && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {isSubmitting ? "Submitting..." : "Submit Bug Report"}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
