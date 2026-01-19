"use client";

import React from "react";
import { Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { tomorrow } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { ComponentOption } from "@/types/stakwork";

interface ComponentPreviewWidgetProps {
  options: ComponentOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFeedbackChange: (text: string) => void;
  feedbackText: string;
  disabled?: boolean;
}

export function ComponentPreviewWidget({
  options,
  selectedId,
  onSelect,
  onFeedbackChange,
  feedbackText,
  disabled = false,
}: ComponentPreviewWidgetProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3">
        {options.map((option) => {
          const isSelected = selectedId === option.id;
          
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              disabled={disabled}
              className={cn(
                "relative flex flex-col gap-3 p-4 rounded-md border-2 text-left transition-all",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                        isSelected
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/40"
                      )}
                    >
                      {isSelected && (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      )}
                    </div>
                    <h4 className="text-sm font-semibold text-foreground">
                      {option.label}
                    </h4>
                  </div>
                  {option.description && (
                    <p className="text-xs text-muted-foreground mt-2 ml-6">
                      {option.description}
                    </p>
                  )}
                </div>
              </div>

              {option.previewUrl && (
                <div className="rounded-md border border-border overflow-hidden bg-background">
                  <img
                    src={option.previewUrl}
                    alt={`Preview of ${option.label}`}
                    className="w-full h-auto"
                  />
                </div>
              )}

              {option.code && !option.previewUrl && (
                <div className="rounded-md border border-border overflow-hidden">
                  <SyntaxHighlighter
                    language="tsx"
                    style={tomorrow}
                    customStyle={{
                      margin: 0,
                      padding: "12px",
                      fontSize: "12px",
                      maxHeight: "200px",
                      background: "hsl(var(--muted))",
                    }}
                  >
                    {option.code}
                  </SyntaxHighlighter>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <Textarea
        placeholder="Add additional context about your component choice..."
        value={feedbackText}
        onChange={(e) => onFeedbackChange(e.target.value)}
        disabled={disabled}
        rows={3}
        className="resize-none"
      />
    </div>
  );
}
