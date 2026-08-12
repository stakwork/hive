/**
 * Tolerant tool-activity normalizer.
 *
 * Consumes the raw `concepts.tool_activity` subtree (field names not yet
 * finalized upstream) and emits fully-typed, classified, de-duplicated data
 * structures for the renderer to consume. Nothing downstream touches raw
 * bundle keys.
 *
 * Organization: small pure functions, exported surface at the bottom.
 *
 * Key design decisions:
 *  - Field resolution via candidate-key lists (not hardcoded names) so a
 *    producer rename costs one fixture edit and zero test edits.
 *  - Ordering decided once per run (not per agent group) so two panels cannot
 *    silently mean different things by "call order".
 *  - Identity resolved without requiring ref_id — Hive's graph tools span
 *    kg/canvas/pg realms, only kg returns ref_id.
 *  - Classification and aggregation run BEFORE any truncation so an identity
 *    cannot be downgraded by a cap on its retrieval-evidence call.
 *  - Status derivation is behaviour-based (observed node counts), not
 *    class-based, so ontology-style calls are never misbadged EMPTY.
 */

import { parseUrn } from "@/lib/urn/parse";
import { isRecord, asString } from "./derive";
import { REDACTED_KEYS } from "./redact";

// ── Candidate-key lists ──────────────────────────────────────────────────────

/**
 * Keys under which the producer may ship the tool-activity record array.
 * Exported so the projector's strip step reuses the same list and the two
 * can never disagree about which key holds the records.
 */
export const TOOL_ACTIVITY_CONTAINER_KEYS = [
  "tool_activity",
  "toolActivity",
  "tool_calls",
  "toolCalls",
] as const;

/** Keys under which a single record's ordering key may appear. */
const SEQ_KEYS = ["seq", "sequence", "order", "index"] as const;

/** Keys under which a record's input may appear. */
const INPUT_KEYS = ["input", "inputs", "args", "arguments", "params"] as const;

/** Keys under which the returned node array may appear. */
const NODES_KEYS = ["nodes", "results", "output_nodes", "outputNodes"] as const;

/** Nested path: result.nodes or output.nodes */
const RESULT_NODES_KEYS = ["result", "output"] as const;

/** Keys under which a node's identity may appear, in priority order. */
const IDENTITY_KEYS = ["ref_id", "refId", "urn", "node_id", "nodeId", "id"] as const;

/** Keys whose presence indicates content (not just metadata). */
const CONTENT_KEYS = ["properties", "body", "content", "text", "snippet"] as const;

// ── Identity kind ────────────────────────────────────────────────────────────

/** Which candidate key the identity came from. */
export type IdentityKind = "ref_id" | "urn" | "id";

function identityKindOf(key: string): IdentityKind {
  const k = key.toLowerCase();
  if (k === "ref_id" || k === "refid") return "ref_id";
  if (k === "urn") return "urn";
  return "id";
}

// ── TOOL_CLASS map ────────────────────────────────────────────────────────────

/**
 * Classification of graph tool calls by their retrieval semantics.
 *
 * Matched on normalized (trimmed, lowercased) tool name.
 * The verified/inferred split is deliberate — do not merge the two blocks.
 */
export const TOOL_CLASS: Record<string, "surfacing" | "retrieval" | "none"> = {
  // ── Verified against src/lib/ai/graphWalkerTools.ts ────────────────────────
  // These are the ONLY four tool keys that file defines.
  graph_search: "surfacing",
  graph_get: "retrieval",
  graph_neighbors: "retrieval",
  graph_ontology: "none",

  // ── INFERRED — harness-side names NOT present in this repo ────────────────
  // Review against the first real bundle and delete or correct as needed.
  graph_node: "retrieval", // presumed legacy name for graph_get
  get_ontology: "none",
  get_ontology_type: "none",
};

// ── Public types ──────────────────────────────────────────────────────────────

