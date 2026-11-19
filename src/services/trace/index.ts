/**
 * Highlight-to-trace: resolving a selected span of text back to the step
 * or tool call that produced it, and forward to the later steps that used
 * it. `matchUpstream` / `walkDownstream` are pure; this orchestrates them,
 * falling back to `inferUpstream` when nothing matched exactly, and logs
 * under `[trace]` (`log.ts`).
 */

import crypto from "node:crypto";
import type { ArtifactContents, TraceOrigin } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { inferUpstream } from "./inferUpstream";
import { traceLog } from "./log";
import { matchUpstream } from "./matchUpstream";
import type { TraceSourceStep } from "./types";
import { walkDownstream } from "./walkDownstream";

export * from "./types";
export { loadJamieSources, buildStrutSteps, type FollowStrutRun, type JamieMessageLike } from "./loadSources";

export interface ResolveTraceParams {
  selection: string;
  origin: TraceOrigin;
  steps: TraceSourceStep[];
  /** The order of the step the selection itself was read from, when known — bounds both searches. */
  originOrder?: number;
}

/**
 * A stable id for the inline ref an artifact is stored under —
 * `trace:<messageId>:<selectionHash>` — so highlighting the same span
 * twice reopens the same artifact rather than minting a new version.
 */
export function traceArtifactId(messageId: string, selection: string): string {
  const hash = crypto.createHash("sha256").update(selection).digest("hex").slice(0, 16);
  return `trace:${messageId}:${hash}`;
}

export async function resolveTrace(params: ResolveTraceParams): Promise<ArtifactContents["trace"]> {
  const { selection, origin, steps, originOrder } = params;
  traceLog.info("resolving", { sourceKind: origin.kind, selectionLength: selection.length, steps: steps.length });

  if (steps.length === 0) {
    traceLog.info("no sources", { reason: origin.kind === "strut" ? "no events" : "no conversation rows" });
  }

  const bound = originOrder ?? Infinity;
  let upstream = matchUpstream(selection, steps, bound);
  let usedInference = false;
  if (upstream.length === 0 && steps.length > 0) {
    upstream = await inferUpstream(selection, steps, bound);
    usedInference = true;
  }

  const exact = upstream.filter((link) => link.match === "exact").length;
  traceLog.info("links resolved", { exact, inferred: upstream.length - exact, usedInference });

  const downstream = originOrder !== undefined ? walkDownstream(selection, steps, originOrder) : [];

  return { selection, origin, upstream, downstream };
}
