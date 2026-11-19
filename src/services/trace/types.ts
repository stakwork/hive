/**
 * Shared shapes for the highlight-to-trace service (`services/trace`).
 * Pure data — no DB, no network — so `matchUpstream` and `walkDownstream`
 * can be tested as plain functions against fixtures.
 */

import type { TraceLink, TraceOrigin } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

/**
 * One candidate step in the chain: a Jamie tool-call row or a strut
 * event's `step.end`. `order` is the step's place in the timeline — ascending,
 * never reused — so upstream search looks only at steps before the
 * selection's own step and downstream search only at steps after it.
 */
export interface TraceSourceStep {
  /** Stable within one `resolveTrace` call: a tool-call id, or a strut event path. */
  key: string;
  toolName: string;
  /** What fed INTO this step, as text — used by `walkDownstream`. */
  input: string;
  /** What this step produced, as text — used by `matchUpstream`. */
  output: string;
  toolCallId?: string;
  path?: string;
  nodes?: { ref_id: string; node_type?: string }[];
  order: number;
}

export interface TraceSources {
  steps: TraceSourceStep[];
  /** The step the selection itself was read from, when known — bounds the downstream walk. */
  originOrder?: number;
}

export type { TraceLink, TraceOrigin };
