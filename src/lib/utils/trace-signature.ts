import * as crypto from "crypto";

// Re-export resolveRepoKey for callers that only need it from this module.
// The implementation lives in error-fingerprint.ts — not duplicated here.
export { resolveRepoKey } from "@/lib/utils/error-fingerprint";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Span {
  name?: string;
  op: string;
  startMs?: number;
  durationMs: number;
}

// ── DB op detection ───────────────────────────────────────────────────────────

/**
 * Regex matching op values that represent database queries.
 * Matches: db, db.query, db.sql, db.*, db.execute, etc.
 */
const DB_OP_RE = /^db(\..+)?$/i;

/**
 * Sum the durationMs of spans whose `op` matches a known DB op-type.
 * Returns 0 for an empty span array or when no DB spans are present.
 */
export function deriveDbTimeMs(spans: Span[]): number {
  return spans.reduce((total, span) => {
    return DB_OP_RE.test(span.op ?? "") ? total + (span.durationMs ?? 0) : total;
  }, 0);
}

// ── Signature computation ─────────────────────────────────────────────────────

/**
 * Normalize the span op-type sequence into a stable string.
 * Order is preserved (transaction-level ordering) but individual span
 * names/timings are ignored so that repeated calls with the same shape
 * collapse to the same signature regardless of actual values.
 */
function normalizeSpanOps(spans: Span[]): string {
  return spans.map((s) => (s.op ?? "unknown").trim().toLowerCase()).join(",");
}

/**
 * Compute a stable grouping signature for a performance trace.
 *
 * If the caller supplies a non-empty `clientSignature`, it is used as-is
 * (allows intentional grouping override — mirrors `computeFingerprint`'s
 * `clientFingerprint` param).
 *
 * Otherwise, produces a SHA-256 hash of:
 *   transactionName + "\n" + normalized span op-type sequence
 *
 * A transaction with no spans produces a signature based only on its name.
 */
export function computeTraceSignature({
  transactionName,
  spans = [],
  clientSignature,
}: {
  transactionName: string;
  spans?: Span[];
  clientSignature?: string | null;
}): string {
  if (clientSignature && clientSignature.trim()) {
    return clientSignature.trim();
  }

  const normalizedOps = normalizeSpanOps(spans);
  const input = [transactionName.trim(), normalizedOps].join("\n");
  return crypto.createHash("sha256").update(input).digest("hex");
}
