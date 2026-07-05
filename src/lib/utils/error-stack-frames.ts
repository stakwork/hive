import { StructuredFrame } from "@/lib/utils/error-frames";

export interface StackFrame {
  filePath: string | null;
  functionName: string | null;
}

const TOP_FRAME_COUNT = 5;

/**
 * Select frame candidates for KG edge resolution.
 *
 * Primary source: sanitized structured `frames` array (supports Ruby and all
 * non-JS runtimes). When frames are present, prefer `inApp === true` entries;
 * if none are flagged in-app, fall back to all frames (tolerate SDKs that
 * don't set the flag).
 *
 * Fallback: `parseStackFrames(stackTrace)` — used only for older JS clients
 * that send a raw stack string without structured frames.
 */
export function selectFrameCandidates(
  frames: StructuredFrame[],
  stackTrace: string | null,
): { candidates: StackFrame[]; source: "frames" | "stackTrace" } {
  if (frames.length > 0) {
    const inAppFrames = frames.filter((f) => f.inApp === true);
    const selected = (inAppFrames.length > 0 ? inAppFrames : frames).slice(0, TOP_FRAME_COUNT);
    const candidates = selected.map((f) => ({
      filePath: f.filename,
      functionName: f.function ?? null,
    }));
    return { candidates, source: "frames" };
  }

  const candidates = parseStackFrames(stackTrace ?? "");
  return { candidates, source: "stackTrace" };
}

/**
 * Extract the top N file paths and function names from a raw stack trace.
 * Handles the common V8/Node format: "  at FnName (path/to/file.ts:10:5)"
 * and the Firefox/Safari format:  "FnName@path/to/file.ts:10:5"
 */
export function parseStackFrames(stackTrace: string): StackFrame[] {
  const lines = stackTrace
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, TOP_FRAME_COUNT);

  return lines
    .map((line): StackFrame => {
      // V8: "at FunctionName (file.ts:10:5)" or "at file.ts:10:5"
      const v8Match = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?)(?::\d+:\d+)?\)?\s*$/);
      if (v8Match) {
        const rawFn = v8Match[1] ?? null;
        const rawPath = v8Match[2] ?? null;
        return {
          filePath: rawPath ? extractFileName(rawPath) : null,
          functionName: rawFn && rawFn !== "<anonymous>" ? cleanFunctionName(rawFn) : null,
        };
      }

      // Firefox/Safari: "FnName@http://...file.js:10:5" or "FnName@file.js:10:5"
      const ffMatch = line.match(/^(.+?)@(.+?)(?::\d+:\d+)?$/);
      if (ffMatch) {
        return {
          filePath: extractFileName(ffMatch[2]),
          functionName: ffMatch[1] && ffMatch[1] !== "<anonymous>" ? ffMatch[1] : null,
        };
      }

      return { filePath: null, functionName: null };
    })
    .filter((f) => f.filePath !== null || f.functionName !== null);
}

/** Keep only the basename to match graph node file_path properties. */
function extractFileName(raw: string): string | null {
  if (!raw) return null;
  // Strip line:col if present
  const stripped = raw.replace(/:\d+:\d+$/, "").replace(/\)$/, "");
  // Return the last path segment
  const parts = stripped.split(/[/\\]/);
  const last = parts[parts.length - 1];
  return last || null;
}

/** Trim common wrapper noise from function names (e.g. "Object.<anonymous>"). */
function cleanFunctionName(raw: string): string {
  return raw.replace(/^Object\.<anonymous>$/, "<anonymous>").trim();
}

/**
 * Match a File node from a set of repo-scoped nodes using strongest-match
 * precedence: (a) exact, (b) full-relative-path suffix, (c) bare-basename
 * only when unambiguous. Ties at the same strength level are treated as
 * ambiguous and no node is returned, preventing wrong-file linkage.
 *
 * Real File nodes store their path under the `file` property (full
 * repo-qualified, e.g. "stakwork/senza-lnd/app/workers/x.rb"). The
 * `file_path` fallback is retained for other node shapes.
 */
export function matchFileNode(
  repoNodes: Array<{ ref_id?: string; node_type: string; properties?: Record<string, unknown> }>,
  framePath: string,
): { ref_id?: string; node_type: string; properties?: Record<string, unknown> } | undefined {
  const norm = framePath.replace(/\\/g, "/");
  const fileNodes = repoNodes.filter((n) => n.node_type === "File");

  // (a) Exact match
  const exactMatches = fileNodes.filter((n) => {
    const nodePath = ((n.properties?.file ?? n.properties?.file_path) as string | undefined)?.replace(/\\/g, "/");
    return nodePath === norm;
  });
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return undefined; // ambiguous — skip

  // (b) Full relative path suffix: endsWith("/" + norm)
  const suffixMatches = fileNodes.filter((n) => {
    const nodePath = ((n.properties?.file ?? n.properties?.file_path) as string | undefined)?.replace(/\\/g, "/");
    return nodePath?.endsWith("/" + norm);
  });
  if (suffixMatches.length === 1) return suffixMatches[0];
  if (suffixMatches.length > 1) return undefined; // ambiguous — skip

  // (c) Bare basename — only when unambiguous
  const basename = norm.includes("/") ? norm.slice(norm.lastIndexOf("/") + 1) : norm;
  if (!basename || basename === norm) {
    // framePath is already a bare basename; this level was already covered
    // by exact/suffix above, so no further resolution possible.
    return undefined;
  }
  const basenameMatches = fileNodes.filter((n) => {
    const nodePath = ((n.properties?.file ?? n.properties?.file_path) as string | undefined)?.replace(/\\/g, "/");
    return nodePath?.endsWith("/" + basename) || nodePath === basename;
  });
  if (basenameMatches.length === 1) return basenameMatches[0];
  return undefined; // ambiguous or not found
}

/**
 * Return true when the node's path ends with or equals `framePath`.
 * Reads `file` (real node property) falling back to `file_path`.
 */
export function matchesFilePath(nodePath: string | undefined, framePath: string | null): boolean {
  if (!nodePath || !framePath) return false;
  const norm = nodePath.replace(/\\/g, "/");
  const frame = framePath.replace(/\\/g, "/");
  return norm === frame || norm.endsWith("/" + frame);
}
