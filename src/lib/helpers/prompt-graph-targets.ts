/**
 * Resolves the two Jarvis graph targets for Prompt node writes.
 *
 * Both targets are config-resolved (fixed env vars), not workspace-scoped.
 * This is the direct fix for #4770's single-target, per-workspace no-op:
 * these targets are always attempted regardless of workspaceId.
 *
 * New env vars required (distinct from the retiring WORKFLOW_GRAPH_PROMPT_STORAGE_ID):
 *   PROMPT_GRAPH_TARGET_1_URL  — Jarvis URL for target 1
 *   PROMPT_GRAPH_TARGET_1_KEY  — API key for target 1
 *   PROMPT_GRAPH_TARGET_2_URL  — Jarvis URL for target 2
 *   PROMPT_GRAPH_TARGET_2_KEY  — API key for target 2
 *
 * If a target's env vars are absent, it is still returned (with empty strings)
 * so the caller attempts the write and surfaces the failure rather than silently
 * skipping it.
 */

import type { JarvisConnectionConfig } from "@/types/jarvis";

export interface PromptGraphTarget {
  config: JarvisConnectionConfig;
  label: string;
}

/**
 * Returns the two fixed Prompt-graph write targets.
 * Never throws. If env vars are absent the config will have empty strings —
 * addNode will fail and the caller logs the error (no silent skip).
 */
export function getPromptGraphTargets(): PromptGraphTarget[] {
  return [
    {
      label: "prompt-graph-target-1",
      config: {
        jarvisUrl: process.env.PROMPT_GRAPH_TARGET_1_URL ?? "",
        apiKey: process.env.PROMPT_GRAPH_TARGET_1_KEY ?? "",
      },
    },
    {
      label: "prompt-graph-target-2",
      config: {
        jarvisUrl: process.env.PROMPT_GRAPH_TARGET_2_URL ?? "",
        apiKey: process.env.PROMPT_GRAPH_TARGET_2_KEY ?? "",
      },
    },
  ];
}
