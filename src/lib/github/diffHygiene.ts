/**
 * Shared diff validation utilities used by the propose_code_change tool
 * and the codeChange approval adapter.
 *
 * All functions are pure (no DB/network calls) and independently testable.
 *
 * Diff caps: 200 KB / 50 files. This is intentionally stricter than the
 * swarm's own 200-file cap so oversized work is refused before a container
 * is allocated. The swarm still runs its own `gitleaksProtect` on the
 * write path; `scanForSecrets` here exists solely to prevent a credential
 * from being persisted into the Hive conversation transcript during a
 * read-only preview run that never reaches `commit`.
 */

import type { ActionResult, Action } from "@/lib/chat";

// ─── Result types ──────────────────────────────────────────────────────────

export type DiffHygieneOk = { ok: true };
export type DiffHygieneError = { ok: false; code: string; message: string };
export type DiffHygieneResult = DiffHygieneOk | DiffHygieneError;

function err(code: string, message: string): DiffHygieneError {
  return { ok: false, code, message };
}

// ─── parseUnifiedDiff ─────────────────────────────────────────────────────

/**
 * Validate that `diff` is a parseable unified diff.
 *
 * Rejects:
 * - Empty strings.
 * - Binary-only patches (no `@@` hunk header anywhere).
 * - Strings that lack any `---` / `+++` file header pairs.
 *
 * This is intentionally lenient: it checks structural markers, not
 * line-by-line hunk arithmetic. Malformed arithmetic is caught by
 * `git apply` on the swarm side.
 */
export function parseUnifiedDiff(diff: string): DiffHygieneResult {
  if (!diff || diff.trim().length === 0) {
    return err("empty_diff", "Diff is empty.");
  }

  const sections = splitDiffIntoFileSections(diff);

  if (sections.length === 0) {
    return err(
      "malformed_diff",
      "Diff has no --- / +++ file header pairs. Expected unified diff format.",
    );
  }

  const hasHunk = sections.some((s) => s.hunkCount > 0);
  if (!hasHunk) {
    return err(
      "binary_or_malformed",
      "Diff contains no hunk headers (@@). Binary-only or malformed patches are not accepted.",
    );
  }

  return { ok: true };
}

// ─── enforceDiffCaps ──────────────────────────────────────────────────────

export interface DiffCapOptions {
  maxBytes?: number; // default: 200_000
  maxFiles?: number; // default: 50
}

/**
 * Enforce size caps on a unified diff.
 *
 * Returns `change_too_large` if either cap is violated so the caller can
 * surface the same failure code as the swarm's own cap check.
 */
export function enforceDiffCaps(
  diff: string,
  opts: DiffCapOptions = {},
): DiffHygieneResult {
  const maxBytes = opts.maxBytes ?? 200_000;
  const maxFiles = opts.maxFiles ?? 50;

  const byteLength = Buffer.byteLength(diff, "utf8");
  if (byteLength > maxBytes) {
    return err(
      "change_too_large",
      `Diff is ${byteLength} bytes, exceeding the ${maxBytes}-byte cap.`,
    );
  }

  // Count distinct file pairs. Must go through the hunk-aware splitter: a
  // deleted line whose own content starts with "-- " (e.g. the "-- AlterTable"
  // comments in a Prisma migration) renders as "--- AlterTable" inside a hunk
  // body and would otherwise be counted as a file header.
  const fileCount = splitDiffIntoFileSections(diff).length;

  if (fileCount > maxFiles) {
    return err(
      "change_too_large",
      `Diff touches ${fileCount} files, exceeding the ${maxFiles}-file cap.`,
    );
  }

  return { ok: true };
}

// ─── validatePrArgs ───────────────────────────────────────────────────────

const PR_TITLE_MAX = 256;
const PR_BODY_MAX = 65_536;

/**
 * Validate PR title and body before forwarding to the swarm's `create_pr`.
 *
 * Rules:
 * - Neither may start with `-` (forwarded into `commit -F`; a leading dash
 *   is interpreted as a flag by git and can corrupt the commit message).
 * - Newlines in `title` are normalized to spaces.
 * - Both are length-capped.
 */
