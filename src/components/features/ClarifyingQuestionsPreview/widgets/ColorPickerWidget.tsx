"use client";

import React from "react";
import { Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ColorOption } from "@/types/stakwork";

interface ColorPickerWidgetProps {
  options: ColorOption[];
  selectedColor: string | null;
  onSelect: (color: string) => void;
  onFeedbackChange: (text: string) => void;
  feedbackText: string;
  disabled?: boolean;
}

export function ColorPickerWidget({
  options,
  selectedColor,
  onSelect,
  onFeedbackChange,
  feedbackText,
  disabled = false,
}: ColorPickerWidgetProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        {options.map((option) => {
          const isSelected = selectedColor === option.value;
          
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              disabled={disabled}
              className={cn(
                "flex flex-col items-center gap-2 p-3 rounded-md border-2 transition-all",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="relative">
                <div
                  className="w-16 h-16 rounded-md border border-border shadow-sm"
                  style={{ backgroundColor: option.value }}
                />
                {isSelected && (
                  <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                    <Check className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </div>
              <span className="text-xs font-medium text-center">{option.label}</span>
              {option.preview && (
                <span className="text-xs text-muted-foreground">{option.preview}</span>
              )}
            </button>
          );
        })}
      </div>
      
      <Textarea
        placeholder="Add additional context about your color choice..."
        value={feedbackText}
        onChange={(e) => onFeedbackChange(e.target.value)}
        disabled={disabled}
        rows={3}
        className="resize-none"
      />
    </div>
  );
}
