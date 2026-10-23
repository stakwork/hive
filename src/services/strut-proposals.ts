/**
 * Strut PROPOSALS as hive reads and decides them (strut `specs/API.md`
 * §12; the rows in `strut-runs/orchestrator-turn.ts`, the card in
 * `_components/StrutProposalCard.tsx`, the routes under
 * `api/orgs/[githubLogin]/strut/proposals/[id]`).
 *
 * A proposal is strut's record of a gated tool call an orchestrator turn
 * made — the step's input, the model's rationale, the decision, the
 * result. Hive stores none of it: the card reads `GET {lab}/proposals/:id`
 * through hive's route and decides at `POST {lab}/proposals/:id/decide`,
 * which runs the step in code on accept. Every read is scoped by the
 * TURN's `StrutRun` row: the caller must belong to the org, the row's
 * conversation must be theirs or shared (the rule the launch admitted it
 * under), and the record must name that run as its proposer — so nobody
 * reads another conversation's proposals through a run id of their own.
 *
 * `x-strut-actor` on a decide is the CLICKING user's actor — the same id
 * the launches use (`resolveStrutActor`) — so strut records who decided.
 */

import { StrutRunStatus } from "@prisma/client";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ORCHESTRATOR_TURN_KIND,
  parseStrutProposalStatus,
  type StrutProposalRecord,
  type StrutProposalStatus,
} from "@/lib/strut-orchestrator";
import { STRUT_ACTOR_HEADER, resolveStrutActor } from "@/services/bifrost/strut-delegation";
import { resolveOrgConversationRowId } from "@/services/org-canvas-conversation";
import { labForRow } from "@/services/strut-runs";
import { appendOrchestratorRows } from "@/services/strut-runs/orchestrator-turn";

const LOG_TAG = "STRUT_PROPOSALS";
const READ_TIMEOUT_MS = 10_000;
/** A decide runs the step (a graph write) before it answers. */
const DECIDE_TIMEOUT_MS = 60_000;
const MAX_ID = 200;

export class StrutProposalError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StrutProposalError";
  }
}

/** The turn's row, as the proposal routes need it. */
export interface ProposalTurnRow {
  id: string;
  workspaceId: string;
  swarmId: string;
  userId: string;
  workflow: string;
  strutRunId: string | null;
  conversationId: string | null;
  workspaceSlug: string;
}

/**
 * The turn behind a proposal, for this caller: in the org, in a conversation
 * they can read. Throws `StrutProposalError` (404 for every miss, so
 * nothing about other people's runs leaks).
 */
export async function resolveProposalTurn(args: {
  githubLogin: string;
  userId: string;
  runId: string;
}): Promise<ProposalTurnRow> {
  const { githubLogin, userId, runId } = args;
  const notFound = new StrutProposalError(404, "Not found");
  if (!runId || runId.length > MAX_ID) throw notFound;
  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) throw notFound;
  const row = await db.strutRun.findFirst({
    where: { id: runId, kind: ORCHESTRATOR_TURN_KIND },
    select: {
      id: true,
      workspaceId: true,
      swarmId: true,
      userId: true,
      workflow: true,
      strutRunId: true,
      conversationId: true,
      status: true,
    },
  });
  if (!row || !row.conversationId) throw notFound;
  if (row.status === StrutRunStatus.PENDING) throw notFound;
  // The launch's workspace must be in THIS org (`StrutRun` has no relation to it).
  const workspace = await db.workspace.findFirst({
    where: { id: row.workspaceId, sourceControlOrgId: orgId, deleted: false },
    select: { slug: true },
  });
  if (!workspace) throw notFound;
  const conversationId = await resolveOrgConversationRowId({ conversationId: row.conversationId, userId, orgId });
  if (!conversationId) throw notFound;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    swarmId: row.swarmId,
    userId: row.userId,
    workflow: row.workflow,
    strutRunId: row.strutRunId,
    conversationId,
    workspaceSlug: workspace.slug,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Strut's record → what the card gets: the proposer's identity dropped, the workspace added. */
export function publicProposal(raw: unknown, workspaceSlug: string): StrutProposalRecord | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.step !== "string") return null;
  const by = isRecord(raw.by) ? raw.by : {};
  const decision = isRecord(raw.decision) ? raw.decision : undefined;
  const result = isRecord(raw.result) ? raw.result : undefined;
  return {
    id: raw.id,
    step: raw.step,
    input: raw.input,
    ...(typeof raw.rationale === "string" ? { rationale: raw.rationale } : {}),
    title: typeof raw.title === "string" ? raw.title : raw.step,
    status: parseStrutProposalStatus(raw.status),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    by: {
      workflow: typeof by.workflow === "string" ? by.workflow : "",
      runId: typeof by.runId === "string" ? by.runId : "",
      ...(typeof by.path === "string" ? { path: by.path } : {}),
      ...(typeof by.job === "string" ? { job: by.job } : {}),
      ...(typeof by.session === "string" ? { session: by.session } : {}),
    },
    ...(decision
      ? {
          decision: {
            action: decision.action === "reject" ? "reject" : "accept",
            ...(typeof decision.by === "string" ? { by: decision.by } : {}),
            at: typeof decision.at === "string" ? decision.at : "",
            ...(decision.input !== undefined ? { input: decision.input } : {}),
            ...(typeof decision.reason === "string" ? { reason: decision.reason } : {}),
          },
        }
      : {}),
    ...(result
      ? {
          result: {
            ...(result.output !== undefined ? { output: result.output } : {}),
            ...(typeof result.error === "string" ? { error: result.error } : {}),
            ...(typeof result.cost === "number" ? { cost: result.cost } : {}),
            at: typeof result.at === "string" ? result.at : "",
          },
        }
      : {}),
    workspaceSlug,
  };
}

