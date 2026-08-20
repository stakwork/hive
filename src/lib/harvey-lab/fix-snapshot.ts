/**
 * fix-snapshot.ts
 *
 * Normalizer for the generic before/after snapshot the ontology records on
 * every ProposedFix (`target_type` / `target_name` / `target_version` /
 * `target_ref` / `old_value` / `new_value`, written by jarvis-backend
 * migration `105_proposed_fix_target_snapshot`).
 *
 * `parseFixSnapshot` returns ONE normalized shape for every `target_type` —
 * never null-for-non-concept — so a single generic reader can render concept,
 * prompt, workflow and future target kinds without per-kind branching. All
 * snapshot strings are graph-authored and untrusted: this module only parses;
 * rendering must keep every value as escaped text.
 */

// ── Input shape ───────────────────────────────────────────────────────────────

/**
 * The snapshot-relevant subset of a ProposedFix. `ProposedFix` from
 * `@/types/legal` is structurally assignable, as is the sidecar value
 * `buildHillClimbSeries` extracts from raw graph nodes.
 */
export interface FixSnapshotProps {
  /** ProposedFix graph node ref_id */
  ref_id?: string | null;
  /** Canonical target kind ("concept", "prompt", "workflow", …) */
  target_type?: string | null;
  /** Legacy fix-kind field — fallback when target_type is absent */
  fix_type?: string | null;
  /** Display name of the targeted node at fix time */
  target_name?: string | null;
  /** Version of the targeted node at fix time */
  target_version?: string | null;
  /** Live graph ref_id of the targeted node — drives the open-live-node link */
  target_ref?: string | null;
  /** JSON envelope of the node before the fix (json.dumps'd; absent on create) */
  old_value?: string | null;
  /** JSON envelope of the node after the fix (json.dumps'd) */
  new_value?: string | null;
  /** Canonical accept/reject lifecycle field */
  eval_status?: string | null;
  /** Legacy status field — fallback when eval_status is absent */
  status?: string | null;
  /** Rerun id, kept for run attribution */
  rerun_run_id?: string | null;
  /**
   * Series point ref this fix resolved to, populated by buildHillClimbSeries
   * when it emits the sidecar map (null when the fix produced no chart point).
   */
  point_ref_id?: string | null;
}

// ── Output shape ──────────────────────────────────────────────────────────────

export type FixSnapshotState = "create" | "edit" | "empty" | "unparseable";

export interface ParsedFixSnapshot {
  /** target_type ?? fix_type ?? "unknown", lowercased */
  kind: string;
  /** target_name */
  title: string | null;
  /** target_version */
  version: string | null;
  /** target_ref — null suppresses the live-node link */
  refId: string | null;
  /** Resolved body text before the fix ("" when absent) */
  before: string;
  /** Resolved body text after the fix ("" when absent) */
  after: string;
  state: FixSnapshotState;
  /** The raw envelope string retained when state is "unparseable" */
  raw?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return v != null ? String(v) : null;
  return v.trim() === "" ? null : v;
}

/** A snapshot side is "present" when it holds any non-blank string at all. */
function hasValue(v: string | null | undefined): boolean {
  return v != null && v.trim() !== "";
}

type EnvelopeResult = { ok: true; value: unknown } | { ok: false; raw: string };

/**
 * Parse one snapshot side. Absent / "" / "null" all normalize to a null
 * envelope (the create shapes jarvis actually writes); malformed JSON is
 * surfaced with the raw string retained rather than thrown.
 */
function parseEnvelope(raw: string | null | undefined): EnvelopeResult {
  if (raw == null) return { ok: true, value: null };
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "null") return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, raw };
  }
}

/**
 * Resolve the body text for a parsed envelope, keyed on the fix kind:
 *   concept → `documentation ?? docs` (both are live today)
 *   prompt  → `text`
 *   unknown → none (metadata renders alone)
 *   default → first non-empty string value in the envelope
 * A bare JSON string envelope is its own body. Returns null when no body is
 * recognizable — the caller maps that to "empty", never "unparseable".
 */
