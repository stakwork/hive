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

  const lines = diff.split("\n");

  const hasFilePairs =
    lines.some((l) => l.startsWith("--- ")) &&
    lines.some((l) => l.startsWith("+++ "));

  if (!hasFilePairs) {
    return err(
      "malformed_diff",
      "Diff has no --- / +++ file header pairs. Expected unified diff format.",
    );
  }

  const hasHunk = lines.some((l) => l.startsWith("@@"));
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

  // Count distinct file pairs (each "--- a/..." starts a new file entry)
  const fileCount = diff
    .split("\n")
    .filter((l) => l.startsWith("--- ")).length;

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

  // Sensitive file path patterns in diff headers
  const sensitivePathPatterns = [
    /\+\+\+ .*\.env(\b|$)/,
    /\+\+\+ .*\.env\./,
    /--- .*\.env(\b|$)/,
    /--- .*\.env\./,
    /\+\+\+ .*\bkey\b/i,
    /--- .*\bkey\b/i,
  ];

  for (const pattern of tokenPatterns) {
    if (pattern.test(diff)) {
      return err(
        "secrets_found",
        "Diff contains a pattern matching a known credential prefix. Refusing to persist.",
      );
    }
  }

  for (const pattern of sensitivePathPatterns) {
    if (pattern.test(diff)) {
      return err(
        "secrets_found",
        "Diff touches a file with a sensitive name (e.g. .env, *key*). Refusing to persist.",
      );
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
  const lines = diff.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.startsWith("--- ")) {
      i++;
      continue;
    }

    const oldRaw = line.slice(4).trim();
    const nextLine = lines[i + 1] ?? "";

    if (!nextLine.startsWith("+++ ")) {
      i++;
      continue;
    }

    const newRaw = nextLine.slice(4).trim();
    i += 2; // consume both header lines

    const oldPath = stripGitPrefix(oldRaw);
    const newPath = stripGitPrefix(newRaw);

    const isNewFile = oldRaw === "/dev/null";
    const isDeletedFile = newRaw === "/dev/null";
    const isRename =
      !isNewFile && !isDeletedFile && oldPath !== newPath;

    if (isNewFile) {
      // Collect hunk content for the new file
      const content = collectHunkContent(lines, i);
      results.push({ file: newPath, action: "create", content, repoName });
    } else if (isDeletedFile) {
      results.push({ file: oldPath, action: "delete", content: "", repoName });
    } else if (isRename) {
      results.push({ file: oldPath, action: "delete", content: "", repoName });
      const content = collectHunkContent(lines, i);
      results.push({ file: newPath, action: "create", content, repoName });
    } else {
      // Same file — determine modify vs rewrite
      const content = collectHunkContent(lines, i);
      const action = isWholeFileReplacement(lines, i) ? "rewrite" : "modify";
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

/**
 * Collect the raw diff content for the current file section.
 * Stops when the next `--- ` line (next file) or end of diff is reached.
 */
function collectHunkContent(lines: string[], startIdx: number): string {
  const parts: string[] = [];
  let i = startIdx;
  while (i < lines.length && !lines[i].startsWith("--- ")) {
    parts.push(lines[i]);
    i++;
  }
  return parts.join("\n");
}

/**
 * Determine whether the file's hunks constitute a whole-file replacement:
 * no context lines (lines starting with " ") appear in any hunk that
 * belongs to this file.
 *
 * A whole-file replacement has only `+` and `-` lines inside `@@` hunks.
 * If there are context lines the file is `modify`.
 */
function isWholeFileReplacement(lines: string[], startIdx: number): boolean {
  let inHunk = false;
  let hasContext = false;

  for (let i = startIdx; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("--- ")) break; // next file
    if (l.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (inHunk && l.startsWith(" ")) {
      hasContext = true;
      break;
    }
  }

  return inHunk && !hasContext;
}
