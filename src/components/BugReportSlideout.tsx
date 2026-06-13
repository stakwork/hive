"use client";

import React, { useState, useEffect } from "react";
import { X, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
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

interface SelectedFile {
  file: File;
  previewUrl: string;
}

export function BugReportSlideout({
  open,
  onOpenChange,
}: BugReportSlideoutProps) {
  const [description, setDescription] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const { workspace, slug } = useWorkspace();
  const router = useRouter();

  // Cleanup all preview URLs on unmount
  useEffect(() => {
    return () => {
      selectedFiles.forEach((sf) => URL.revokeObjectURL(sf.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return "Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "File size exceeds 10MB limit.";
    }
    return null;
  };

  const handleFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validEntries: SelectedFile[] = [];

    for (const file of fileArray) {
      const error = validateFile(file);
      if (error) {
        toast.error(`${file.name}: ${error}`);
        continue;
      }
      validEntries.push({ file, previewUrl: URL.createObjectURL(file) });
    }

    if (validEntries.length > 0) {
      setSelectedFiles((prev) => [...prev, ...validEntries]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    handleFiles(e.target.files);
    e.target.value = ""; // Reset so same files can be re-added if removed
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => {
      const entry = prev[index];
      if (entry) URL.revokeObjectURL(entry.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const resetForm = () => {
    setDescription("");
    selectedFiles.forEach((sf) => URL.revokeObjectURL(sf.previewUrl));
    setSelectedFiles([]);
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

    const imageFiles = Array.from(files).filter((file) =>
      ALLOWED_IMAGE_TYPES.includes(file.type)
    );

    if (imageFiles.length === 0) {
      toast.error("Please drop image files (JPEG, PNG, GIF, or WebP)");
      return;
    }

    handleFiles(imageFiles);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
      // Step 1: Create Feature
      const featureResponse = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Bug Report: ${description.substring(0, 50)}${description.length > 50 ? "..." : ""}`,
          workspaceId: workspace.id,
          status: "BACKLOG",
          priority: "HIGH",
        }),
      });

      if (!featureResponse.ok) {
        const error = await featureResponse.json();
        throw new Error(error.message || "Failed to create bug report");
      }

      const featureResult = await featureResponse.json();
      const feature = featureResult.data;

      // Step 2: Upload all screenshots sequentially, collect attachments
      const attachments: { path: string; filename: string; mimeType: string; size: number }[] = [];

      if (selectedFiles.length > 0 && feature?.id) {
        for (const { file } of selectedFiles) {
          try {
            const uploadResponse = await fetch("/api/upload/image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                featureId: feature.id,
                filename: file.name,
                contentType: file.type,
                size: file.size,
              }),
            });

            if (!uploadResponse.ok) {
              const error = await uploadResponse.json();
              throw new Error(error.message || "Failed to get upload URL");
            }

            const { presignedUrl, s3Path } = await uploadResponse.json();

            const s3Response = await fetch(presignedUrl, {
              method: "PUT",
              body: file,
              headers: { "Content-Type": file.type },
            });

            if (!s3Response.ok) {
              throw new Error(`Failed to upload ${file.name} to S3`);
            }

            attachments.push({
              path: s3Path,
              filename: file.name,
              mimeType: file.type,
              size: file.size,
            });
          } catch (uploadError) {
            console.error(`Image upload error for ${file.name}:`, uploadError);
            // Continue with remaining files
          }
        }
      }

      // Step 3: Send chat message to Plan Mode
      await fetch(`/api/features/${feature.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: description, attachments }),
      });

      // Step 4: Navigate to Plan Mode
      router.push(`/w/${slug}/plan/${feature.id}`);
      resetForm();
      onOpenChange(false);
    } catch (error) {
      console.error("Bug report submission error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to submit bug report"
      );
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
            Describe a bug in your codebase
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
                className="resize-none max-h-[300px] overflow-y-auto"
                data-testid="bug-description-textarea"
              />
              <p className="text-xs text-muted-foreground">
                Minimum 10 characters ({description.length}/10)
              </p>
            </div>

            {/* Screenshot Upload */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="bug-screenshot">Screenshots (optional)</Label>

              {/* Drop zone — always visible so users can add more files */}
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
                  multiple
                  className="hidden"
                  data-testid="bug-screenshot-input"
                />
                <label htmlFor="bug-screenshot">
                  <div
                    className={cn(
                      "border-2 border-dashed rounded-md p-4 text-center cursor-pointer transition-colors",
                      isDragging
                        ? "border-primary bg-primary/10"
                        : "border-muted-foreground/25 hover:border-muted-foreground/50"
                    )}
                  >
                    <Upload className="w-6 h-6 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {isDragging
                        ? "Drop images here"
                        : "Click to upload or drag and drop"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      JPEG, PNG, GIF, WebP (max 10MB each)
                    </p>
                  </div>
                </label>
              </div>

              {/* Thumbnail chips for selected files */}
              {selectedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {selectedFiles.map((sf, index) => (
                    <div
                      key={index}
                      className="relative flex items-center gap-2 border rounded-md p-1.5 bg-muted/30 max-w-full"
                    >
                      <img
                        src={sf.previewUrl}
                        alt={sf.file.name}
                        className="w-10 h-10 object-cover rounded shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate max-w-[120px]">
                          {sf.file.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(sf.file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveFile(index)}
                        className="shrink-0 h-6 w-6"
                        data-testid={`remove-screenshot-button-${index}`}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
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
