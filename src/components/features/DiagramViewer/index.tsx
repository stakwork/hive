"use client";

import React, { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, FileImage } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface DiagramViewerProps {
  diagramUrl: string | null;
  isGenerating: boolean;
}

export function DiagramViewer({ diagramUrl, isGenerating }: DiagramViewerProps) {
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Show skeleton loader during generation
  if (isGenerating) {
    return (
      <div className="w-full space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  // Show placeholder when no diagram exists
  if (!diagramUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 border-2 border-dashed border-border rounded-lg">
        <FileImage className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">No diagram generated yet</p>
      </div>
    );
  }

  // Show error state if image failed to load
  if (imageError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load diagram. The image may be corrupted or unavailable.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="w-full space-y-2">
      <h3 className="text-sm font-medium">Architecture Diagram</h3>
      <div className="relative w-full border border-border rounded-lg overflow-hidden bg-muted/30">
        {isLoading && (
          <Skeleton className="absolute inset-0 h-full w-full" />
        )}
        <img
          src={diagramUrl}
          alt="Architecture Diagram"
          className={`w-full h-auto ${isLoading ? "opacity-0" : "opacity-100"} transition-opacity duration-200`}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setImageError(true);
          }}
        />
      </div>
    </div>
  );
}
