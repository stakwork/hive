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
 */

export interface PromptEdit {
  /** Exact text to find in the current value. Must match verbatim, whitespace included. */
  oldStr: string;
  /** Replacement text. May be empty to delete. */
  newStr: string;
  /** Replace every occurrence instead of requiring `oldStr` to be unique. */
  replaceAll?: boolean;
}

export type ApplyPromptEditsResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Cap on edits per call — a sanity bound, not a meaningful workflow limit. */
export const MAX_PROMPT_EDITS = 50;

/** Keep `oldStr` echoes in error messages readable. */
const SNIPPET_LIMIT = 80;

function snippet(str: string): string {
  const oneLine = str.replace(/\n/g, "\\n");
  return oneLine.length <= SNIPPET_LIMIT
    ? oneLine
    : `${oneLine.slice(0, SNIPPET_LIMIT)}…`;
}

/** Literal (non-regex) occurrence count. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function replaceFirst(haystack: string, needle: string, replacement: string): string {
  const idx = haystack.indexOf(needle);
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

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
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, error: "edits must contain at least one edit." };
  }
  if (edits.length > MAX_PROMPT_EDITS) {
    return {
      ok: false,
      error: `Too many edits (${edits.length}); the maximum is ${MAX_PROMPT_EDITS}.`,
    };
  }

  let current = base;

  for (let i = 0; i < edits.length; i++) {
    const { oldStr, newStr, replaceAll } = edits[i];
    const label = `edit ${i + 1} of ${edits.length}`;

    if (typeof oldStr !== "string" || oldStr.length === 0) {
      return { ok: false, error: `${label}: oldStr must be a non-empty string.` };
    }
    if (typeof newStr !== "string") {
      return { ok: false, error: `${label}: newStr must be a string.` };
    }
    if (oldStr === newStr) {
      return {
        ok: false,
        error: `${label}: oldStr and newStr are identical — the edit would change nothing.`,
      };
    }

    const matches = countOccurrences(current, oldStr);

    if (matches === 0) {
      return {
        ok: false,
        error:
          `${label}: oldStr not found in the prompt: "${snippet(oldStr)}". ` +
          "It must match the stored value exactly, including whitespace and line breaks. " +
          "Re-read the current value with raw: true and build the edit from that text " +
          "(note that earlier edits in this same call have already been applied).",
      };
    }
    if (matches > 1 && !replaceAll) {
      return {
        ok: false,
        error:
          `${label}: oldStr matched ${matches} times: "${snippet(oldStr)}". ` +
          "Extend oldStr with surrounding context to make it unique, or pass replaceAll: true.",
      };
    }

    current = replaceAll
      ? current.split(oldStr).join(newStr)
      : replaceFirst(current, oldStr, newStr);
  }

  return { ok: true, value: current };
}