export type ToolCallStatus = "ok" | "empty" | "error";
export type RetrievalBasis = "content" | "input" | "tool-class";
export type RetrievalStatus = "surfaced" | "retrieved";
export type OrderingBasis = "seq" | "position";

/** A single node returned by a tool call, as normalized by this module. */
export interface NormalizedNode {
  /** Raw identity value (for display/copy). Undefined when no identity field. */
  identity?: string;
  /** Which candidate key the identity came from. */
  identityKind?: IdentityKind;
  /**
   * Dedup key. `realm/type/id` when identity parses as a URN, else the raw
   * identity value, else undefined (node has no identity).
   */
  canonicalKey?: string;
  name: string | null;
  nodeType: string | null;
  /** Whether the node carries content (not just metadata). */
  hasContent: boolean;
  /** The retrieval basis for this specific node (set during classification). */
  retrievalBasis?: RetrievalBasis;
  /** Whether this node's identity evidence was truncated off-screen. */
  evidenceTruncated?: boolean;
}

/** A single tool call record, as normalized by this module. */
export interface NormalizedToolCall {
  /** Normalized (lowercased) tool name. */
  toolName: string;
  /** Raw tool name from the bundle (for display). */
  rawToolName: string;
  /** Input object (redaction applied upstream by project.ts). */
  input: Record<string, unknown>;
  /** Returned nodes. Empty when no nodes were returned. */
  nodes: NormalizedNode[];
  /** Derived status. */
  status: ToolCallStatus;
  /** `seq` value when the ordering basis is "seq". */
  seq?: number;
  /** Array index (position fallback). */
  position: number;
  /** Whether this call's node list was truncated by the per-call cap. */
  nodesTruncated: boolean;
  /** Count of nodes dropped beyond the per-call cap. */
  nodesDroppedCount: number;
  /** Count of input fields withheld by redaction. Set by project.ts. */
  withheldInputFieldCount: number;
  /** True when the tool name is not in TOOL_CLASS. */
  isUnknownTool: boolean;
}

/** A group of tool calls attributed to one agent. */
export interface ToolActivityGroup {
  /** Normalized agent name key (lowercase). */
  agentKey: string;
  /** Display agent name. */
  agentName: string;
  /** Whether this is the synthetic "Unattributed" group. */
  isUnattributed: boolean;
  calls: NormalizedToolCall[];
}

/** Run-wide node identity row (de-duplicated across all agents). */
export interface NodeIdentityRow {
  /** Canonical dedup key. */
  canonicalKey: string;
  /** Display identity (URN form wins when both spellings seen). */
  identity: string;
  identityKind: IdentityKind;
  name: string | null;
  nodeType: string | null;
  /** Run-wide aggregated retrieval status (retrieved wins). */
  runStatus: RetrievalStatus;
  /** The retrieval basis that produced the run-wide retrieved verdict. */
  runBasis: RetrievalBasis | null;
  /** Per-agent status and counts. */
  agents: Array<{
    agentKey: string;
    agentName: string;
    count: number;
    status: RetrievalStatus;
    basis: RetrievalBasis;
  }>;
  /** Whether some retrieval evidence for this identity was truncated off-screen. */
  hasOffScreenEvidence: boolean;
}

/** Top-level output of readToolActivity(). */
export interface ToolActivityResult {
  groups: ToolActivityGroup[];
  orderingBasis: OrderingBasis;
  unattributedRecordCount: number;
  unknownToolNames: string[];
  unidentifiedNodeCount: number;
  ambiguousIdentityCount: number;
  /** Total withheld input field count across all calls. Set by project.ts. */
  withheldInputFieldCount: number;
  /** True when ≥1 identity exists but zero classify as retrieved. */
  allSurfacedHint: boolean;
  /** Per-axis truncation counts. */
  truncated: {
    groups: number;
    callsPerAgent: number[];
    nodesPerCall: number;
  };
}

// ── Caps (exported for project.ts) ───────────────────────────────────────────

export const TOOL_ACTIVITY_CALLS_PER_AGENT_CAP = 200;
export const TOOL_ACTIVITY_NODES_PER_CALL_CAP = 100;

