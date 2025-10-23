"use client";

import { useEffect } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAIGenerate } from "@/hooks/useAIGenerate";

interface AIButtonProps<T> {
  endpoint: string;
  params?: Record<string, unknown>;
  onGenerated: (results: T[]) => void;
  tooltip?: string;
  iconOnly?: boolean;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  generating?: boolean; // External generating state (from polling store)
  onGenerationStarted?: (requestId: string) => void; // Callback when generation starts with requestId
}

export function AIButton<T>({
  endpoint,
  params,
  onGenerated,
  tooltip = "Generate with AI",
  iconOnly = false,
  label = "Generate",
  variant = "ghost",
  size = "icon",
  generating: externalGenerating,
  onGenerationStarted,
}: AIButtonProps<T>) {
  const { generating: internalGenerating, suggestions, generate, clearSuggestions } = useAIGenerate<T>(endpoint);

  // Use external generating state if provided, otherwise use internal
  const isGenerating = externalGenerating !== undefined ? externalGenerating : internalGenerating;

  const handleGenerate = async () => {
    const result = await generate(params);

    // If result contains request_id (async generation), call onGenerationStarted
    if (result?.request_id && onGenerationStarted) {
      onGenerationStarted(result.request_id);
    }
  };

  // Notify parent when suggestions change
  useEffect(() => {
    if (suggestions.length > 0) {
      onGenerated(suggestions);
      clearSuggestions();
    }
  }, [suggestions, onGenerated, clearSuggestions]);

  const button = (
    <Button
      size={iconOnly ? "icon" : size}
      variant={iconOnly ? "ghost" : variant}
      onClick={handleGenerate}
      disabled={isGenerating}
    >
      {isGenerating ? (
        <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
      ) : (
        <>
          <Sparkles className="h-4 w-4 text-purple-500" />
          {!iconOnly && <span className="ml-2">{label}</span>}
        </>
      )}
    </Button>
  );

  if (!tooltip || !iconOnly) {
    return button;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{button}</div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
