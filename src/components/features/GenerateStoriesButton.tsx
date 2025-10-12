"use client";

import { useEffect } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAIGenerate } from "@/hooks/useAIGenerate";

export interface GeneratedStory {
  title: string;
}

interface GenerateStoriesButtonProps {
  featureId: string;
  existingStories: string[];
  iconOnly?: boolean;
  onGenerated: (stories: GeneratedStory[]) => void;
}

export function GenerateStoriesButton({
  featureId,
  existingStories,
  iconOnly = false,
  onGenerated,
}: GenerateStoriesButtonProps) {
  const { generating, suggestions, generate, clearSuggestions } = useAIGenerate<GeneratedStory>(
    `/api/features/${featureId}/generate-stories`
  );

  const handleGenerate = async () => {
    await generate({ existingStories });
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
      size={iconOnly ? "icon" : "sm"}
      variant={iconOnly ? "ghost" : "outline"}
      onClick={handleGenerate}
      disabled={generating}
    >
      {generating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <>
          <Sparkles className="h-4 w-4 text-purple-500" />
          {!iconOnly && <span className="ml-2">Generate Stories</span>}
        </>
      )}
    </Button>
  );
}