// ── Internal helpers ─────────────────────────────────────────────────────────

function normalizeName(s: string): string {
  return s.trim().toLowerCase();
}

function toolClassOf(normalizedName: string): "surfacing" | "retrieval" | "none" | undefined {
  return TOOL_CLASS[normalizedName];
}

function readByKeys(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function resolveNodeArray(raw: Record<string, unknown>): unknown[] {
  for (const k of NODES_KEYS) {
    const v = raw[k];
    if (Array.isArray(v)) return v;
    if (v !== undefined && v !== null) return [v]; // scalar → lift
  }
  for (const rk of RESULT_NODES_KEYS) {
    const result = raw[rk];
    if (isRecord(result)) {
      for (const k of NODES_KEYS) {
        const v = result[k];
        if (Array.isArray(v)) return v;
        if (v !== undefined && v !== null) return [v];
      }
    }
  }
  return [];
}

function resolveInput(raw: Record<string, unknown>): Record<string, unknown> {
  const v = readByKeys(raw, INPUT_KEYS);
  if (v === undefined || v === null) return {};
  if (typeof v === "string") return { value: v };
  if (isRecord(v)) return v;
  return { value: String(v) };
}

function resolveIdentity(raw: Record<string, unknown>): {
  identity?: string;
  identityKind?: IdentityKind;
  canonicalKey?: string;
} {
  for (const k of IDENTITY_KEYS) {
    const v = raw[k];
    if (typeof v === "string" && v.trim().length > 0) {
      const identity = v.trim();
      const identityKind = identityKindOf(k);
      const parsed = parseUrn(identity);
      const canonicalKey = parsed
        ? `${parsed.realm}/${parsed.type}/${parsed.id}`
        : identity;
      return { identity, identityKind, canonicalKey };
    }
  }
  return {};
}

function hasContentField(raw: Record<string, unknown>): boolean {
  for (const k of CONTENT_KEYS) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== "") return true;
    // camelCase variant
    const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel !== k) {
      const vc = raw[camel];
      if (vc !== undefined && vc !== null && vc !== "") return true;
    }
  }
  return false;
}

/**
 * Decide the ordering basis ONCE per run.
 * "seq" only if present and numeric on EVERY record. Otherwise "position".
 */
function decideOrderingBasis(allRawRecords: unknown[]): OrderingBasis {
  if (allRawRecords.length === 0) return "position";
  for (const rec of allRawRecords) {
    if (!isRecord(rec)) return "position";
    const seqVal = readByKeys(rec, SEQ_KEYS);
    if (typeof seqVal !== "number" || !Number.isFinite(seqVal)) return "position";
  }
  return "seq";
}

function readSeq(raw: Record<string, unknown>): number {
  return (readByKeys(raw, SEQ_KEYS) as number) ?? 0;
}

function normalizeNode(raw: unknown): NormalizedNode {
  if (!isRecord(raw)) return { name: null, nodeType: null, hasContent: false };
  const { identity, identityKind, canonicalKey } = resolveIdentity(raw);
  const name =
    asString(raw.name) ?? asString(raw.label) ?? asString(raw.title) ?? null;
  const nodeType =
    asString(raw.node_type) ??
    asString(raw.nodeType) ??
    asString(raw.type) ??
    null;
  const hasContent = hasContentField(raw);
  return { identity, identityKind, canonicalKey, name, nodeType, hasContent };
}

// ── Input-identity index ──────────────────────────────────────────────────────

interface InputIndex {
  byIdentity: Map<string, Set<number>>;
  byCanonical: Map<string, Set<number>>;
}

