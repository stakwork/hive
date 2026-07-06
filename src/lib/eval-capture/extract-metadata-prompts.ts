import { mapPromptResolutions, type PromptResolution } from "@/types/evals";

/**
 * Extracts and normalises prompt resolutions from an AgentLog `metadata` object
 * into the array-of-individually-JSON-stringified-strings shape that the Jarvis
 * `EvalTrigger.prompts` field expects.
 *
 * Mirrors the extraction logic in the working `/eval/capture` route (L145-159)
 * without modifying that route.
 *
 * @returns `string[]` — each entry is a JSON-stringified
 *   `{ name, prompt_id, prompt_version_id, resolution? }` object.
 *   Returns `[]` when no prompt data is present or derivable.
 */
export function extractMetadataPrompts(metadata: unknown): string[] {
  if (metadata === null || typeof metadata !== "object") {
    return [];
  }

  const metaObj = metadata as Record<string, unknown>;
  if (!("prompts" in metaObj)) {
    return [];
  }

  const rawPrompts = metaObj.prompts;

  const promptsArr: unknown[] = Array.isArray(rawPrompts)
    ? (rawPrompts as unknown[])
    : (mapPromptResolutions(
        rawPrompts as Record<string, PromptResolution> | null | undefined,
      ) ?? []);

  return promptsArr.map((p) => JSON.stringify(p));
}
