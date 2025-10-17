"use client";

import { useState, useRef, useEffect } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Image as ImageIcon, Upload, Trash2, Loader2 } from "lucide-react";
import Image from "next/image";

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function WorkspaceImageUpload() {
  const { workspace, slug, refreshCurrentWorkspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();
  const { toast } = useToast();

  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load current workspace image
  useEffect(() => {
    if (!workspace || !slug) return;

    const loadImage = async () => {
      setIsLoadingImage(true);
      try {
        const response = await fetch(`/api/workspaces/${slug}/image`);
        if (response.ok) {
          const data = await response.json();
          setCurrentImageUrl(data.imageUrl);
        }
      } catch (error) {
        console.error("Error loading workspace image:", error);
      } finally {
        setIsLoadingImage(false);
      }
    };

    loadImage();
  }, [workspace, slug]);

  if (!workspace || !canAdmin) {
    return null;
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Invalid file type",
        description: "Please select a JPEG, PNG, GIF, or WebP image",
      });
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: "Image must be less than 5MB",
      });
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !slug) return;

    setIsUploading(true);

    try {
      // Step 1: Get pre-signed upload URL
      const uploadUrlResponse = await fetch(
        `/api/workspaces/${slug}/image/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: selectedFile.type,
            filename: selectedFile.name,
            fileSize: selectedFile.size,
          }),
        }
      );

      if (!uploadUrlResponse.ok) {
        const error = await uploadUrlResponse.json();
        throw new Error(error.error || "Failed to get upload URL");
      }

      const { uploadUrl, s3Key } = await uploadUrlResponse.json();

      // Step 2: Upload directly to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": selectedFile.type },
        body: selectedFile,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload image to S3");
      }

      // Step 3: Confirm upload with backend
      const confirmResponse = await fetch(
        `/api/workspaces/${slug}/image/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ s3Key }),
        }
      );

      if (!confirmResponse.ok) {
        const error = await confirmResponse.json();
        throw new Error(error.error || "Failed to confirm upload");
      }

      toast({
        title: "Success",
        description: "Workspace image uploaded successfully",
      });

      // Refresh to get new image
      setSelectedFile(null);
      setPreviewUrl(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await refreshCurrentWorkspace();

      // Reload image
      const response = await fetch(`/api/workspaces/${slug}/image`);
      if (response.ok) {
        const data = await response.json();
        setCurrentImageUrl(data.imageUrl);
      }
    } catch (error) {
      console.error("Error uploading image:", error);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload image",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!slug) return;

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/workspaces/${slug}/image`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete image");
      }

      toast({
        title: "Success",
        description: "Workspace image deleted successfully",
      });

      setCurrentImageUrl(null);
      await refreshCurrentWorkspace();
    } catch (error) {
      console.error("Error deleting image:", error);
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Failed to delete image",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5" />
          Workspace Image
        </CardTitle>
        <CardDescription>
          Upload a custom image for your workspace (max 5MB)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current or Preview Image */}
        {(currentImageUrl || previewUrl) && (
          <div className="relative w-full h-48 bg-muted rounded-lg overflow-hidden">
            {isLoadingImage ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Image
                src={previewUrl || currentImageUrl || ""}
                alt="Workspace"
                fill
                className="object-cover"
                unoptimized={!!previewUrl}
              />
            )}
          </div>
        )}

        {/* File Input */}
        {!selectedFile && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_TYPES.join(",")}
              onChange={handleFileSelect}
              className="hidden"
              id="workspace-image-input"
            />
            <label htmlFor="workspace-image-input">
              <Button
                variant="outline"
                className="w-full"
                asChild
                disabled={isUploading || isDeleting}
              >
                <span className="flex items-center gap-2 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  {currentImageUrl ? "Change Image" : "Upload Image"}
                </span>
              </Button>
            </label>
            <p className="text-xs text-muted-foreground mt-2">
              Accepts JPEG, PNG, GIF, WebP (max 5MB)
            </p>
          </div>
        )}

        {/* Upload/Cancel Buttons */}
        {selectedFile && (
          <div className="flex gap-2">
            <Button
              onClick={handleUpload}
              disabled={isUploading}
              className="flex-1"
            >
              {isUploading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isUploading}
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Delete Button */}
        {currentImageUrl && !selectedFile && (
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
            className="w-full"
          >
            {isDeleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Trash2 className="w-4 h-4 mr-2" />
            {isDeleting ? "Deleting..." : "Delete Image"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
