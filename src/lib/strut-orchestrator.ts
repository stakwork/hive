/**
 * Jamie on strut's `orchestrator` workflow — what hive and the workflow
 * agree on (strut `src/workflows/orchestrator.yaml`, `specs/API.md` §12,
 * `specs/CALLBACKS.md` §6; the launch in `services/strut-orchestrator.ts`,
 * the completion handler in `services/strut-runs/orchestrator-turn.ts`, the
 * card in `_components/StrutProposalCard.tsx`). Pure: no server or client
 * imports, so both sides can use it.
 *
 * A browser with the "Strut orchestrator" switch on (the chat's ⋯ menu,
 * `_state/strutEnginePreference.ts`, sent as `strutEngine: true`) sends
 * each canvas-chat message as ONE run of the workflow, with the
 * conversation's row id as the `session`: strut's agent remembers the
 * conversation itself, so nothing is replayed to it. Its reply comes back
 * through the strut-runs webhook in the job turn's shape — `{ text,
 * artifacts, ask?, cost, session }` — plus `proposals[]`: the gated graph
 * writes it asked for, recorded on strut rather than run, which a person
 * accepts or rejects from the card (`POST /proposals/:id/decide`).
 */

import { z } from "zod";
import type { GraphEdgeEndpoint, ProposalOutput } from "@/lib/proposals/types";

/** `StrutRun.kind` of an orchestrator turn — the completion handler's discriminator. */
export const ORCHESTRATOR_TURN_KIND = "orchestrator_turn";
/** Strut's own workflow, seeded at boot (the lab appends the graph tools). */
export const ORCHESTRATOR_WORKFLOW = "orchestrator";