function resolveBody(kind: string, envelope: unknown): string | null {
  if (typeof envelope === "string") {
    return envelope.trim() === "" ? null : envelope;
  }
  if (envelope == null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return null;
  }
  const record = envelope as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const v = record[key];
      if (typeof v === "string" && v.trim() !== "") return v;
    }
    return null;
  };
  switch (kind) {
    case "concept":
      return pick("documentation", "docs");
    case "prompt":
      return pick("text");
    case "unknown":
      return null;
    default: {
      for (const v of Object.values(record)) {
        if (typeof v === "string" && v.trim() !== "") return v;
      }
      return null;
    }
  }
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Normalize a fix's snapshot into a single renderable shape.
 *
 * States:
 *  - "empty"       — no snapshot recorded (legacy fixes), or valid JSON with
 *                    no recognizable body on either side
 *  - "unparseable" — either envelope failed JSON.parse; `raw` retains the
 *                    failing string for the (escaped) fallback banner
 *  - "create"      — after-body present, before side absent/""/"null"/null/{} /
 *                    body key missing or empty
 *  - "edit"        — both bodies resolved
 */
export function parseFixSnapshot(fix: FixSnapshotProps | null | undefined): ParsedFixSnapshot {
  const p = fix ?? {};
  const kindRaw = strOrNull(p.target_type) ?? strOrNull(p.fix_type);
  const kind = kindRaw ? kindRaw.trim().toLowerCase() : "unknown";
  const base = {
    kind,
    title: strOrNull(p.target_name),
    version: strOrNull(p.target_version),
    refId: strOrNull(p.target_ref),
  };

  if (!hasValue(p.old_value) && !hasValue(p.new_value)) {
    return { ...base, before: "", after: "", state: "empty" };
  }

  const oldResult = parseEnvelope(p.old_value);
  const newResult = parseEnvelope(p.new_value);
  if (!newResult.ok || !oldResult.ok) {
    const raw = !newResult.ok ? newResult.raw : (oldResult as { ok: false; raw: string }).raw;
    return { ...base, before: "", after: "", state: "unparseable", raw };
  }

  const before = resolveBody(kind, oldResult.value) ?? "";
  const after = resolveBody(kind, newResult.value) ?? "";

  if (before === "" && after === "") {
    return { ...base, before, after, state: "empty" };
  }
  return { ...base, before, after, state: before === "" ? "create" : "edit" };
}

// ── Status resolution ─────────────────────────────────────────────────────────

/**
 * Canonical accept/reject resolution: `eval_status` wins, legacy `status` is
 * the fallback — the same precedence as `isAccepted` in hill-climb-series.ts.
 * Returns the lowercased status, or null when neither field is present.
 */
export function resolveFixStatus(
  fix: Pick<FixSnapshotProps, "eval_status" | "status"> | null | undefined,
): string | null {
  const raw = fix?.eval_status ?? fix?.status;
  if (raw == null) return null;
  const normalized = String(raw).trim().toLowerCase();
  return normalized === "" ? null : normalized;
}

// ── Graph-node extraction ─────────────────────────────────────────────────────

/**
 * Extract snapshot props from a raw ProposedFix graph node's properties.
 * Returns null when the node carries no snapshot at all (no target_type and
 * no old/new value) — legacy fixes — so consumers can hide snapshot
 * affordances instead of offering an empty dialog. A bare legacy `fix_type`
 * without values deliberately does NOT count as a snapshot.
 */
export function extractFixSnapshotProps(
  refId: string,
  props: Record<string, unknown> | undefined,
): FixSnapshotProps | null {
  const p = props ?? {};
  const str = (key: string): string | null => {
    const v = p[key];
    return v != null ? String(v) : null;
  };
  const target_type = str("target_type");
  const old_value = str("old_value");
  const new_value = str("new_value");
  if (target_type == null && old_value == null && new_value == null) return null;
  return {
    ref_id: refId,
    target_type,
    fix_type: str("fix_type"),
    target_name: str("target_name"),
    target_version: str("target_version"),
    target_ref: str("target_ref"),
    old_value,
    new_value,
    eval_status: str("eval_status"),
    status: str("status"),
    rerun_run_id: str("rerun_run_id"),
  };
}
