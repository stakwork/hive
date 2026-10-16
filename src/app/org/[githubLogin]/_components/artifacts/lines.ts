/**
 * Text as lines, for the viewers that show it line by line. Log text is
 * read into what a viewer lays out in columns: the clock time and the level
 * each line opens with, and the rest. Pure, so the rules can be tested
 * without a component.
 */

/** "1 line", "3 files", "12,000 lines". */
export const plural = (count: number, one: string): string =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : `${one}s`}`;

/** How many lines a text has; a closing newline does not start another. */
export function lineCount(text: string): number {
  if (text === "") return 0;
  let count = text.endsWith("\n") ? 0 : 1;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) count++;
  return count;
}

const CODE_FENCE = /^\s*(?:`{3,}|~{3,})/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** A markdown line as plain text: no heading, list or quote marker, no emphasis, links as their words, a table row's cells joined. */
function plainLine(line: string): string {
  let text = line.trim();
  if (text.startsWith("|"))
    text = text
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim())
      .join(" · ");
  return text
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Paired delimiters only — and an underscore pair only at word edges, so snake_case stays.
    .replace(/(\*\*|~~|\*|`)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/(?<!\w)(__|_)(\S(?:.*?\S)?)\1(?!\w)/g, "$2")
    .trim();
}

/**
 * The opening lines of a markdown document as plain text, for a preview
 * that is a glance, not a render: blank lines, fenced blocks and a table's
 * rule skipped, at most `maxLines` of what is left.
 */
export function markdownPreviewLines(text: string, maxLines: number): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (CODE_FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || TABLE_RULE.test(line)) continue;
    const plain = plainLine(line);
    if (!plain) continue;
    out.push(plain);
    if (out.length === maxLines) break;
  }
  return out;
}

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface LogLine {
  /** One-based place in the log as given. */
  number: number;
  /** The clock time the line opens with, as `HH:MM:SS`. */
  time: string | null;
  /** The level the line states for itself. */
  level: LogLevel | null;
  /**
   * The level the line sits under: its own, or that of the line it
   * continues — a stack frame under its error. What a level filter goes
   * by, so a trace stays with what it traces.
   */
  group: LogLevel | null;
  text: string;
}

const LEVELS: Record<string, LogLevel> = {
  error: "error",
  err: "error",
  fatal: "error",
  critical: "error",
  warn: "warn",
  warning: "warn",
  info: "info",
  notice: "info",
  debug: "debug",
  trace: "debug",
};

const LEVEL_WORDS = Object.keys(LEVELS).join("|");
const ANSI_CODE = /\u001b\[[0-9;]*[A-Za-z]/g;
/** An ISO date-time or a bare clock time, optionally bracketed. */
const TIMESTAMP = /^\[?(?:\d{4}-\d{2}-\d{2}[T ])?(\d{2}:\d{2}:\d{2})(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s+/;
/** `[error]`, or a CI runner's `##[error]`, in any case. */
const BRACKETED_LEVEL = new RegExp(`^(?:##)?\\[(${LEVEL_WORDS})\\]:?\\s*`, "i");
/** A bare level word counts only in capitals, so a sentence that starts with "info" is not one. */
const BARE_LEVEL = new RegExp(`^(${LEVEL_WORDS.toUpperCase()})\\b:?\\s*`);
/** `TypeError: …` says what it is without a level word; its text is kept whole. */
const THROWN = /^\S*(?:Error|Exception):/;

export function parseLogLines(text: string): LogLine[] {
  const lines: LogLine[] = [];
  if (!text.trim()) return lines;
  const raw = text
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.replace(ANSI_CODE, ""));
  // In a log that stamps its entries, a line with no stamp belongs to the
  // entry above it. In one that does not, only an indented line does.
  const stamped = raw.some((line) => TIMESTAMP.test(line));

  raw.forEach((rawLine, i) => {
    let rest = rawLine;
    let time: string | null = null;
    let level: LogLevel | null = null;

    const stamp = TIMESTAMP.exec(rest);
    if (stamp) {
      time = stamp[1];
      rest = rest.slice(stamp[0].length);
    }
    const stated = BRACKETED_LEVEL.exec(rest) ?? BARE_LEVEL.exec(rest);
    if (stated) {
      level = LEVELS[stated[1].toLowerCase()];
      rest = rest.slice(stated[0].length);
    } else if (THROWN.test(rest)) {
      level = "error";
    }

    const continues = time === null && level === null && (stamped || /^\s/.test(rest));
    lines.push({
      number: i + 1,
      time,
      level,
      group: continues ? (lines[lines.length - 1]?.group ?? null) : level,
      text: rest,
    });
  });

  return lines;
}