/** The record must be THIS run's — strut keys proposals globally. */
function ownedBy(record: StrutProposalRecord | null, row: ProposalTurnRow): StrutProposalRecord | null {
  if (!record) return null;
  return row.strutRunId && record.by.runId === row.strutRunId ? record : null;
}

/** `GET {lab}/proposals/:id` on the ROW's swarm. Null = not this run's, or gone. Throws 502 when strut cannot answer. */
export async function readStrutProposal(row: ProposalTurnRow, proposalId: string): Promise<StrutProposalRecord | null> {
  const lab = await labForRow(row);
  if (!lab) throw new StrutProposalError(502, "Swarm credentials unavailable");
  let res: Response;
  try {
    res = await fetch(`${lab.labBase}/proposals/${encodeURIComponent(proposalId)}`, {
      headers: { "x-api-token": lab.swarmApiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn("Strut proposal unreachable", LOG_TAG, {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new StrutProposalError(502, "Could not reach strut on the workspace swarm.");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new StrutProposalError(502, `Strut answered ${res.status}`);
  return ownedBy(publicProposal(await res.json().catch(() => null), row.workspaceSlug), row);
}

export interface ProposalDecision {
  action: "accept" | "reject";
  reason?: string;
  /** Edits merged onto the proposal's input on accept (strut re-validates). */
  input?: Record<string, unknown>;
}

export type DecideOutcome =
  /** Strut recorded the decision (and ran the step on accept): the record after it. */
  | { status: 200; proposal: StrutProposalRecord }
  /** Already decided: strut's record as it stands. */
  | { status: 409; proposal: StrutProposalRecord | null; error: string }
  /** Strut refused the edits / the step is gone / no such proposal. */
  | { status: 400 | 404; error: string };

/**
 * `POST {lab}/proposals/:id/decide` as the clicking user. The record is
 * checked to be this run's BEFORE the decision goes out.
 */
export async function decideStrutProposal(
  row: ProposalTurnRow,
  proposalId: string,
  decision: ProposalDecision,
  userId: string,
): Promise<DecideOutcome> {
  const before = await readStrutProposal(row, proposalId);
  if (!before) return { status: 404, error: "Not found" };
  const lab = await labForRow(row);
  if (!lab) throw new StrutProposalError(502, "Swarm credentials unavailable");
  const actor = await resolveStrutActor(userId);
  let res: Response;
  try {
    res = await fetch(`${lab.labBase}/proposals/${encodeURIComponent(proposalId)}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": lab.swarmApiKey, [STRUT_ACTOR_HEADER]: actor },
      body: JSON.stringify({
        action: decision.action,
        ...(decision.reason ? { reason: decision.reason } : {}),
        ...(decision.input ? { input: decision.input } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(DECIDE_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn("Strut decide unreachable", LOG_TAG, {
      runId: row.id,
      proposalId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new StrutProposalError(502, "Could not reach strut on the workspace swarm.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 200) {
    const proposal = publicProposal(body, row.workspaceSlug);
    if (!proposal) throw new StrutProposalError(502, "Strut answered without the record");
    return { status: 200, proposal };
  }
  const detail = isRecord(body) && typeof body.error === "string" ? body.error : undefined;
  if (res.status === 409) {
    // Strut answers with the record once decided — under `proposal`, or as the body.
    const record = isRecord(body) && isRecord(body.proposal) ? body.proposal : body;
    return {
      status: 409,
      proposal: publicProposal(record, row.workspaceSlug),
      error: detail ?? "This proposal has already been decided.",
    };
  }
  if (res.status === 400) return { status: 400, error: detail ?? "Strut refused the decision (400)." };
  if (res.status === 404) return { status: 404, error: "Not found" };
  throw new StrutProposalError(502, detail ?? `Strut answered ${res.status}`);
}

/** The result row's text for a decided proposal. */
export function renderProposalResult(title: string, status: StrutProposalStatus, error?: string): string {
  switch (status) {
    case "applied":
      return `Applied: ${title}`;
    case "rejected":
      return `Rejected: ${title}`;
    case "failed":
      return `Failed: ${title}${error ? ` — ${error}` : ""}`;
    case "accepted":
      return `Accepted: ${title}`;
    default:
      return `${title}: ${status}`;
  }
}

/**
 * Write the decision into the conversation — "Applied: <title>" /
 * "Rejected: <title>" / the error — with the turn rows' discipline. One row
 * per decision (a failed proposal may be accepted again), never a reason
 * to fail the decision itself.
 */
export async function appendProposalResultRow(row: ProposalTurnRow, proposal: StrutProposalRecord): Promise<void> {
  try {
    await appendOrchestratorRows(
      { workspaceId: row.workspaceId, userId: row.userId, conversationId: row.conversationId },
      [
        {
          id: `orchestrator-${row.id}-proposal-${proposal.id}-${proposal.status}-${Date.now().toString(36)}`,
          content: renderProposalResult(proposal.title, proposal.status, proposal.result?.error),
          source: {
            kind: "proposal_result",
            runId: row.id,
            proposalId: proposal.id,
            status: proposal.status,
            title: proposal.title,
          },
        },
      ],
    );
  } catch (err) {
    logger.warn("Proposal result row not written (non-fatal)", LOG_TAG, {
      runId: row.id,
      proposalId: proposal.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
