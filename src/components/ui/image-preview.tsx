"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ImagePreviewProps {
  content: string | null;
  className?: string;
  onRemoveImage?: (url: string) => void;
}

interface ImageInfo {
  url: string;
  alt: string;
}

export function ImagePreview({ content, className, onRemoveImage }: ImagePreviewProps) {
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!content) {
      setImages([]);
      return;
    }

    // Extract all markdown images: ![alt](url)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const foundImages: ImageInfo[] = [];
    let match;

    while ((match = imageRegex.exec(content)) !== null) {
      foundImages.push({
        alt: match[1] || "Image",
        url: match[2],
      });
    }

    setImages(foundImages);
    // Reset loaded state when images change
    setLoadedImages(new Set());
    setFailedImages(new Set());
  }, [content]);

  const handleImageLoad = (url: string) => {
    setLoadedImages((prev) => new Set([...prev, url]));
  };

  const handleImageError = (url: string) => {
    setFailedImages((prev) => new Set([...prev, url]));
  };

  const handleRemove = (url: string) => {
    if (onRemoveImage) {
      onRemoveImage(url);
    }
  };

  if (images.length === 0) {
    return null;
  }

  return (
    <div className={cn("mt-3 space-y-2", className)}>
      <div className="text-xs text-muted-foreground font-medium">
        Uploaded Images ({images.length})
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {images.map((image, index) => (
          <div
            key={`${image.url}-${index}`}
            className="relative group rounded-lg border border-border overflow-hidden bg-muted/30"
          >
            {/* Loading state */}
            {!loadedImages.has(image.url) && !failedImages.has(image.url) && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}

            {/* Error state */}
            {failedImages.has(image.url) && (
              <div className="aspect-video flex items-center justify-center bg-muted text-xs text-muted-foreground p-2 text-center">
                Failed to load image
              </div>
            )}

            {/* Image */}
            {!failedImages.has(image.url) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.url}
                alt={image.alt}
                className={cn(
                  "w-full h-auto object-cover aspect-video transition-opacity duration-200",
                  loadedImages.has(image.url) ? "opacity-100" : "opacity-0"
                )}
                onLoad={() => handleImageLoad(image.url)}
                onError={() => handleImageError(image.url)}
                loading="lazy"
              />
            )}

            {/* Remove button (only show if onRemoveImage is provided) */}
            {onRemoveImage && (
              <Button
                size="sm"
                variant="destructive"
                className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRemove(image.url)}
                title="Remove image"
              >
                <X className="h-3 w-3" />
              </Button>
            )}

            {/* Image alt text tooltip */}
            {image.alt && (
              <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-1.5 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                {image.alt}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
