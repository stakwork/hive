/**
 * Shared key-based redaction, promoted from `src/services/error-issues.ts`.
 *
 * Fixed rather than lifted unchanged. The original returned the object
 * UNTOUCHED once `depth > 10`, which is precisely where per-agent transcript
 * traces in a run report bundle live — so the old bound would have let the
 * deepest, most secret-dense part of the payload through unredacted. Changes:
 *   - depth bound raised substantially, and on overflow the subtree is dropped
 *     rather than passed through
 *   - WeakSet cycle guard (the original would stack-overflow on a cycle)
 *   - key set extended with the bundle's key names and report_url/reportUrl
 */

/** Exact-match keys whose values are always replaced wholesale. */
export const REDACTED_KEYS = new Set([
  // original eight
  "authorization",
  "cookie",
  "token",
  "secret",
  "password",
  "x-api-key",
  "api_key",
  "apikey",
  // bundle + this feature
  "report_url",
  "reporturl",
  "webhook_url",
  "webhookurl",
  "run_token",
  "runtoken",
  "apikey_",
  "aws_secret_access_key",
  "aws_access_key_id",
  "swarm_secret_alias",
  "swarmsecretalias",
  "bearer",
  "credentials",
  "private_key",
  "privatekey",
]);

/**
 * Depth bound. Generous because agent transcript traces nest deeply and the
 * old bound of 10 sat right inside them. On overflow we DROP rather than
 * pass through — an un-walked subtree must never be emitted unredacted.
 */
const MAX_DEPTH = 64;

const DEPTH_EXCEEDED = "[DEPTH_EXCEEDED]";
const CYCLE = "[CYCLE]";
const REDACTED = "[REDACTED]";

/**
 * Token-shaped value patterns. Applied ONLY to trace/config string fields —
 * see `redactTokenShapes`. Never applied to document bodies.
 */
const TOKEN_SHAPES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bASIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

/**
 * Replace token-shaped substrings in a single string.
 *
 * SCOPED, NOT GLOBAL. Callers must apply this only to log/trace/config fields
 * (`analysis.traces[*]`, `page_data.set_var`, `page_data.log_stats`,
 * `page_data.outputs`) and never to `source_docs[].html` or `workfiles[].text`.
 * A blanket high-entropy match over converted legal documents would corrupt
 * docket numbers, registration ids and base64 exhibits, and the bundle
 * generator already redacts secrets at emission time — so on document bodies
 * the pass is both destructive and redundant. On trace/config fields it is
 * cheap defense-in-depth against a producer that stops redacting.
 */
export function redactTokenShapes(value: string): string {
  let out = value;
  for (const pattern of TOKEN_SHAPES) {
    // Reset lastIndex: these are module-level /g regexes reused across calls.
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

export interface RedactOptions {
  /** Apply the value-level token-shape pass to string leaves. Default false. */
  tokenShapes?: boolean;
}

/**
 * Recursively redact values under sensitive keys.
 *
 * @param obj    Arbitrary parsed JSON.
 * @param options `tokenShapes: true` additionally scrubs token-shaped strings.
 *                Only pass it for trace/config subtrees.
 */
export function redactSensitiveKeys(obj: unknown, options: RedactOptions = {}): unknown {
  return walk(obj, 0, new WeakSet<object>(), options.tokenShapes === true);
}

function walk(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  tokenShapes: boolean,
): unknown {
  if (typeof value === "string") {
    return tokenShapes ? redactTokenShapes(value) : value;
  }

  if (value === null || typeof value !== "object") return value;

  if (depth > MAX_DEPTH) return DEPTH_EXCEEDED;

  const asObject = value as object;
  if (seen.has(asObject)) return CYCLE;
  seen.add(asObject);

  try {
    if (Array.isArray(value)) {
      return value.map((v) => walk(v, depth + 1, seen, tokenShapes));
    }

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = REDACTED_KEYS.has(k.toLowerCase())
        ? REDACTED
        : walk(v, depth + 1, seen, tokenShapes);
    }
    return result;
  } finally {
    // Remove on the way out so sibling references to the same object are
    // redacted normally — only true ancestor cycles are cut.
    seen.delete(asObject);
  }
}
