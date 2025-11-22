"use client";

import { useRef } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SaveIndicator } from "./SaveIndicator";
import { useImageUpload } from "@/hooks/useImageUpload";
import { ImagePreview } from "@/components/ui/image-preview";
import { cn } from "@/lib/utils";

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
}: AutoSaveTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      <Textarea
        ref={textareaRef}
        id={id}
        placeholder={placeholder || `Type your ${label.toLowerCase()} here...`}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlur(e.target.value || null)}
        onFocus={onFocus}
        rows={rows}
        className={cn("resize-y", className)}
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
      
      {/* Image Preview - Only show when image upload is enabled */}
      {enableImageUpload && featureId && <ImagePreview content={value} />}
    </div>
  );
}
