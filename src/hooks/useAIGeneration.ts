import { useState, useCallback, useMemo } from "react";
import { useToast } from "@/components/ui/use-toast";
import type { StakworkRunType } from "@prisma/client";

export type GenerationSource = "quick" | "deep";

interface UseAIGenerationOptions {
  featureId: string;
  workspaceId: string;
  type: StakworkRunType;
  enabled?: boolean;
}

interface GenerationResult {
  content: string | null;
  isLoading: boolean;
  source: GenerationSource | null;
  accept: (onSuccess?: () => void) => Promise<void>;
  reject: (feedback?: string) => Promise<void>;
  regenerate: () => Promise<void>;
  setContent: (content: string | null, source: GenerationSource) => void;
  clear: () => void;
}

export function useAIGeneration({
  featureId,
  workspaceId,
  type,
  enabled = true,
}: UseAIGenerationOptions): GenerationResult {
  const [content, setContent] = useState<string | null>(null);
  const [source, setSource] = useState<GenerationSource | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const { toast } = useToast();

  const setContentWithSource = useCallback((newContent: string | null, newSource: GenerationSource) => {
    setContent(newContent);
    setSource(newSource);
  }, []);

  const accept = useCallback(
    async (onSuccess?: () => void) => {
      if (!content || !enabled) return;

      try {
        setIsLoading(true);

        // If from Stakwork (deep), persist decision
        if (source === "deep" && currentRunId) {
          const response = await fetch(`/api/stakwork/runs/${currentRunId}/decision`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              decision: "ACCEPTED",
              featureId,
            }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || "Failed to accept result");
          }
        }

        toast({
          title: "Result accepted",
          description: "The generated content has been saved.",
        });

        // Clear state
        setContent(null);
        setSource(null);
        setCurrentRunId(null);

        if (onSuccess) {
          onSuccess();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to accept result";
        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        });
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [content, source, currentRunId, featureId, enabled, toast]
  );

  const reject = useCallback(
    async (feedback?: string) => {
      if (!enabled) return;

      try {
        setIsLoading(true);

        // If from Stakwork (deep), persist decision
        if (source === "deep" && currentRunId) {
          const response = await fetch(`/api/stakwork/runs/${currentRunId}/decision`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              decision: "REJECTED",
              feedback,
            }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || "Failed to reject result");
          }
        }

        toast({
          title: "Result rejected",
          description: "The generated content has been discarded.",
        });

        // Clear state
        setContent(null);
        setSource(null);
        setCurrentRunId(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to reject result";
        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        });
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [source, currentRunId, enabled, toast]
  );

  const regenerate = useCallback(async () => {
    if (!enabled || !workspaceId) return;

    try {
      setIsLoading(true);

      // Mark old run as rejected if exists
      if (currentRunId) {
        await reject("Retrying after failure");
      }

      // Create new run
      const response = await fetch("/api/stakwork/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          featureId,
          workspaceId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create stakwork run");
      }

      const data = await response.json();
      setCurrentRunId(data.run.id);

      toast({
        title: "Generation restarted",
        description: "Your deep thinking process has been restarted.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to regenerate";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [enabled, workspaceId, currentRunId, type, featureId, reject, toast]);

  const clear = useCallback(() => {
    setContent(null);
    setSource(null);
    setCurrentRunId(null);
  }, []);

  return useMemo(
    () => ({
      content,
      isLoading,
      source,
      accept,
      reject,
      regenerate,
      setContent: setContentWithSource,
      clear,
    }),
    [content, isLoading, source, accept, reject, regenerate, setContentWithSource, clear]
  );
}