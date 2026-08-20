/**
 * fix-snapshot.ts
 *
 * Generic parser for ProposedFix target-snapshot fields introduced by
 * jarvis-backend migration 105_proposed_fix_target_snapshot.
 *
 * Returns a normalized `ParsedFixSnapshot` for EVERY target_type — never
 * null for non-concept types. Degrades gracefully on unparseable envelopes
 * and renders an explicit empty state for legacy fixes with no snapshot.
 *
 * Body-key resolution table keyed on kind:
 *   "concept"  → documentation ?? docs  (both keys live in production)
 *   "prompt"   → text
 *   default    → first non-empty string value in the envelope
 *   "unknown"  → metadata only (no body extraction)
 *   "workflow" → metadata only (body suppressed — may contain secrets)
 */

import type { ProposedFix } from "@/types/legal";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ParsedFixSnapshot {
  /** target_type ?? fix_type ?? "unknown" */
  kind: string;
  /** target_name — untrusted, render as escaped text */
  title: string | null;
  /** target_version */
  version: string | null;
  /** target_ref — load-bearing for the live-node peek */
  refId: string | null;
  /** Extracted body text from old_value (null for creates) */
  before: string | null;
  /** Extracted body text from new_value */
  after: string | null;
  state: "create" | "edit" | "empty" | "unparseable";
  /**
   * Raw strings retained for "unparseable" state so the UI can still render
   * something rather than a blank panel.
   */
  raw?: { before?: string; after?: string };
}

// ── Body-key resolution ───────────────────────────────────────────────────────

/**
 * Returns the body property name(s) to try for a given kind.
 * Multiple keys are tried in order; the first non-empty string value wins.
 */
function bodyKeysForKind(kind: string): string[] {
  const k = kind.toLowerCase();
  if (k === "concept") return ["documentation", "docs"];
  if (k === "prompt") return ["text"];
  if (k === "workflow") return []; // body suppressed — may contain secrets
  if (k === "unknown") return []; // metadata only
  // Default: first non-empty string value in the envelope
  return ["__ALL__"];
}

/**
 * Resolve the body text from a parsed JSON envelope.
 * Returns null when the envelope is null/empty or has no recognizable body.
 */
function resolveBody(
  parsed: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!parsed || typeof parsed !== "object") return null;

  // "__ALL__" sentinel: try every string-valued key in order
  if (keys.length === 1 && keys[0] === "__ALL__") {
    for (const v of Object.values(parsed)) {
      if (typeof v === "string" && v.trim().length > 0) return v;
    }
    return null;
  }

  for (const key of keys) {
    const v = parsed[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

// ── JSON parsing helper ───────────────────────────────────────────────────────

type ParseResult =
  | { ok: true; parsed: Record<string, unknown> | null }
  | { ok: false; raw: string };

function tryParse(raw: string | null | undefined): ParseResult {
  if (raw == null || raw === "") {
    return { ok: true, parsed: null };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || (typeof parsed === "object" && !Array.isArray(parsed))) {
      return { ok: true, parsed: parsed as Record<string, unknown> | null };
    }
    // Unexpected shape (array, number, string) — treat as unparseable
    return { ok: false, raw };
  } catch {
    return { ok: false, raw };
  }
}

// ── Create-detection ──────────────────────────────────────────────────────────

/**
 * Returns true when old_value indicates there was no prior state:
 *   - absent / null / ""
 *   - the JSON string "null"
 *   - parses to null or {}
 *   - parses to an object whose resolved body key is missing or empty
 */
function isCreateState(
  oldValueRaw: string | null | undefined,
  bodyKeys: string[],
): boolean {
  if (!oldValueRaw || oldValueRaw === "" || oldValueRaw === "null") return true;
  const result = tryParse(oldValueRaw);
  if (!result.ok) return false; // unparseable — not necessarily create
  const p = result.parsed;
  if (p === null) return true;
  if (typeof p === "object" && Object.keys(p).length === 0) return true;
  // Check body key
  const body = resolveBody(p, bodyKeys);
  return body === null || body.trim() === "";
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Parse a ProposedFix's target-snapshot fields into a normalized shape
 * suitable for rendering by FixSnapshotPanel.
 *
 * Never returns null — every fix gets a shape; legacy fixes (no snapshot)
 * get state: "empty".
 *
 * Do NOT derive any panel state from score_delta / before_score / after_score.
 * A graph audit found all three unpopulated across all 75 live ProposedFix
 * nodes — the attributes are declared but written by nothing.
 */
export function parseFixSnapshot(fix: ProposedFix): ParsedFixSnapshot {
  const kind =
    fix.target_type?.trim() ||
    fix.fix_type?.trim() ||
    "unknown";

  const title = fix.target_name ?? null;
  const version = fix.target_version ?? null;
  const refId = fix.target_ref ?? null;

  const bodyKeys = bodyKeysForKind(kind);

  // Legacy fix: no snapshot fields at all → explicit empty state
  const hasSnapshot =
    fix.target_type != null ||
    fix.old_value != null ||
    fix.new_value != null;

  if (!hasSnapshot && !fix.fix_type) {
    return { kind, title, version, refId, before: null, after: null, state: "empty" };
  }

  // workflow: metadata only, body suppressed
  const k = kind.toLowerCase();
  if (k === "workflow" || k === "unknown") {
    return { kind, title, version, refId, before: null, after: null, state: "empty" };
  }

  // Parse new_value first — if it fails, the whole snapshot is unparseable
  const newResult = tryParse(fix.new_value);
  if (!newResult.ok) {
    const oldResult = tryParse(fix.old_value);
    return {
      kind,
      title,
      version,
      refId,
      before: null,
      after: null,
      state: "unparseable",
      raw: {
        before: !oldResult.ok ? (oldResult.raw ?? undefined) : undefined,
        after: newResult.raw ?? undefined,
      },
    };
  }

  // Parse old_value
  const oldResult = tryParse(fix.old_value);
  if (!oldResult.ok) {
    // old_value is unparseable
    return {
      kind,
      title,
      version,
      refId,
      before: null,
      after: resolveBody(newResult.parsed, bodyKeys),
      state: "unparseable",
      raw: { before: oldResult.raw ?? undefined },
    };
  }

  const afterBody = resolveBody(newResult.parsed, bodyKeys);
  const beforeBody = resolveBody(oldResult.parsed, bodyKeys);

  // Valid JSON but no recognizable body key → empty (not unparseable)
  if (
    newResult.parsed !== null &&
    Object.keys(newResult.parsed).length > 0 &&
    afterBody === null
  ) {
    return { kind, title, version, refId, before: null, after: null, state: "empty" };
  }

  // Determine create vs edit
  const createDetected = isCreateState(fix.old_value, bodyKeys);
  if (createDetected && afterBody != null) {
    return {
      kind,
      title,
      version,
      refId,
      before: null,
      after: afterBody,
      state: "create",
    };
  }

  if (beforeBody != null && afterBody != null) {
    return {
      kind,
      title,
      version,
      refId,
      before: beforeBody,
      after: afterBody,
      state: "edit",
    };
  }

  // Fallback: both sides resolved but one is empty → empty state
  return { kind, title, version, refId, before: beforeBody, after: afterBody, state: "empty" };
}
