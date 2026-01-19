"use client";

import React from "react";
import { Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { tomorrow } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { CodeSnippetOption } from "@/types/stakwork";

interface CodeSnippetWidgetProps {
  options: CodeSnippetOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFeedbackChange: (text: string) => void;
  feedbackText: string;
  disabled?: boolean;
}

export function CodeSnippetWidget({
  options,
  selectedId,
  onSelect,
  onFeedbackChange,
  feedbackText,
  disabled = false,
}: CodeSnippetWidgetProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {options.map((option) => {
          const isSelected = selectedId === option.id;
          
          return (
            <div
              key={option.id}
              className={cn(
                "rounded-md border-2 transition-all",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border"
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(option.id)}
                disabled={disabled}
                className={cn(
                  "w-full flex items-center gap-3 p-3 text-left transition-colors",
                  "hover:bg-muted/50",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <div
                  className={cn(
                    "flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center",
                    isSelected
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/40"
                  )}
                >
                  {isSelected && (
                    <Check className="h-3 w-3 text-primary-foreground" />
                  )}
                </div>
                <span className="text-sm font-medium">{option.label}</span>
              </button>

              <div className="border-t border-border">
                <SyntaxHighlighter
                  language={option.language}
                  style={tomorrow}
                  customStyle={{
                    margin: 0,
                    padding: "12px",
                    fontSize: "12px",
                    background: "hsl(var(--muted))",
                    borderBottomLeftRadius: "0.375rem",
                    borderBottomRightRadius: "0.375rem",
                  }}
                >
                  {option.code}
                </SyntaxHighlighter>
              </div>
            </div>
          );
        })}
      </div>

      <Textarea
        placeholder="Add additional context about your code snippet choice..."
        value={feedbackText}
        onChange={(e) => onFeedbackChange(e.target.value)}
        disabled={disabled}
        rows={3}
        className="resize-none"
      />
    </div>
  );
}
