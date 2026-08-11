"use client";

import React, { useRef, ChangeEvent } from "react";
import { Upload, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFileDrop } from "@/hooks/useFileDrop";

interface FileDropZoneProps {
  onFileContent: (content: string, fileName: string) => void;
  accept?: string;
  className?: string;
  disabled?: boolean;
}

export function FileDropZone({
  onFileContent,
  accept = ".env,.txt,text/plain",
  className,
  disabled = false,
}: FileDropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isDragging, dragProps } = useFileDrop<HTMLDivElement>({
    disabled,
    onDrop: async (files) => {
      const file = files[0];
      if (!file) return;

      const isEnvFile = file.name.endsWith(".env");
      const isTextFile = file.type === "text/plain" || file.type === "";
      const isTxtFile = file.name.endsWith(".txt");

      if (isEnvFile || isTextFile || isTxtFile) {
        try {
          const content = await file.text();
          onFileContent(content, file.name);
        } catch (error) {
          console.error("Error reading file:", error);
        }
      }
    },
  });

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const content = await file.text();
      onFileContent(content, file.name);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div
      {...dragProps}
      className={cn(
        "relative border-2 border-dashed rounded-lg p-4 text-center transition-all",
        isDragging && !disabled
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50",
        disabled && "opacity-50 cursor-not-allowed",
        !disabled && "cursor-pointer",
        className
      )}
      onClick={() => !disabled && fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled}
      />

      <div className="flex items-center justify-center gap-3">
        {isDragging ? (
          <FileText className="w-6 h-6 text-primary animate-pulse" />
        ) : (
          <Upload className="w-5 h-5 text-muted-foreground" />
        )}

        <div className="text-left">
          <p className="text-sm font-medium">
            {isDragging ? "Drop your file here" : "Drop .env file or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground">
            Supports .env and .txt files
          </p>
        </div>
      </div>
    </div>
  );
}
