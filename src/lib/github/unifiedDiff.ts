/**
 * Split a unified diff into per-file `ActionResult`s for the diff viewer.
 * Pure — no DB or network.
 */

import type { ActionResult } from "@/lib/chat";

/**
 * Map a unified diff to the `ActionResult[]` shape used by `DiffContent`
 * in `src/lib/chat.ts`.
 *
 * Derivation rules:
 *   - `--- /dev/null` (new file)          → `create`
 *   - `+++ /dev/null` (deleted file)      → `delete`
 *   - rename (old ≠ new, both real paths) → two entries: `delete` (old) + `create` (new)
 *   - whole-file replacement (no retained
 *     context lines in hunk)              → `rewrite`
 *   - everything else                     → `modify`
 *   - mode-only or binary entries         → `modify` (no `binary` action exists)
 *
 * File paths are stripped of the `a/` / `b/` prefixes that `git diff` adds.
 *
 * Each entry's `content` is a SELF-CONTAINED patch: the section's hunks
 * prefixed with a synthesized `diff --git` + `---` / `+++` header. The header
 * is not decoration — `react-diff-view`'s `parseDiff` only passes text through
 * untouched when it starts with `diff --git`. Anything else is treated as a
 * bare unidiff whose first two lines are the header pair, so a hunks-only
 * string has its `@@` line eaten as a filename and the parser then walks into
 * a hunk body with no open hunk (`Cannot read properties of undefined
 * (reading 'changes')`). The rendered card degrades to a per-file parse error
 * with a +0/−0 summary.
 */