function buildInputIndex(
  allRecords: Array<{ position: number; rawInput: Record<string, unknown> }>,
): InputIndex {
  const byIdentity = new Map<string, Set<number>>();
  const byCanonical = new Map<string, Set<number>>();

  const add = (map: Map<string, Set<number>>, key: string, pos: number) => {
    let s = map.get(key);
    if (!s) { s = new Set(); map.set(key, s); }
    s.add(pos);
  };

  const collectScalars = (value: unknown, pos: number, depth = 0): void => {
    if (depth > 8) return;
    if (typeof value === "string" && value.trim()) {
      const scalar = value.trim();
      add(byIdentity, scalar, pos);
      const parsed = parseUrn(scalar);
      if (parsed) {
        add(byCanonical, `${parsed.realm}/${parsed.type}/${parsed.id}`, pos);
        add(byCanonical, parsed.id, pos);
      }
      if (scalar.includes(":")) {
        for (const seg of scalar.split(":")) {
          if (seg.trim()) add(byIdentity, seg.trim(), pos);
        }
      }
    } else if (isRecord(value)) {
      for (const v of Object.values(value)) collectScalars(v, pos, depth + 1);
    } else if (Array.isArray(value)) {
      for (const v of value) collectScalars(v, pos, depth + 1);
    }
  };

  for (const { position, rawInput } of allRecords) {
    collectScalars(rawInput, position);
  }
  return { byIdentity, byCanonical };
}

function isAddressedByInput(
  identity: string,
  canonicalKey: string | undefined,
  callPosition: number,
  index: InputIndex,
): boolean {
  // The input tier is per-call: does THIS call's own input address this identity?
  // The index maps key → Set<callPosition>; we check containment of callPosition
  // rather than a global presence check, so a node returned by call B is not
  // wrongly classified "input" just because call A's input mentioned the same id.

  // (a) Exact equality: this call's input contains the identity string literally.
  const byIdPositions = index.byIdentity.get(identity);
  if (byIdPositions?.has(callPosition)) return true;

  // (b) Canonical-key match: this call's input contains a URN whose realm/type/id
  //     matches the identity's canonical form.
  if (canonicalKey) {
    const byCanonPositions = index.byCanonical.get(canonicalKey);
    if (byCanonPositions?.has(callPosition)) return true;
  }

  // (c) URN id-segment match: this call's input contains a URN whose id segment
  //     equals the identity's id segment.  Only applicable when the identity is
  //     itself a URN — do NOT apply to bare ref_ids, because a bare "node-Y"
  //     must not match a URN input whose id happens to be "node-Y".
  const parsed = parseUrn(identity);
  if (parsed) {
    const byIdSegPositions = index.byCanonical.get(parsed.id);
    if (byIdSegPositions?.has(callPosition)) return true;
  }

  return false;
}

// ── Count withheld input fields ───────────────────────────────────────────────

/**
 * Count keys whose lowercased name is in REDACTED_KEYS at ANY depth in the
 * raw pre-redaction input. Recursive, never re-surfaces key names or values.
 */
export function countWithheldInputFields(input: unknown, depth = 0): number {
  if (depth > 64) return 0;
  if (isRecord(input)) {
    let count = 0;
    for (const [k, v] of Object.entries(input)) {
      if (REDACTED_KEYS.has(k.toLowerCase())) {
        count += 1;
      } else {
        count += countWithheldInputFields(v, depth + 1);
      }
    }
    return count;
  }
  if (Array.isArray(input)) {
    let count = 0;
    for (const v of input) count += countWithheldInputFields(v, depth + 1);
    return count;
  }
  return 0;
}

// ── Read raw records ──────────────────────────────────────────────────────────

/**
 * Read the raw tool-activity record array from the concepts subtree.
 * Uses the shared TOOL_ACTIVITY_CONTAINER_KEYS list.
 */
