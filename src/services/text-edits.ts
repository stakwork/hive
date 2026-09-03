/**
 * Domain-neutral exact-match find/replace edit core.
 *
 * Extracted from `src/services/prompts/prompt-edits.ts` so any store of
 * whole-value text (prompts, HTML pages, ...) can offer the same
 * "targeted edits applied to a full value, fail loud on stale/ambiguous
 * match" contract without re-implementing the splice logic — and,
 * critically, without re-using error copy that names the wrong noun or
 * points at a flag/tool the caller doesn't have (`raw: true` means
 * nothing to the HTML edit path).
 *
 * Callers resolve edits to a complete value immediately at the call
 * site; nothing downstream of `applyExactEdits` ever sees an edit list.
 */

export interface TextEdit {
  /** Exact text to find in the current value. Must match verbatim, whitespace included. */
  oldStr: string;
  /** Replacement text. May be empty to delete. */
  newStr: string;
  /** Replace every occurrence instead of requiring `oldStr` to be unique. */
  replaceAll?: boolean;
}

/**
 * Machine-readable failure classification, separate from the human
 * (and page-fragment-echoing) `error` string. Callers that log tool
 * outcomes should log `reason`, never `error` — `error` embeds an
 * `snippet(oldStr)` echo of caller-supplied text (a prompt fragment or,
 * for the HTML edit path, a fragment of the stored page) that must
 * never reach application logs.
 */
export type ApplyExactEditsFailureReason =
  | "empty_edits"
  | "too_many_edits"
  | "invalid_edit"
  | "noop_edit"
  | "zero_match"
  | "ambiguous_match";

export type ApplyExactEditsResult =
  | { ok: true; value: string }
  | { ok: false; error: string; reason: ApplyExactEditsFailureReason };

export interface ApplyExactEditsOptions {
  /** What the edited value is called in error copy, e.g. "prompt" or "page". */
  noun: string;
  /**
   * Sentence telling the caller how to get a fresh copy of the value
   * after a stale/mismatched edit, e.g. "Re-read the current value with
   * raw: true and build the edit from that text" (prompts) or "Re-read
   * the current page with get_html." (HTML pages). Inserted verbatim
   * before the "(note that earlier edits ...)" trailer.
   */
  rereadHint: string;
  /** Cap on edits per call — a sanity bound, not a meaningful workflow limit. */
  maxEdits: number;
}

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
 * a zero-match edit means the caller's copy of the value is stale, and an
 * ambiguous multi-match edit means the caller has not said which occurrence
 * it meant. Both are conditions the caller must resolve, not us.
 */
export function applyExactEdits(
  base: string,
  edits: TextEdit[],
  opts: ApplyExactEditsOptions,
): ApplyExactEditsResult {
  const { noun, rereadHint, maxEdits } = opts;

  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, error: "edits must contain at least one edit.", reason: "empty_edits" };
  }
  if (edits.length > maxEdits) {
    return {
      ok: false,
      error: `Too many edits (${edits.length}); the maximum is ${maxEdits}.`,
      reason: "too_many_edits",
    };
  }

  let current = base;

  for (let i = 0; i < edits.length; i++) {
    const { oldStr, newStr, replaceAll } = edits[i];
    const label = `edit ${i + 1} of ${edits.length}`;

    if (typeof oldStr !== "string" || oldStr.length === 0) {
      return {
        ok: false,
        error: `${label}: oldStr must be a non-empty string.`,
        reason: "invalid_edit",
      };
    }
    if (typeof newStr !== "string") {
      return {
        ok: false,
        error: `${label}: newStr must be a string.`,
        reason: "invalid_edit",
      };
    }
    if (oldStr === newStr) {
      return {
        ok: false,
        error: `${label}: oldStr and newStr are identical — the edit would change nothing.`,
        reason: "noop_edit",
      };
    }

    const matches = countOccurrences(current, oldStr);

    if (matches === 0) {
      return {
        ok: false,
        error:
          `${label}: oldStr not found in the ${noun}: "${snippet(oldStr)}". ` +
          "It must match the stored value exactly, including whitespace and line breaks. " +
          `${rereadHint} ` +
          "(note that earlier edits in this same call have already been applied).",
        reason: "zero_match",
      };
    }
    if (matches > 1 && !replaceAll) {
      return {
        ok: false,
        error:
          `${label}: oldStr matched ${matches} times: "${snippet(oldStr)}". ` +
          "Extend oldStr with surrounding context to make it unique, or pass replaceAll: true.",
        reason: "ambiguous_match",
      };
    }

    current = replaceAll
      ? current.split(oldStr).join(newStr)
      : replaceFirst(current, oldStr, newStr);
  }

  return { ok: true, value: current };
}