/** The workflow `input` a turn is launched with. */
export const orchestratorTurnInputSchema = z
  .object({
    prompt: z.string(),
    session: z.string().optional(),
    context: z.object({ line: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

/**
 * The message as the lab's orchestrator reads it: its first line names the
 * Hive workspace this strut belongs to, `@<slug>` — the line a job launch
 * composes too (stakgraph `mcp/src/lab/orchestrator/seed.ts`).
 */
export function orchestratorPrompt(workspaceSlug: string, message: string): string {
  return `@${workspaceSlug}\n${message}`;
}

/**
 * `context.line`: what the host knows about the turn, put before the prompt
 * — the time and the person's time zone (`"Sun 19 Oct 14:02, Europe/London. "`).
 * An unknown zone falls back to UTC.
 */
export function orchestratorContextLine(now: Date, timeZone: string | undefined): string {
  const zone = timeZone?.trim() || "UTC";
  const format = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: tz,
    }).format(now);
  try {
    return `${format(zone)}, ${zone}. `;
  } catch {
    return `${format("UTC")}, UTC. `;
  }
}

// ─── Rows ────────────────────────────────────────────────────────────────

/** The reply row of a turn — also its idempotency key. */
export const orchestratorRowId = (runId: string): string => `orchestrator-${runId}`;
/** The launch marker a turn hangs its working card on until the reply row lands. */
export const orchestratorLaunchRowId = (runId: string): string => `orchestrator-launch-${runId}`;
/** One row per proposal the turn made. */
export const strutProposalRowId = (runId: string, proposalId: string): string =>
  `orchestrator-${runId}-proposal-${proposalId}`;

/** How the turn ended, as the row's `source.status` says it. */
export type OrchestratorTurnOutcome = "success" | "error" | "cancelled" | "lost";

/** The reply of one turn (`services/strut-runs/orchestrator-turn.ts`). */
export type OrchestratorRowSource = {
  kind: "orchestrator";
  /** The turn's `StrutRun` id. */
  runId: string;
  strutRunId: string;
  status: OrchestratorTurnOutcome;
  /** The agent stopped for a decision: the question, verbatim. */
  ask?: string;
};

/** Written as the turn launches; the working card hangs on it until `orchestrator-<runId>` lands. */
export type OrchestratorLaunchRowSource = {
  kind: "orchestrator_launch";
  runId: string;
};

export const STRUT_PROPOSAL_STATUSES = ["pending", "accepted", "rejected", "applied", "failed"] as const;
export type StrutProposalStatus = (typeof STRUT_PROPOSAL_STATUSES)[number];

/**
 * One proposal a turn made (strut CALLBACKS.md §6): the brief as the run
 * reported it. The card reads the record live (`GET …/strut/proposals/:id`);
 * `status` here is the status at delivery, kept for the readout.
 */
export type StrutProposalRowSource = {
  kind: "proposal";
  /** The turn's `StrutRun` id — what the card's reads are scoped by. */
  runId: string;
  proposalId: string;
  /** Strut-relative: `/proposals/<id>`. */
  url: string;
  /** The registry step the proposal will run — what picks the card's body. */
  step: string;
  status: StrutProposalStatus;
  title: string;
  rationale?: string;
  createdAt?: string;
};

/** A person's decision on a proposal, as the decide route recorded it. */
export type StrutProposalResultRowSource = {
  kind: "proposal_result";
  runId: string;
  proposalId: string;
  status: StrutProposalStatus;
  title: string;
};

/** The slim form strut reports a run's proposals in (`run.end { proposals }`, `GET …/runs/:runId/proposals`). */
export interface StrutProposalBrief {
  id: string;
  step: string;
  title: string;
  status: StrutProposalStatus;
  url: string;
  rationale?: string;
  createdAt?: string;
  decidedAt?: string;
}

const MAX_ID = 200;
const MAX_TITLE = 300;
const MAX_RATIONALE = 2_000;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;

export function parseStrutProposalStatus(v: unknown): StrutProposalStatus {
  return typeof v === "string" && (STRUT_PROPOSAL_STATUSES as readonly string[]).includes(v)
    ? (v as StrutProposalStatus)
    : "pending";
}

/** Strut's list as it comes: every brief that is whole, in order. */
export function parseStrutProposalBriefs(raw: unknown): StrutProposalBrief[] {
  if (!Array.isArray(raw)) return [];
  const out: StrutProposalBrief[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id, MAX_ID);
    const step = str(entry.step, MAX_ID);
    if (!id || !step) continue;
    out.push({
      id,
      step,
      title: str(entry.title, MAX_TITLE) ?? step,
      status: parseStrutProposalStatus(entry.status),
      url: str(entry.url, 1_024) ?? `/proposals/${id}`,
      ...(str(entry.rationale, MAX_RATIONALE) ? { rationale: str(entry.rationale, MAX_RATIONALE) } : {}),
      ...(str(entry.createdAt, 64) ? { createdAt: str(entry.createdAt, 64) } : {}),
      ...(str(entry.decidedAt, 64) ? { decidedAt: str(entry.decidedAt, 64) } : {}),
    });
  }
  return out;
}

/**
 * The record `GET /proposals/:id` gives (strut API.md §12), as hive's route
 * hands it to the card — `by.actor` / `by.principal` dropped, the run's
 * workspace slug added for the card's subtext.
 */
export interface StrutProposalRecord {
  id: string;
  step: string;
  input: unknown;
  rationale?: string;
  title: string;
  status: StrutProposalStatus;
  createdAt: string;
  by: { workflow: string; runId: string; path?: string; job?: string; session?: string };
  decision?: { action: "accept" | "reject"; by?: string; at: string; input?: unknown; reason?: string };
  result?: { output?: unknown; error?: string; cost?: number; at: string };
  /** The slug of the workspace whose swarm ran the proposing turn. */
  workspaceSlug?: string;
}

// ─── The card's body ─────────────────────────────────────────────────────

const edgeEndpoint = (refId: unknown, type: unknown, data: unknown): GraphEdgeEndpoint | null => {
  if (typeof refId === "string" && refId) return { ref_id: refId };
  if (typeof type === "string" && type) return { node_type: type, node_data: isRecord(data) ? data : {} };
  return null;
};

const triplet = (t: Record<string, unknown>) => {
  const source = edgeEndpoint(t.source_ref_id, t.source_type, t.source_data);
  const target = edgeEndpoint(t.target_ref_id, t.target_type, t.target_data);
  if (!source || !target || typeof t.edge_type !== "string") return null;
  return {
    edge_type: t.edge_type,
    ...(isRecord(t.edge_data) ? { edge_data: t.edge_data } : {}),
    ...(typeof t.weight === "number" ? { weight: t.weight } : {}),
    source,
    target,
  };
};

/**
 * A strut proposal's step + input as the hive proposal kind whose card body
 * draws the same fields (strut's flat `source_ref_id` / `source_type` +
 * `source_data` becomes hive's endpoint union). Null when no hive body
 * fits — the card then shows the input as key/value pairs. Render-only:
 * the decision goes to strut, never through hive's approval handler.
 */
export function strutProposalToOutput(step: string, input: unknown, workspaceSlug = ""): ProposalOutput | null {
  if (!isRecord(input)) return null;
  const proposalId = "strut";
  const scope = { workspaceId: "", workspaceSlug };
  switch (step) {
    case "graph/create-node":
      return typeof input.node_type === "string"
        ? {
            kind: "graphNodeCreate",
            proposalId,
            payload: {
              ...scope,
              node_type: input.node_type,
              node_data: isRecord(input.node_data) ? input.node_data : {},
            },
            meta: { workspaceSlug },
          }
        : null;
    case "graph/create-triplet": {
      const t = triplet(input);
      return t
        ? { kind: "graphTripletCreate", proposalId, payload: { ...scope, ...t }, meta: { workspaceSlug } }
        : null;
    }
    case "graph/create-batch-triplet": {
      if (!Array.isArray(input.triplets)) return null;
      const triplets = input.triplets
        .filter(isRecord)
        .map(triplet)
        .filter((t): t is NonNullable<typeof t> => t !== null);
      return triplets.length > 0
        ? { kind: "graphBatchTripletCreate", proposalId, payload: { ...scope, triplets }, meta: { workspaceSlug } }
        : null;
    }
    case "graph/move-node":
      return typeof input.ref_id === "string" &&
        typeof input.to_ref_id === "string" &&
        typeof input.edge_type === "string"
        ? {
            kind: "graphNodeMove",
            proposalId,
            payload: {
              ...scope,
              ref_id: input.ref_id,
              edge_type: input.edge_type,
              from_ref_id: typeof input.from_ref_id === "string" ? input.from_ref_id : "",
              to_ref_id: input.to_ref_id,
            },
            meta: { workspaceSlug },
          }
        : null;
    case "graph/delete-edge":
      return typeof input.source_ref_id === "string" &&
        typeof input.edge_type === "string" &&
        typeof input.target_ref_id === "string"
        ? {
            kind: "graphEdgeDelete",
            proposalId,
            payload: {
              ...scope,
              edge_type: input.edge_type,
              source_ref_id: input.source_ref_id,
              target_ref_id: input.target_ref_id,
            },
            meta: { workspaceSlug },
          }
        : null;
    default:
      return null;
  }
}

/** The card's label for a step: `graph/create-node` → "Proposed graph node". */
export function strutProposalStepLabel(step: string): string {
  switch (step) {
    case "graph/create-node":
      return "Proposed new graph node";
    case "graph/edit-node":
      return "Proposed graph node edit";
    case "graph/create-triplet":
      return "Proposed graph relationship";
    case "graph/create-batch-triplet":
      return "Proposed batch graph relationships";
    case "graph/move-node":
      return "Proposed node move";
    case "graph/delete-edge":
      return "Proposed link removal";
    case "graph/delete-node":
      return "Proposed node delete";
    default:
      return `Proposed ${step}`;
  }
}

/** The notice a person sees when strut is still on their previous message. */
export const ORCHESTRATOR_BUSY_NOTE =
  "Still working on your last message — its reply will land here when it ends. Send this one again after that.";
