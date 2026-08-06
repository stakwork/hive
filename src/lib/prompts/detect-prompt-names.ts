/**
 * Utilities for detecting UPPERCASE_UNDERSCORE prompt names and version
 * references in Jamie (assistant) chat messages.
 *
 * Patterns are stored as plain strings so callers construct **fresh** RegExp
 * instances on every parse call, avoiding shared `lastIndex` mutation between
 * successive calls that would silently skip matches.
 *
 * Design notes:
 * - INLINE_PROMPT_PATTERN requires at least one underscore segment, so bare
 *   acronyms (API, HTTP) and short tokens (V3) never match. This is an
 *   intentional false-negative class that mirrors the name creation constraint.
 */

// ─── Patterns ─────────────────────────────────────────────────────────────────

/** Matches UPPERCASE_UNDERSCORE identifiers with at least one underscore. */
export const INLINE_PROMPT_PATTERN = "\\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\\b";

/**
 * Matches version references like "version 3", "v3", "v 3", "draft version 2".
 * Case-insensitive flag must be applied at use-site.
 */
export const VERSION_REF_PATTERN =
  "\\b(?:draft\\s+)?(?:version\\s+|v\\s*)(\\d+)\\b";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MessageSegment =
  | { type: "text"; value: string }
  | { type: "prompt"; name: string }
  | { type: "version"; label: string; number: number; promptName: string };

// ─── Parser ───────────────────────────────────────────────────────────────────

interface RawMatch {
  kind: "prompt" | "version";
  start: number;
  end: number;
  /** Captured prompt name for kind=prompt; captured digit string for kind=version. */
  capture: string;
  /** Full matched text. */
  raw: string;
}

/**
 * Parses a message string into ordered text / prompt / version segments.
 *
 * - Prompt names are detected by INLINE_PROMPT_PATTERN.
 * - Version references are detected by VERSION_REF_PATTERN and associated
 *   with the nearest preceding prompt name in the message.
 * - When multiple version references resolve to the same {promptName,
 *   versionNumber} pair, only the leftmost one becomes a `version` segment;
 *   subsequent duplicates are emitted as `text`.
 * - A version reference with no preceding prompt name becomes a `text` segment.
 */
export function parseMessageSegments(text: string): MessageSegment[] {
  // Fresh RegExp instances on every call to avoid lastIndex pollution.
  const promptRe = new RegExp(INLINE_PROMPT_PATTERN, "g");
  const versionRe = new RegExp(VERSION_REF_PATTERN, "gi");

  const raw: RawMatch[] = [];

  let m: RegExpExecArray | null;

  while ((m = promptRe.exec(text)) !== null) {
    raw.push({
      kind: "prompt",
      start: m.index,
      end: m.index + m[0].length,
      capture: m[1],
      raw: m[0],
    });
  }

  while ((m = versionRe.exec(text)) !== null) {
    raw.push({
      kind: "version",
      start: m.index,
      end: m.index + m[0].length,
      capture: m[1], // digit string
      raw: m[0],
    });
  }

  // Sort all matches by start position.
  raw.sort((a, b) => a.start - b.start);

  // Walk matches and build segments, tracking nearest preceding prompt name
  // and deduplicating version+promptName pairs.
  const segments: MessageSegment[] = [];
  const seenVersionKeys = new Set<string>(); // "promptName:versionNumber"
  let cursor = 0;
  let lastPromptName: string | null = null;

  for (const match of raw) {
    // Emit text between previous match end and this match start.
    if (match.start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, match.start) });
    }

    if (match.kind === "prompt") {
      lastPromptName = match.capture;
      segments.push({ type: "prompt", name: match.capture });
    } else {
      // version
      const versionNumber = parseInt(match.capture, 10);

      if (lastPromptName === null) {
        // No preceding prompt — emit as plain text.
        segments.push({ type: "text", value: match.raw });
      } else {
        const dedupKey = `${lastPromptName}:${versionNumber}`;
        if (seenVersionKeys.has(dedupKey)) {
          // Duplicate — emit as text.
          segments.push({ type: "text", value: match.raw });
        } else {
          seenVersionKeys.add(dedupKey);
          segments.push({
            type: "version",
            label: match.raw,
            number: versionNumber,
            promptName: lastPromptName,
          });
        }
      }
    }

    cursor = match.end;
  }

  // Trailing text after the last match.
  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  // If no matches were found at all, return the whole string as a single text segment.
  if (segments.length === 0) {
    segments.push({ type: "text", value: text });
  }

  return segments;
}
