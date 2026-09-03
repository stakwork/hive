/**
 * Exact-match find/replace edits for prompt values.
 *
 * Prompts are stored as whole values and every write path (`writePromptThrough`,
 * the `promptUpdate` proposal payload, `PromptVersion.value`) keeps a complete
 * snapshot. Edits are purely a *wire format* on the agent-facing edge: an agent
 * sends only the fragments it wants changed, and we resolve them to a full value
 * immediately, at tool-call time. Nothing downstream ever sees an edit list.
 *
 * That buys two things over having the agent re-emit the whole prompt:
 *   - a long prompt is not round-tripped through the model, so it cannot silently
 *     drift (dropped section, normalized whitespace, "helpfully" reworded para);
 *   - a stale read fails loudly — if `oldStr` no longer matches, someone changed
 *     the prompt since the agent read it, and we reject instead of clobbering.
 *
 * The actual splice / zero-match / ambiguous-match / edit-cap logic lives in
 * the domain-neutral `src/services/text-edits.ts` (shared with the HTML page
 * edit path) — this module just supplies the prompt-flavored error copy
 * (`noun: "prompt"`, the `raw: true` reread hint) and the prompt-specific cap.
 */

import { applyExactEdits, type TextEdit } from "@/services/text-edits";

export type PromptEdit = TextEdit;

export type ApplyPromptEditsResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Cap on edits per call — a sanity bound, not a meaningful workflow limit. */
export const MAX_PROMPT_EDITS = 50;

/**
 * Apply `edits` to `base` in order, each against the result of the previous one.
 *
 * Fails (rather than guessing) when an edit does not match exactly once:
 * a zero-match edit means the caller's copy of the prompt is stale, and an
 * ambiguous multi-match edit means the caller has not said which occurrence
 * it meant. Both are conditions the caller must resolve, not us.
 */
export function applyPromptEdits(
  base: string,
  edits: PromptEdit[],
): ApplyPromptEditsResult {
  return applyExactEdits(base, edits, {
    noun: "prompt",
    rereadHint:
      "Re-read the current value with raw: true and build the edit from that text",
    maxEdits: MAX_PROMPT_EDITS,
  });
}