export function validatePrArgs(
  title: string,
  body: string,
): { ok: true; title: string; body: string } | DiffHygieneError {
  const normalizedTitle = title.replace(/[\r\n]+/g, " ").trim();
  const normalizedBody = body.replace(/\r\n/g, "\n").trimEnd();

  if (normalizedTitle.startsWith("-")) {
    return err(
      "invalid_pr_args",
      "PR title must not start with '-' (interpreted as a git flag).",
    );
  }
  if (normalizedBody.startsWith("-")) {
    return err(
      "invalid_pr_args",
      "PR body must not start with '-' (interpreted as a git flag).",
    );
  }
  if (normalizedTitle.length === 0) {
    return err("invalid_pr_args", "PR title must not be empty.");
  }
  if (normalizedTitle.length > PR_TITLE_MAX) {
    return err(
      "invalid_pr_args",
      `PR title exceeds ${PR_TITLE_MAX} characters.`,
    );
  }
  if (normalizedBody.length > PR_BODY_MAX) {
    return err(
      "invalid_pr_args",
      `PR body exceeds ${PR_BODY_MAX} characters.`,
    );
  }

  return { ok: true, title: normalizedTitle, body: normalizedBody };
}

// ─── scanForSecrets ───────────────────────────────────────────────────────

/**
 * Cheap, high-confidence secret scan.
 *
 * Purpose: prevent a credential from being persisted into the Hive
 * conversation transcript during a read-only preview run. This does NOT
 * replace the swarm's `gitleaksProtect` (which runs fail-closed inside
 * `landChange` on the write path).
 *
 * On any hit, return `secrets_found` — the diff must never be returned
 * to the caller.
 *
 * Patterns:
 * - GitHub PATs:   `ghp_`, `github_pat_`
 * - OpenAI keys:   `sk-`
 * - AWS key IDs:   `AKIA`
 * - PEM headers:   `-----BEGIN`
 * - Dotenv/key paths: lines touching `.env` or `*key*` filenames
 */
export function scanForSecrets(diff: string): DiffHygieneResult {
  // Token-prefix patterns that are high-confidence when appearing on + lines
  // or in the diff body (we scan the entire diff for safety).
  const tokenPatterns = [
    /ghp_[A-Za-z0-9_]{36,}/,
    /github_pat_[A-Za-z0-9_]{82,}/,
    /sk-[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]+-----/,
  ];

  // Sensitive file names, tested against parsed header paths rather than raw
  // lines: a removed "-- key rotation notes" comment renders as
  // "--- key rotation notes" inside a hunk body and is not a file header.
  const sensitivePathPatterns = [/\.env(\b|$)/, /\bkey\b/i];

  for (const pattern of tokenPatterns) {
    if (pattern.test(diff)) {
      return err(
        "secrets_found",
        "Diff contains a pattern matching a known credential prefix. Refusing to persist.",
      );
    }
  }

  for (const section of splitDiffIntoFileSections(diff)) {
    for (const filePath of [section.oldPath, section.newPath]) {
      if (filePath === "/dev/null") continue;
      if (sensitivePathPatterns.some((pattern) => pattern.test(filePath))) {
        return err(
          "secrets_found",
          "Diff touches a file with a sensitive name (e.g. .env, *key*). Refusing to persist.",
        );
      }
    }
  }

  return { ok: true };
}

// ─── unifiedDiffToActionResults ───────────────────────────────────────────

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
 */
export function unifiedDiffToActionResults(
  diff: string,
  repoName: string,
): ActionResult[] {
  const results: ActionResult[] = [];

  for (const section of splitDiffIntoFileSections(diff)) {
    const { oldRaw, newRaw, oldPath, newPath } = section;
    const content = section.bodyLines.join("\n");

    const isNewFile = oldRaw === "/dev/null";
    const isDeletedFile = newRaw === "/dev/null";
    const isRename = !isNewFile && !isDeletedFile && oldPath !== newPath;

    if (isNewFile) {
      results.push({ file: newPath, action: "create", content, repoName });
    } else if (isDeletedFile) {
      results.push({ file: oldPath, action: "delete", content: "", repoName });
    } else if (isRename) {
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
