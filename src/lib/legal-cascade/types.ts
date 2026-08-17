/**
 * Session-cascade types for legal benchmark run traces.
 *
 * Wire types mirror the stakgraph `:3355` sessions API (snake_case, Turn-chain
 * work on stakgraph PR #1568) — the proxy routes return these shapes verbatim
 * through an explicit field allowlist. Row/model types are the derived,
 * render-ready story built by `derive.ts`.
 */

// ── Wire types (stakgraph /api/sessions) ─────────────────────────────────────

export type CascadeSessionStatus = "running" | "success" | "error" | "aborted";

export type CascadeTurnType =
  | "user_input"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "response";

export interface CascadeTokenUsage {
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
  total: number;
}

export interface CascadeSession {
  id: string;
  /** Empty string on top-level sessions. */
  parent_session_id: string;
  /** Set on top-level sessions (embeds the run identifier); "" on children. */
  agent_name: string;
  source: string;
  status: CascadeSessionStatus;
  /** Version counter — unchanged means nothing new to fetch. */
  turn_count: number;
  last_turn_at: number | null;
  timestamp: string;
  model: string | null;
  repo: string | null;
  token_usage: CascadeTokenUsage | null;
  child_count: number;
}

export interface CascadeConcept {
  ref_id: string;
  id: string | null;
  name: string;
}

export interface CascadeTurn {
  order: number;
  turn_id: string;
  turn_type: CascadeTurnType;
  tool: string | null;
  tool_call_id: string | null;
  /** Full text/input JSON; tool_result is truncated upstream to a preview. */
  content: string;
  /** Null on backfilled (pre-feature) sessions — render the gutter blank. */
  timestamp: number | null;
  /** Non-empty ⇒ this turn READ these Concepts. */
  concepts: CascadeConcept[];
}

export interface CascadeTurnsPage {
  session_id: string;
  status: CascadeSessionStatus;
  turn_count: number;
  last_turn_at: number | null;
  turns: CascadeTurn[];
}

export interface CascadeSessionDetail extends CascadeSession {
  /** Flat, any depth — each carries parent_session_id to rebuild the tree. */
  descendants?: CascadeSession[];
}

// ── Derived rows (the mockup's "story rows") ─────────────────────────────────

interface CascadeRowBase {
  /** Lane index: 0 = top-level agent, +1 per sub-agent nesting. */
  depth: number;
  /** Session the row belongs to (for agent rows: the child session). */
  sessionId: string;
  /** Epoch ms of the row's first turn; null on backfilled sessions. */
  timestamp: number | null;
}

export interface UserRow extends CascadeRowBase {
  kind: "user";
  order: number;
  text: string;
}

export interface ResponseRow extends CascadeRowBase {
  kind: "response";
  order: number;
  text: string;
  /** True on a child session's final response — the lane curves back here. */
  merge: boolean;
}

export type ConceptVerb = "READ" | "CREATED" | "EDITED";

export interface ConceptRow extends CascadeRowBase {
  kind: "concept";
  order: number;
  verb: ConceptVerb;
  name: string;
  /** Graph ref_id for READ rows; null for display-parsed CREATED/EDITED rows. */
  refId: string | null;
  /** Tool the action happened through. */
  via: string | null;
}

export interface PillRow extends CascadeRowBase {
  kind: "pill";
  /** Turn-order span [o0, o1] — the pill is honest about the chain slice. */
  o0: number;
  o1: number;
  calls: number;
  /** Reasoning texts inside the span. */
  texts: string[];
  /** Per-tool tally, e.g. "graph_search ×14 · graph_get ×5". */
  mix: string;
  durationMs: number | null;
  /** The folded turns, kept in memory so expanding needs no extra fetch. */
  turns: CascadeTurn[];
  /** Trailing pill of a running session — its count ticks up in place. */
  open: boolean;
}

export interface AgentRow extends CascadeRowBase {
  kind: "agent";
  /** "" when the fork's child session is not yet visible. */
  childSessionId: string;
  label: string;
  /** The prompt the agent was handed (its chain's turn-0 user_input). */
  prompt: string | null;
  status: CascadeSessionStatus;
  /** False when the child crashed before its chain existed — "no trace". */
  hasTrace: boolean;
}

export type CascadeRowModel = UserRow | ResponseRow | ConceptRow | PillRow | AgentRow;

// ── Run-level model ──────────────────────────────────────────────────────────

export interface AgentCascade {
  session: CascadeSession;
  /** Flat rows, children spliced in at their fork points (depth = lane). */
  rows: CascadeRowModel[];
  /** This session or any descendant is still running. */
  live: boolean;
  /**
   * Parallel-launch grouping: agents start in batches, not sequentially
   * (sibling sessions within ~220ms is normal). Agents sharing a batchIndex
   * render as siblings, not a chain.
   */
  batchIndex: number;
}

export interface CascadeSummary {
  agents: number;
  subAgents: number;
  /** Distinct concepts touched across the run. */
  concepts: number;
  totalTokens: number;
  toolCalls: number;
  running: boolean;
}

export interface RunCascadeModel {
  agents: AgentCascade[];
  summary: CascadeSummary;
}