export function unifiedDiffToActionResults(
  diff: string,
  repoName: string,
): ActionResult[] {
  const results: ActionResult[] = [];

  for (const section of splitDiffIntoFileSections(diff)) {
    const { oldRaw, newRaw, oldPath, newPath } = section;
    const content = toStandalonePatch(section);

    const isNewFile = oldRaw === "/dev/null";
    const isDeletedFile = newRaw === "/dev/null";
    const isRename = !isNewFile && !isDeletedFile && oldPath !== newPath;

    if (isNewFile) {
      results.push({ file: newPath, action: "create", content, repoName });
    } else if (isDeletedFile) {
      results.push({ file: oldPath, action: "delete", content, repoName });
    } else if (isRename) {
      // The section's hunks describe the surviving file, so only the `create`
      // half carries them; the `delete` half is a marker for the old path.
      results.push({ file: oldPath, action: "delete", content: "", repoName });
      results.push({ file: newPath, action: "create", content, repoName });
    } else {
      // Same file — determine modify vs rewrite
      const action = isWholeFileReplacement(section) ? "rewrite" : "modify";
      results.push({ file: newPath, action, content, repoName });
    }
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Render one file section as a standalone unified diff that `parseDiff` can
 * consume on its own: a `diff --git` line (so the normalizer leaves the text
 * alone), then normalized `---` / `+++` headers, then the section's hunks.
 *
 * `/dev/null` sides are preserved verbatim so the parser still derives
 * `add` / `delete` file types; every other path is re-emitted with its
 * canonical `a/` / `b/` prefix rather than whatever the source diff used.
 */
function toStandalonePatch(section: DiffFileSection): string {
  const { oldRaw, newRaw, oldPath, newPath } = section;

  // git names both sides after the surviving path when one side is /dev/null.
  const gitOld = oldRaw === "/dev/null" ? newPath : oldPath;
  const gitNew = newRaw === "/dev/null" ? oldPath : newPath;

  const header = [
    `diff --git a/${gitOld} b/${gitNew}`,
    oldRaw === "/dev/null" ? "--- /dev/null" : `--- a/${oldPath}`,
    newRaw === "/dev/null" ? "+++ /dev/null" : `+++ b/${newPath}`,
  ];

  return [...header, ...section.bodyLines].join("\n");
}

/** Strip the `a/` or `b/` prefix that `git diff` adds to paths. */
function stripGitPrefix(path: string): string {
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }
  return path;
}

/** One file entry in a unified diff, produced by `splitDiffIntoFileSections`. */
interface DiffFileSection {
  /** Raw text after `--- `, e.g. `a/foo.ts` or `/dev/null`. */
  oldRaw: string;
  /** Raw text after `+++ `, e.g. `b/foo.ts` or `/dev/null`. */
  newRaw: string;
  /** `oldRaw` with any `a/` prefix stripped. */
  oldPath: string;
  /** `newRaw` with any `b/` prefix stripped. */
  newPath: string;
  /** Hunk headers and hunk body lines belonging to this file. */
  bodyLines: string[];
  /** Number of `@@` hunks in this entry. */
  hunkCount: number;
  /** Whether any hunk retains a context line. */
  hasContextLine: boolean;
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Split a unified diff into per-file sections, tracking each hunk's declared
 * line budget so body content is never mistaken for structure.
 *
 * A naive `line.startsWith("--- ")` test is wrong: a removed line whose own
 * content begins with `-- ` renders as `--- ...` inside a hunk body. SQL, Lua,
 * and Haskell comments all look like this — every Prisma migration in this repo
 * opens with `-- AlterTable` — and treating one as a file header inflates file
 * counts and truncates collected content.
 *
 * Each `@@ -a,b +c,d @@` header declares how many old- and new-side lines its
 * body holds; we consume exactly that many before resuming header scanning.
 * Counts default to 1 when omitted (`@@ -1 +1 @@`). Parsing stays tolerant of
 * hand-written diffs whose counts are inaccurate: a body line carrying no
 * context/add/remove marker ends the hunk early and is reprocessed as structure.
 */
function splitDiffIntoFileSections(diff: string): DiffFileSection[] {
  const lines = diff.split("\n");
  // Drop the empty string left by a trailing newline so it is not consumed as
  // a context line, which would mask a whole-file replacement as a modify.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const sections: DiffFileSection[] = [];
  let current: DiffFileSection | null = null;
  let oldRemaining = 0;
  let newRemaining = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Inside a hunk body every line is content, never a header.
    if (current && (oldRemaining > 0 || newRemaining > 0)) {
      if (line.startsWith("\\")) {
        // "\ No newline at end of file" — an annotation, not a counted line.
        current.bodyLines.push(line);
        continue;
      }
      if (line.startsWith("-")) {
        current.bodyLines.push(line);
        oldRemaining--;
        continue;
      }
      if (line.startsWith("+")) {
        current.bodyLines.push(line);
        newRemaining--;
        continue;
      }
      if (line.startsWith(" ") || line === "") {
        current.bodyLines.push(line);
        current.hasContextLine = true;
        oldRemaining--;
        newRemaining--;
        continue;
      }
      // Declared counts overshot the real body. End the hunk and fall through
      // so this line is reprocessed as structure.
      oldRemaining = 0;
      newRemaining = 0;
    }

    const hunk = HUNK_HEADER_RE.exec(line);
    if (hunk && current) {
      current.bodyLines.push(line);
      current.hunkCount++;
      oldRemaining = hunk[2] === undefined ? 1 : parseInt(hunk[2], 10);
      newRemaining = hunk[4] === undefined ? 1 : parseInt(hunk[4], 10);
      continue;
    }

    // A `--- ` line opens a file entry only when `+++ ` follows immediately.
    const nextLine = lines[i + 1] ?? "";
    if (line.startsWith("--- ") && nextLine.startsWith("+++ ")) {
      const oldRaw = line.slice(4).trim();
      const newRaw = nextLine.slice(4).trim();
      current = {
        oldRaw,
        newRaw,
        oldPath: stripGitPrefix(oldRaw),
        newPath: stripGitPrefix(newRaw),
        bodyLines: [],
        hunkCount: 0,
        hasContextLine: false,
      };
      sections.push(current);
      i++; // consume the `+++ ` line as well
      continue;
    }

    // Anything else outside a hunk — `diff --git`, `index`, `new file mode`,
    // `Binary files ... differ`, blank separators — is metadata.
  }

  return sections;
}

/**
 * Whether a file entry is a whole-file replacement: it has at least one hunk
 * and no hunk retains a context line, so every original line was replaced.
 */
function isWholeFileReplacement(section: DiffFileSection): boolean {
  return section.hunkCount > 0 && !section.hasContextLine;
}
