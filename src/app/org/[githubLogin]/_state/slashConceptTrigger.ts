/**
 * Detects an in-progress "/concept" trigger in the org canvas chat
 * composer — the text typed right before the caret that should open the
 * concept-mention menu.
 *
 * A trigger fires when there is a "/" at the start of a word (the very
 * start of the text, or right after whitespace) somewhere before the
 * caret, with no whitespace between that "/" and the caret. This mirrors
 * `MENTION_TRIGGER_RE` in `MentionInput.tsx` (the "@" mention trigger),
 * so a "/" in the middle of a path or URL (e.g. "https://foo", "a/b")
 * never opens the menu — only a "/" that begins a fresh word does.
 */

export interface SlashTrigger {
  /** Index of the "/" character in the source text. */
  start: number;
  /** Text typed after the "/", up to the caret (never contains whitespace). */
  query: string;
}

const SLASH_TRIGGER_RE = /(?:^|\s)\/(\S*)$/;

export function detectSlashTrigger(text: string, cursor: number): SlashTrigger | null {
  const before = text.slice(0, cursor);
  const match = before.match(SLASH_TRIGGER_RE);
  if (!match) return null;
  // The query (`match[1]`) may itself contain "/" (e.g. "/usr/bin"), so
  // `lastIndexOf("/")` would find the wrong slash. The match is anchored at
  // `$`, so the trigger "/" sits exactly `query.length + 1` chars before the
  // caret.
  const start = before.length - match[1].length - 1;
  return { start, query: match[1] };
}

/**
 * Replaces the "/query" span at `start` with "/Concept Name " (trailing
 * space included) and returns the new text plus the caret position right
 * after the inserted space.
 */
export function insertSlashConcept(
  text: string,
  trigger: SlashTrigger,
  conceptName: string,
): { text: string; caret: number } {
  const replaceEnd = trigger.start + 1 + trigger.query.length;
  const before = text.slice(0, trigger.start);
  const after = text.slice(replaceEnd);
  const inserted = `/${conceptName} `;
  return {
    text: before + inserted + after,
    caret: before.length + inserted.length,
  };
}
