/**
 * Resolves the two graph targets for Prompt node writes.
 *
 * Each recording event (create + publish) must write the Prompt node to BOTH
 * targets — a write reaching only one target is a failure of that event.
 *
 * Target model: two fixed, config-resolved Jarvis instances sourced from env
 * vars.  A missing env var for either target is treated as a configuration
 * failure for that target (logged, not silently skipped).
 *
 * Design intentionally minimal — a two-entry fixed list, not a generic
 * multi-target abstraction.
 */

import { config } from "@/config/env";
import { logger } from "@/lib/logger";
import type { JarvisConnectionConfig } from "@/types/jarvis";

export interface PromptGraphTarget {
  config: JarvisConnectionConfig;
  label: string;
}

/**
 * Returns the two configured Prompt graph targets.
 *
 * A target whose env vars are missing is returned as `null` at its position —
 * callers must treat a null target as a failed write for that target (log it,
 * do not silently skip).
 *
 * The `workspaceId` parameter is accepted for forward-compatibility (in case a
 * future report shows one target should be workspace-scoped), but both targets
 * are currently fixed/config-resolved.
 */
export function getPromptGraphTargets(_workspaceId?: string): Array<PromptGraphTarget | null> {
  const t1 = resolveTarget(
    "primary",
    config.PROMPT_GRAPH_TARGET_1_URL,
    config.PROMPT_GRAPH_TARGET_1_API_KEY,
  );

  const t2 = resolveTarget(
    "secondary",
    config.PROMPT_GRAPH_TARGET_2_URL,
    config.PROMPT_GRAPH_TARGET_2_API_KEY,
  );

  return [t1, t2];
}

function resolveTarget(
  label: string,
  url: string | undefined,
  apiKey: string | undefined,
): PromptGraphTarget | null {
  if (!url || !apiKey) {
    logger.warn(
      `[prompt-graph-targets] Prompt graph target "${label}" is misconfigured — env vars missing`,
      "prompt-graph-targets",
      { label },
    );
    return null;
  }
  return {
    config: { jarvisUrl: url, apiKey },
    label,
  };
}
