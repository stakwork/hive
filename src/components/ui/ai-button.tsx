"use client";

import { useEffect } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAIGenerate } from "@/hooks/useAIGenerate";

interface AIButtonProps<T> {
  endpoint: string;
  params?: Record<string, unknown>;
  onGenerated: (results: T[]) => void;
  onGeneratingChange?: (generating: boolean) => void;
  iconOnly?: boolean;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
}

export function AIButton<T>({
  endpoint,
  params,
  onGenerated,
  onGeneratingChange,
  iconOnly = false,
  label = "Generate",
  variant = "outline",
  size = "sm",
  disabled = false,
}: AIButtonProps<T>) {
  const { generating, suggestions, generate, clearSuggestions } = useAIGenerate<T>(endpoint);

  // Notify parent when generating state changes
  useEffect(() => {
    onGeneratingChange?.(generating);
  }, [generating, onGeneratingChange]);

  const handleGenerate = async () => {
    await generate(params);
  };

  // Notify parent when suggestions change
  useEffect(() => {
    if (suggestions.length > 0) {
      onGenerated(suggestions);
      clearSuggestions();
    }
  }, [suggestions, onGenerated, clearSuggestions]);

  return (
    <Button
      size={size}
      variant={variant}
      onClick={handleGenerate}
      disabled={generating || disabled}
    >
      {generating ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
          {!iconOnly && <span className="ml-1.5">Generating...</span>}
        </>
      ) : (
        <>
          <Sparkles className="h-3.5 w-3.5 text-purple-500" />
          {!iconOnly && <span className="ml-1.5">{label}</span>}
        </>
      )}
    </Button>
  );
}
