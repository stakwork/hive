/**
 * Shared GitHub link utilities for error tracking and stack trace navigation.
 * Used by BlobViewer to render per-frame GitHub permalink links.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface StackFrameLine {
  /** Original raw line from the stack trace */
  raw: string;
  /** Function/method name if parseable, otherwise null */
  functionName: string | null;
  /** Normalized, repo-relative file path (stripped of build prefixes) */
  path: string | null;
  /** Line number (1-based) */
  line: number | null;
  /** Whether this frame can be linked to a GitHub source line */
  resolvable: boolean;
}

// ── parseOwnerRepo ───────────────────────────────────────────────────────────

/**
 * Parses a GitHub repository URL (SSH or HTTPS) into owner and repo name.
 * Handles:
 *   - SSH:   git@github.com:owner/repo.git
 *   - HTTPS: https://github.com/owner/repo
 *   - Trailing .git is stripped in both forms.
 *
 * @throws if the URL doesn't match a recognised pattern.
 */
export function parseOwnerRepo(url: string): { owner: string; repo: string } {
  const u = url.trim().replace(/\.git$/i, "");
  // SSH form: git@host:owner/repo
  const ssh = u.match(/^git@[^:]+:([^/]+)\/([^/]+?)\/?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  // HTTPS form: https://host/owner/repo
  const https = u.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)\/?$/i);
  if (https) return { owner: https[1], repo: https[2] };
  throw new Error(`Cannot parse owner/repo from: ${url}`);
}

// ── parseStackFrameLines ─────────────────────────────────────────────────────

/** Prefixes stripped to normalise paths to repo-relative form */
const STRIP_PREFIXES = [
  /^webpack-internal:\/\/\/\.\//,
  /^webpack-internal:\/\/\//,
  /^\/app\//,
  /^\.\//,
  /^\/var\/task\//,
  /^\/home\/[^/]+\/[^/]+\//,   // common Docker working dirs
];

/** Patterns that mark a frame as non-resolvable */
const UNRESOLVABLE_PATTERNS = [
  /node_modules/,
  /webpack-internal/,
  /<anonymous>/,
  /\(native\)/,
  /^\[/,      // e.g. [as runInThisContext]
  /^eval /,
];

function stripBuildPrefixes(filePath: string): string {
  for (const prefix of STRIP_PREFIXES) {
    if (prefix.test(filePath)) {
      return filePath.replace(prefix, "");
    }
  }
  return filePath;
}

function isResolvable(rawPath: string, normalizedPath: string): boolean {
  if (!normalizedPath) return false;
  for (const pat of UNRESOLVABLE_PATTERNS) {
    if (pat.test(rawPath)) return false;
  }
  // Must look like a file (has extension or at least a slash or dot)
  if (!/[./]/.test(normalizedPath)) return false;
  // Absolute path that wasn't stripped is not repo-relative
  if (normalizedPath.startsWith("/")) return false;
  return true;
}

/**
 * Parses a raw stack trace string into structured frame objects.
 * Supports V8 (`at Fn (path:line:col)`) and Firefox/Safari (`Fn@path:line:col`) formats.
 * Does NOT replace the server-side `parseStackFrames` (for KG matching) — this is
 * a client-facing parser that preserves full paths and line numbers for GitHub linking.
 */
export function parseStackFrameLines(rawStackTrace: string): StackFrameLine[] {
  if (!rawStackTrace) return [];

  return rawStackTrace
    .split("\n")
    .map((raw): StackFrameLine => {
      const line = raw.trim();

      // ── V8 format: `at FunctionName (file:line:col)` or `at file:line:col`
      const v8WithFn = line.match(/^at\s+(.+?)\s+\((.+):(\d+):\d+\)$/);
      if (v8WithFn) {
        const [, fn, filePath, lineNum] = v8WithFn;
        const normalized = stripBuildPrefixes(filePath);
        return {
          raw,
          functionName: fn.trim() || null,
          path: normalized || null,
          line: parseInt(lineNum, 10),
          resolvable: isResolvable(filePath, normalized),
        };
      }

      // V8 without function name: `at file:line:col`
      const v8NoFn = line.match(/^at\s+(.+):(\d+):\d+$/);
      if (v8NoFn) {
        const [, filePath, lineNum] = v8NoFn;
        const normalized = stripBuildPrefixes(filePath);
        return {
          raw,
          functionName: null,
          path: normalized || null,
          line: parseInt(lineNum, 10),
          resolvable: isResolvable(filePath, normalized),
        };
      }

      // ── Firefox/Safari format: `functionName@file:line:col`
      const firefox = line.match(/^(.+?)@(.+):(\d+):\d+$/);
      if (firefox) {
        const [, fn, filePath, lineNum] = firefox;
        const normalized = stripBuildPrefixes(filePath);
        return {
          raw,
          functionName: fn.trim() || null,
          path: normalized || null,
          line: parseInt(lineNum, 10),
          resolvable: isResolvable(filePath, normalized),
        };
      }

      // ── Unrecognised line (e.g. error message header, blank line)
      return {
        raw,
        functionName: null,
        path: null,
        line: null,
        resolvable: false,
      };
    });
}

// ── buildBlobUrl ─────────────────────────────────────────────────────────────

/**
 * Builds a GitHub blob permalink for a specific file + line + ref.
 * e.g. https://github.com/owner/repo/blob/abc1234/src/index.ts#L42
 */
export function buildBlobUrl({
  repositoryUrl,
  ref,
  path,
  line,
}: {
  repositoryUrl: string;
  ref: string;
  path: string;
  line: number;
}): string {
  const { owner, repo } = parseOwnerRepo(repositoryUrl);
  return `https://github.com/${owner}/${repo}/blob/${ref}/${path}#L${line}`;
}

// ── resolveRef ───────────────────────────────────────────────────────────────

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * Resolves the best Git ref to use for building GitHub links.
 * Precedence:
 *   1. commitSha (if present)
 *   2. release (if it looks like a SHA: 7–40 hex chars)
 *   3. defaultBranch (fallback to "main" if null)
 */
export function resolveRef({
  commitSha,
  release,
  defaultBranch,
}: {
  commitSha: string | null;
  release: string | null;
  defaultBranch: string | null;
}): string {
  if (commitSha) return commitSha;
  if (release && SHA_PATTERN.test(release)) return release;
  return defaultBranch ?? "main";
}
