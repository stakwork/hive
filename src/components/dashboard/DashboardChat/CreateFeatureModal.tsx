"use client";

import { useState, useRef } from "react";
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
import { Image as ImageIcon, X } from "lucide-react";

interface CreateFeatureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (objective: string, imageData?: string) => void;
  isCreating: boolean;
}

export function CreateFeatureModal({
  open,
  onOpenChange,
  onSubmit,
  isCreating,
}: CreateFeatureModalProps) {
  const [objective, setObjective] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!objective.trim() || isCreating) return;
    onSubmit(objective.trim(), imageData || undefined);
  };

  const handleClose = () => {
    if (!isCreating) {
      setObjective("");
      setImageData(null);
      onOpenChange(false);
    }
  };

  const convertToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleFileSelect = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      return;
    }

    try {
      const base64 = await convertToBase64(file);
      setImageData(base64);
    } catch (error) {
      console.error("Error reading file:", error);
      alert("Failed to read image file");
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleRemoveImage = () => {
    setImageData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[525px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Feature</DialogTitle>
            <DialogDescription>
              Describe the objective or goal of this feature. Optionally attach a screenshot or design.
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

            <div className="grid gap-2">
              <Label>Screenshot (Optional)</Label>
              {!imageData ? (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Drag and drop an image here, or click to select
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileInput}
                    className="hidden"
                    disabled={isCreating}
                  />
                </div>
              ) : (
                <div className="relative border rounded-lg overflow-hidden">
                  <img
                    src={imageData}
                    alt="Preview"
                    className="w-full h-auto max-h-[200px] object-contain"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-8 w-8"
                    onClick={handleRemoveImage}
                    disabled={isCreating}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}
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
