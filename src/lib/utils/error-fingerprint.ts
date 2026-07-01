import * as crypto from "crypto";

/**
 * Number of top stack frames used when computing the default fingerprint.
 * Enough to uniquely identify a call site without being brittle to minor
 * refactors that shift unrelated frames lower in the stack.
 */
const TOP_FRAMES = 5;

/**
 * Normalise a single raw stack-trace line so that the same logical frame
 * produces the same string across different builds / deployments.
 *
 * Strips:
 *  - Absolute / relative file paths       (keep only the basename without extension)
 *  - File extensions (.ts, .js, .mjs …)   (TS source and compiled JS are the same)
 *  - Line and column numbers              (:123:45)
 *  - Leading/trailing whitespace
 *
 * Examples
 *   "    at resolveUser (/app/src/lib/auth.ts:42:20)"     → "resolveUser (auth)"
 *   "    at resolveUser (/build/src/lib/auth.js:88:42)"   → "resolveUser (auth)"
 *   "    at processTicksAndRejections (node:internal/…)"  → "processTicksAndRejections (task_queues)"
 */
function normaliseFrame(raw: string): string {
  // Strip "at " prefix and trim
  let frame = raw.trim().replace(/^at\s+/, "");

  // Remove absolute/relative path segments — keep only the basename without extension
  // e.g. "/workspace/src/lib/utils/foo.ts:10:5"  → "foo"
  //       "(node:internal/process/task_queues:95:5)" → "task_queues"
  frame = frame.replace(/\(([^)]+)\)/g, (_match, inner) => {
    // strip line:col
    const withoutLineCol = inner.replace(/:\d+(?::\d+)?$/, "");
    // take basename and drop extension
    const basename = withoutLineCol.split("/").pop() ?? withoutLineCol;
    const noExt = basename.replace(/\.[cm]?[jt]sx?$/, "");
    return `(${noExt || basename})`;
  });

  // Remove standalone path-like tokens outside parens
  frame = frame.replace(/\S*[/\\]\S*/g, (token) => {
    const basename = token.split(/[/\\]/).pop() ?? token;
    return basename.replace(/\.[cm]?[jt]sx?$/, "") || basename;
  });

  // Strip any remaining line:column numbers
  frame = frame.replace(/:\d+(?::\d+)?/g, "");

  // Collapse whitespace
  return frame.replace(/\s+/g, " ").trim();
}

/**
 * Parse a stack-trace string into individual frames (non-empty lines).
 */
function parseFrames(stackTrace: string): string[] {
  return stackTrace
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("at ") || l.length > 0);
}

/**
 * Compute a stable fingerprint for an error occurrence.
 *
 * @param params.exceptionType      Exception class name (e.g. "TypeError")
 * @param params.stackTrace         Raw stack-trace string (optional)
 * @param params.clientFingerprint  Caller-supplied override (optional)
 *
 * If `clientFingerprint` is present and non-empty it is used verbatim —
 * this lets callers group errors by logical feature rather than call site.
 *
 * Otherwise the default fingerprint is the SHA-256 hex of:
 *   exceptionType + normalised top-N stack frames
 * Normalisation strips paths / line-numbers so the same logical frame
 * produces the same fingerprint across different releases.
 */
export function computeFingerprint(params: {
  exceptionType: string;
  stackTrace?: string;
  clientFingerprint?: string;
}): string {
  const { exceptionType, stackTrace, clientFingerprint } = params;

  // Client override — trust as-is
  if (clientFingerprint && clientFingerprint.trim().length > 0) {
    return clientFingerprint.trim();
  }

  // Default: hash of type + normalised top frames
  const frames = stackTrace ? parseFrames(stackTrace) : [];
  const topFrames = frames
    .slice(0, TOP_FRAMES)
    .map(normaliseFrame)
    .filter(Boolean)
    .join("|");

  const input = `${exceptionType}::${topFrames}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}
