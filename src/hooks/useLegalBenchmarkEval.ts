import { useState, useCallback } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";

export type EvalResultStatus = "started" | "skipped" | "active" | "notConfigured" | "error";

export interface EvalResult {
  status: EvalResultStatus;
  message: string;
  reason?: "already_ran" | "no_failures";
  projectId?: number;
}

interface UseLegalBenchmarkEvalReturn {
  runEval: (runId: string) => Promise<EvalResult>;
  isSubmitting: boolean;
}

export function useLegalBenchmarkEval(): UseLegalBenchmarkEvalReturn {
  const { workspace } = useWorkspace();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const runEval = useCallback(
    async (runId: string): Promise<EvalResult> => {
      const slug = workspace?.slug;
      if (!slug) {
        return { status: "error", message: "Workspace not available." };
      }

      setIsSubmitting(true);
      try {
        const res = await fetch(
          `/api/workspaces/${slug}/legal/benchmarks/runs/${runId}/eval`,
          { method: "POST" },
        );

        if (res.status === 201) {
          const body = await res.json() as { evalRunId?: string; projectId?: number | null };
          return { status: "started", message: "Eval started.", projectId: body.projectId ?? undefined };
        }

        if (res.status === 200) {
          const body = (await res.json()) as { skipped?: boolean; reason?: "already_ran" | "no_failures" };
          const reason = body.reason;
          if (reason === "already_ran") {
            return {
              status: "skipped",
              message: "This run has already been evaluated.",
              reason,
            };
          }
          if (reason === "no_failures") {
            return {
              status: "skipped",
              message: "No failing criteria to evaluate.",
              reason,
            };
          }
          return { status: "skipped", message: "Eval skipped.", reason };
        }

        if (res.status === 409) {
          return { status: "active", message: "An eval is already running for this run." };
        }

        if (res.status === 503) {
          return { status: "notConfigured", message: "Eval workflow not configured yet." };
        }

        // 400 / 404 / 500 / 502 / other
        return { status: "error", message: "Failed to start eval. Please try again." };
      } catch {
        return { status: "error", message: "Failed to start eval. Please try again." };
      } finally {
        setIsSubmitting(false);
      }
    },
    [workspace?.slug],
  );

  return { runEval, isSubmitting };
}
