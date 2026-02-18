"use client";

import React, { useRef, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SaveIndicator } from "./SaveIndicator";
import { useImageUpload } from "@/hooks/useImageUpload";
import { ImagePreview } from "@/components/ui/image-preview";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { cn } from "@/lib/utils";
import { filterImagesFromDisplay } from "@/lib/utils/markdown-filters";
import { Edit, Eye } from "lucide-react";

interface AutoSaveTextareaProps {
  id: string;
  label: string;
  description?: string;
  placeholder?: string;
  value: string | null;
  rows?: number;
  className?: string;
  savedField: string | null;
  saving: boolean;
  saved: boolean;
  onChange: (value: string) => void;
  onBlur: (value: string | null) => void;
  onFocus?: () => void;
  featureId?: string;
  enableImageUpload?: boolean;
  isListening?: boolean;
  transcript?: string;
}

export function AutoSaveTextarea({
  id,
  label,
  description,
  placeholder,
  value,
  rows = 4,
  className,
  savedField,
  saving,
  saved,
  onChange,
  onBlur,
  onFocus,
  featureId,
  enableImageUpload = false,
  isListening = false,
  transcript = "",
}: AutoSaveTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"edit" | "preview">(value ? "preview" : "edit");

  // Note: Image placeholders are editable. If user deletes [Image: filename],
  // the original markdown image will be lost. This is intentional for v1.
  // Future enhancement: Make placeholders read-only or implement bi-directional sync.
  const displayValue = useMemo(() => {
    if (!value) return '';
    return filterImagesFromDisplay(value);
  }, [value]);

  const {
    isDragging,
    isUploading,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
  } = useImageUpload({
    featureId: featureId || '',
    onImageInserted: (markdownImage) => {
      // The value is already updated by the hook
      console.log('Image inserted:', markdownImage);
    },
    onError: (error) => {
      console.error('Image upload error:', error);
      // TODO: Show toast notification
    },
  });

  const handleModeSwitch = (newMode: "edit" | "preview") => {
    if (mode === "edit" && newMode === "preview") {
      onBlur(value);
    }
    setMode(newMode);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 min-h-9">
        <Label htmlFor={id} className="text-base font-semibold">
          {label}
        </Label>
        <SaveIndicator
          field={id}
          savedField={savedField}
          saving={saving}
          saved={saved}
        />
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      
      {/* Content Area - Toggle between Edit and Preview */}
      <div className="relative">
        {mode === "edit" ? (
          <>
            {/* Sticky Toggle Button - overlaid, doesn't affect layout */}
            <div className="sticky top-0 z-10 h-0 flex justify-end pointer-events-none">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleModeSwitch("preview")}
                    className="pointer-events-auto h-8 w-8 p-0 bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm hover:bg-background/90 mt-2 mr-2"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  Preview markdown
                </TooltipContent>
              </Tooltip>
            </div>
            <Textarea
              ref={textareaRef}
              id={id}
              placeholder={isListening && transcript ? `${transcript}...` : isListening ? "Listening..." : (placeholder || `Type your ${label.toLowerCase()} here...`)}
              value={displayValue}
              onChange={(e) => {
                // Important: User edits work on filtered text
                // The full markdown with images is preserved on blur
                onChange(e.target.value);
              }}
              onBlur={(e) => {
                // Preserve original value with markdown images
                onBlur(e.target.value || null);
              }}
              onFocus={onFocus}
              rows={rows}
              className={cn("resize-y font-mono text-sm min-h-[200px] pr-12", className)}
              isDragging={enableImageUpload && featureId ? isDragging : false}
              isUploading={enableImageUpload && featureId ? isUploading : false}
              {...(enableImageUpload && featureId ? {
                onDragEnter: handleDragEnter,
                onDragLeave: handleDragLeave,
                onDragOver: handleDragOver,
                onDrop: handleDrop,
                onPaste: handlePaste,
              } : {})}
            />
          </>
        ) : (
          <>
            {/* Sticky Toggle Button - overlaid, doesn't affect layout */}
            <div className="sticky top-0 z-10 h-0 flex justify-end pointer-events-none">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleModeSwitch("edit")}
                    className="pointer-events-auto h-8 w-8 p-0 bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm hover:bg-background/90 mt-2 mr-2"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  Edit content
                </TooltipContent>
              </Tooltip>
            </div>
            <div className={cn(
              "rounded-md border border-border bg-muted/30 p-4 min-h-[200px] pr-12",
              !value && "flex items-center justify-center text-sm text-muted-foreground",
              className
            )}>
              {value ? (
                <MarkdownRenderer size="compact">{value}</MarkdownRenderer>
              ) : (
                <p>No content yet. Click Edit to add {label.toLowerCase()}.</p>
              )}
            </div>
          </>
        )}
      </div>
      
      {/* Image Preview - Only show in edit mode when image upload is enabled */}
      {mode === "edit" && enableImageUpload && featureId && <ImagePreview content={value} />}
    </div>
  );
}