export function readRawToolActivityRecords(concepts: unknown): unknown[] {
  if (!isRecord(concepts)) return [];
  for (const k of TOOL_ACTIVITY_CONTAINER_KEYS) {
    const v = concepts[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

// ── Core normalization ────────────────────────────────────────────────────────

interface NormalizeResult {
  groups: Map<string, { agentName: string; isUnattributed: boolean; calls: NormalizedToolCall[] }>;
  orderingBasis: OrderingBasis;
  unattributedCount: number;
  unknownToolNames: Set<string>;
  unidentifiedNodeCount: number;
  ambiguousIdentityCount: number;
  /** Per-call pre-redaction inputs for input-index building by project.ts */
  preRedactionInputs: Array<{ position: number; rawInput: Record<string, unknown> }>;
}

function normalizeRecords(
  rawRecords: unknown[],
  rosterNames: Map<string, string>,
  nodesPerCallCap: number,
): NormalizeResult {
  const orderingBasis = decideOrderingBasis(rawRecords);

  // ── Pass 1: Parse raw records into an intermediate list ───────────────────
  type RawCall = {
    position: number;
    normalizedName: string;
    rawName: string;
    rawInput: Record<string, unknown>;
    nodes: NormalizedNode[];
    isError: boolean;
    seq?: number;
    nodesTruncated: boolean;
    nodesDroppedCount: number;
    rawAgentName: string;
    agentKey: string;
  };

  const rawCalls: RawCall[] = [];
  const toolNameNodeCounts = new Map<string, number>(); // for status derivation
  const unknownToolNames = new Set<string>();
  const preRedactionInputs: Array<{ position: number; rawInput: Record<string, unknown> }> = [];

  for (let i = 0; i < rawRecords.length; i++) {
    const raw = rawRecords[i];
    let isError = false;
    let normalizedName = "";
    let rawName = "";
    let rawInput: Record<string, unknown> = {};
    let rawNodes: unknown[] = [];

    if (!isRecord(raw)) {
      isError = true;
    } else {
      // Producer-reported error
      const errField = raw.error ?? raw.is_error ?? raw.failed;
      const statusField = asString(raw.status);
      if (
        errField === true ||
        (typeof errField === "string" && /^(error|fail|failed)$/i.test(errField)) ||
        (statusField && /^(error|fail|failed)$/i.test(statusField))
      ) {
        isError = true;
      }

      rawName =
        asString(raw.tool_name) ??
        asString(raw.toolName) ??
        asString(raw.tool) ??
        asString(raw.name) ??
        "";
      normalizedName = normalizeName(rawName);
      rawInput = resolveInput(raw);

      if (!isError) {
        rawNodes = resolveNodeArray(raw);
      }
    }

    preRedactionInputs.push({ position: i, rawInput });

    const parsedNodes = rawNodes.map(normalizeNode);

    // Track total node counts per tool name BEFORE any cap
    if (normalizedName && parsedNodes.length > 0) {
      toolNameNodeCounts.set(
        normalizedName,
        (toolNameNodeCounts.get(normalizedName) ?? 0) + parsedNodes.length,
      );
    }

    if (normalizedName && !(normalizedName in TOOL_CLASS)) {
      unknownToolNames.add(normalizedName);
    }

    const nodesTruncated = parsedNodes.length > nodesPerCallCap;
    const nodesDroppedCount = nodesTruncated ? parsedNodes.length - nodesPerCallCap : 0;
    const cappedNodes = nodesTruncated ? parsedNodes.slice(0, nodesPerCallCap) : parsedNodes;

    const rawAgentName = isRecord(raw)
      ? asString(raw.agent_name) ??
        asString(raw.agentName) ??
        asString(raw.agent) ??
        ""
      : "";
    const agentKey = normalizeName(rawAgentName);

    rawCalls.push({
      position: i,
      normalizedName,
      rawName,
      rawInput,
      nodes: cappedNodes,
      isError,
      seq: orderingBasis === "seq" && isRecord(raw) ? readSeq(raw) : undefined,
      nodesTruncated,
      nodesDroppedCount,
      rawAgentName,
      agentKey,
    });
  }

  // ── Pass 2: Build input index (pre-redaction) ─────────────────────────────
  const inputIndex = buildInputIndex(preRedactionInputs);

  // ── Pass 3: Classify nodes (retrieval basis) — BEFORE truncation ──────────
  for (const call of rawCalls) {
    const cls = toolClassOf(call.normalizedName);
    for (const node of call.nodes) {
      if (!node.identity) continue;

      // Tier 1: content
      if (node.hasContent) {
        node.retrievalBasis = "content";
        continue;
      }
      // Tier 2: input match
      if (isAddressedByInput(node.identity, node.canonicalKey, call.position, inputIndex)) {
        node.retrievalBasis = "input";
        continue;
      }
      // Tier 3: tool class (only "retrieval" class marks nodes as retrieved)
      if (cls === "retrieval") {
        node.retrievalBasis = "tool-class";
        continue;
      }
      // Default: surfaced (unknown tool returns nodes → surfacing default)
      node.retrievalBasis = "tool-class"; // basis recorded; status derived below
    }
  }

  // ── Pass 4: Count unidentified nodes ──────────────────────────────────────
  let unidentifiedNodeCount = 0;
  for (const call of rawCalls) {
    for (const node of call.nodes) {
      if (!node.identity) unidentifiedNodeCount++;
    }
  }

  // ── Pass 5: Group by agent and derive status ───────────────────────────────
  const groups = new Map<
    string,
    { agentName: string; isUnattributed: boolean; calls: NormalizedToolCall[] }
  >();
  let unattributedCount = 0;

  for (const call of rawCalls) {
    const isKnownAgent = call.agentKey && rosterNames.has(call.agentKey);
    let groupKey: string;
    let agentName: string;
    let isUnattributed = false;

    if (isKnownAgent) {
      groupKey = call.agentKey;
      agentName = rosterNames.get(call.agentKey)!;
    } else {
      groupKey = "__unattributed__";
      agentName = "Unattributed";
      isUnattributed = true;
      unattributedCount++;
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, { agentName, isUnattributed, calls: [] });
    }

    // Status derivation: behaviour-based, not class-based.
    let status: ToolCallStatus;
    if (call.isError) {
      status = "error";
    } else if (call.nodes.length === 0 && !call.nodesTruncated) {
      const cls = toolClassOf(call.normalizedName);
      const observedReturn = (toolNameNodeCounts.get(call.normalizedName) ?? 0) > 0;
      const isKnownNodeTool = cls === "retrieval" || cls === "surfacing";
      // Badge empty ONLY when tool is known to return nodes elsewhere in the run
      // OR is mapped retrieval/surfacing in TOOL_CLASS.
      status = observedReturn || isKnownNodeTool ? "empty" : "ok";
    } else {
      status = "ok";
    }

    const isUnknownTool = call.normalizedName !== "" && !(call.normalizedName in TOOL_CLASS);

    groups.get(groupKey)!.calls.push({
      toolName: call.normalizedName,
      rawToolName: call.rawName,
      input: call.rawInput,
      nodes: call.nodes,
      status,
      seq: call.seq,
      position: call.position,
      nodesTruncated: call.nodesTruncated,
      nodesDroppedCount: call.nodesDroppedCount,
      withheldInputFieldCount: 0, // set by project.ts from pre-redaction input
      isUnknownTool,
    });
  }

  // ── Pass 6: Sort calls within each group ──────────────────────────────────
  for (const group of groups.values()) {
    if (orderingBasis === "seq") {
      group.calls.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    } else {
      group.calls.sort((a, b) => a.position - b.position);
    }
  }

  // ── Pass 7: Count ambiguous identities ────────────────────────────────────
  // Two different realms claiming the same bare id = ambiguous.
  const bareIdToRealms = new Map<string, Set<string>>();
  for (const call of rawCalls) {
    for (const node of call.nodes) {
      if (!node.identity) continue;
      const parsed = parseUrn(node.identity);
      if (parsed) {
        let s = bareIdToRealms.get(parsed.id);
        if (!s) { s = new Set(); bareIdToRealms.set(parsed.id, s); }
        s.add(parsed.realm);
      }
    }
  }
  let ambiguousIdentityCount = 0;
  for (const realms of bareIdToRealms.values()) {
    if (realms.size > 1) ambiguousIdentityCount++;
  }

  return {
    groups,
    orderingBasis,
    unattributedCount,
    unknownToolNames,
    unidentifiedNodeCount,
    ambiguousIdentityCount,
    preRedactionInputs,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read and normalize the tool_activity section.
 *
 * @param rawConcepts      The raw `concepts` object from the bundle.
 * @param rosterNames      Map from normalized agent name (lowercase) → display name.
 * @param callsPerAgentCap Max calls to keep per agent group (after analysis).
 * @param nodesPerCallCap  Max nodes to keep per call (after analysis).
 */
export function readToolActivity(
  rawConcepts: unknown,
  rosterNames: Map<string, string>,
  callsPerAgentCap: number = TOOL_ACTIVITY_CALLS_PER_AGENT_CAP,
  nodesPerCallCap: number = TOOL_ACTIVITY_NODES_PER_CALL_CAP,
): ToolActivityResult {
  const rawRecords = readRawToolActivityRecords(rawConcepts);

  if (rawRecords.length === 0) {
    return {
      groups: [],
      orderingBasis: "position",
      unattributedRecordCount: 0,
      unknownToolNames: [],
      unidentifiedNodeCount: 0,
      ambiguousIdentityCount: 0,
      withheldInputFieldCount: 0,
      allSurfacedHint: false,
      truncated: { groups: 0, callsPerAgent: [], nodesPerCall: 0 },
    };
  }

  const {
    groups,
    orderingBasis,
    unattributedCount,
    unknownToolNames,
    unidentifiedNodeCount,
    ambiguousIdentityCount,
  } = normalizeRecords(rawRecords, rosterNames, nodesPerCallCap);

  // Convert groups map to array: attributed first (sorted by key), unattributed last.
  let groupsArr = [...groups.entries()].map(([key, g]) => ({
    agentKey: key,
    agentName: g.agentName,
    isUnattributed: g.isUnattributed,
    calls: g.calls,
  }));
  groupsArr.sort((a, b) => {
    if (a.isUnattributed && !b.isUnattributed) return 1;
    if (!a.isUnattributed && b.isUnattributed) return -1;
    return a.agentKey.localeCompare(b.agentKey);
  });

  // Apply caps AFTER classification/aggregation.
  const callsPerAgentTruncated: number[] = [];
  let nodesPerCallTruncated = 0;

  for (const g of groupsArr) {
    const callDrop = Math.max(0, g.calls.length - callsPerAgentCap);
    callsPerAgentTruncated.push(callDrop);
    if (callDrop > 0) g.calls = g.calls.slice(0, callsPerAgentCap);
    for (const call of g.calls) {
      if (call.nodesTruncated) nodesPerCallTruncated += call.nodesDroppedCount;
    }
  }

  // Groups cap is applied by project.ts (it has PROJECTION_ARRAY_CAP).
  const groupsTruncated = 0;

  // All-surfaced hint: ≥1 identity exists but zero classify as retrieved.
  let totalIdentities = 0;
  let retrievedCount = 0;
  for (const g of groupsArr) {
    for (const call of g.calls) {
      const cls = toolClassOf(call.toolName);
      for (const node of call.nodes) {
        if (!node.identity) continue;
        totalIdentities++;
        const isRetrieved =
          node.hasContent ||
          node.retrievalBasis === "input" ||
          (cls === "retrieval" && node.retrievalBasis === "tool-class");
        if (isRetrieved) retrievedCount++;
      }
    }
  }
  const allSurfacedHint = totalIdentities > 0 && retrievedCount === 0;

  return {
    groups: groupsArr,
    orderingBasis,
    unattributedRecordCount: unattributedCount,
    unknownToolNames: [...unknownToolNames],
    unidentifiedNodeCount,
    ambiguousIdentityCount,
    withheldInputFieldCount: 0, // set by project.ts
    allSurfacedHint,
    truncated: {
      groups: groupsTruncated,
      callsPerAgent: callsPerAgentTruncated,
      nodesPerCall: nodesPerCallTruncated,
    },
  };
}

/**
 * Build the run-wide de-duplicated node identity list from already-classified groups.
 *
 * De-duplicates by canonicalKey. Merges bare ref_id into an existing URN row
 * when the URN's id segment matches (URN form wins for display). Retrieved wins
 * across agents.
 *
 * Nodes from `none`-class tool calls contribute no identities.
 */
export function buildNodeIdentities(groups: ToolActivityGroup[]): NodeIdentityRow[] {
  const rowMap = new Map<string, NodeIdentityRow>();
  // Maps bare id → canonical key of the URN row that claimed it.
  const bareIdToUrnCanonical = new Map<string, string>();

  for (const group of groups) {
    for (const call of group.calls) {
      const cls = toolClassOf(call.toolName);
      if (cls === "none") continue;

      for (const node of call.nodes) {
        if (!node.identity || !node.canonicalKey) continue;

        const isRetrieved =
          node.hasContent ||
          node.retrievalBasis === "input" ||
          (cls === "retrieval" && node.retrievalBasis === "tool-class");
        const nodeStatus: RetrievalStatus = isRetrieved ? "retrieved" : "surfaced";
        const basis: RetrievalBasis = node.retrievalBasis ?? "tool-class";

        let effectiveKey = node.canonicalKey;

        // Register URN rows and enable merge of bare ref_id rows.
        if (node.identity.startsWith("urn:")) {
          const parsed = parseUrn(node.identity);
          if (parsed) {
            // Register canonical key for this bare id (first URN wins).
            if (!bareIdToUrnCanonical.has(parsed.id)) {
              bareIdToUrnCanonical.set(parsed.id, node.canonicalKey);
            }
            // Absorb any existing bare-id row into this URN row.
            const existingBare = rowMap.get(parsed.id);
            if (existingBare && !rowMap.has(node.canonicalKey)) {
              rowMap.set(node.canonicalKey, {
                ...existingBare,
                canonicalKey: node.canonicalKey,
                identity: node.identity,
                identityKind: node.identityKind!,
              });
              rowMap.delete(parsed.id);
            }
          }
        } else if (node.identityKind === "ref_id") {
          // Bare ref_id: check if a URN row already claimed this id.
          const urnCanonical = bareIdToUrnCanonical.get(node.identity);
          if (urnCanonical) effectiveKey = urnCanonical;
        }

        const existing = rowMap.get(effectiveKey);
        if (existing) {
          if (nodeStatus === "retrieved" && existing.runStatus !== "retrieved") {
            existing.runStatus = "retrieved";
            existing.runBasis = basis;
          }
          if (node.identity.startsWith("urn:") && !existing.identity.startsWith("urn:")) {
            existing.identity = node.identity;
            existing.identityKind = node.identityKind!;
          }
          const agentEntry = existing.agents.find((a) => a.agentKey === group.agentKey);
          if (agentEntry) {
            agentEntry.count++;
            if (nodeStatus === "retrieved" && agentEntry.status !== "retrieved") {
              agentEntry.status = "retrieved";
              agentEntry.basis = basis;
            }
          } else {
            existing.agents.push({
              agentKey: group.agentKey,
              agentName: group.agentName,
              count: 1,
              status: nodeStatus,
              basis,
            });
          }
          if (node.evidenceTruncated) existing.hasOffScreenEvidence = true;
        } else {
          rowMap.set(effectiveKey, {
            canonicalKey: effectiveKey,
            identity: node.identity,
            identityKind: node.identityKind!,
            name: node.name,
            nodeType: node.nodeType,
            runStatus: nodeStatus,
            runBasis: nodeStatus === "retrieved" ? basis : null,
            agents: [
              {
                agentKey: group.agentKey,
                agentName: group.agentName,
                count: 1,
                status: nodeStatus,
                basis,
              },
            ],
            hasOffScreenEvidence: node.evidenceTruncated ?? false,
          });
        }
      }
    }
  }

  return [...rowMap.values()];
}
