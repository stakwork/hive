/**
 * Completion handler for `kind: "orchestrator_turn"` — one turn of strut's
 * `orchestrator` workflow, the engine behind Jamie (the launch in
 * `services/strut-orchestrator.ts`).
 *
 * The turn's run settled; this is where its reply reaches the canvas chat.
 * The workflow answers in the job turn's shape — `{ text, artifacts, ask?,
 * cost, session }` — and strut resolves its `artifacts` list where a host
 * receives it (`GET {lab}/workflows/orchestrator/runs/<runId>/artifacts`),
 * so the list is read from the ROW's swarm exactly as `job-turn.ts` does,
 * and mapped by the same `mapStrutArtifacts`. Beside it, the run's
 * PROPOSALS (strut CALLBACKS.md §6): the gated graph writes the agent asked
 * for, read from `GET …/runs/<runId>/proposals` — the callback field's
 * twin — so the webhook and the reconcile path stay one code path.
 *
 * It appends to the row's conversation, in one transaction:
 *   - ONE assistant row `orchestrator-<StrutRun.id>` — the agent's `text`,
 *     its `ask` as a question, `artifacts` as refs, `source.kind:
 *     "orchestrator"`; shown as a plain reply bubble — and `jobs`, the job
 *     turns it launched (`job/start`, `job/continue`), read from the run's
 *     event log. Each gets its `job_turn` row minted PENDING here
 *     (`orchestrator-jobs.ts`), so the chat hangs a running card under the
 *     reply until the job's own `run.end` settles that row. The row is
 *     recorded under the workflow the turn runs (`job` or `builder`): a
 *     `job/start` names it, a `job/continue` runs the job's own — hive's
 *     newest row of the job, else strut's `GET /jobs/:id`. A log strut
 *     cannot serve delivers the reply without them: the job lands whole;
 *   - ONE row per proposal, `orchestrator-<id>-proposal-<proposalId>`,
 *     `source.kind: "proposal"` — the card (`StrutProposalCard`) reads the
 *     record live and decides it on strut. The brief's `summary` and
 *     strut's `card` are kept on it as they came, with the workspace whose
 *     strut ran the turn, for a reader outside hive (a tribe's post).
 * `error` / `cancelled` / LOST rows append a reply row saying so; a run
 * strut refused because the session was still on the previous message
 * (`session_busy:`) says "still working", not "failed". A reply that is
 * exactly `ORCHESTRATOR_SILENT_MARKER` — a wake with nothing to add
 * (`strut-orchestrator-wake.ts`) — appends a `silent` row with no text,
 * which the chat hides: the working card still needs the row to land.
 *
 * No hive auto-turn: strut's agent remembers the conversation through its
 * session. The one wake in it goes the other way — a job's turn lands in
 * the conversation and wakes the orchestrator (`strut-orchestrator-wake.ts`).
 * The append
 * has `job-turn.ts`'s discipline — `FOR UPDATE`, ownership re-checked
 * against hive's rows (never the payload), idempotent by row id — and
 * never throws for a missing target. A transient failure reading strut
 * throws, so the webhook answers 5xx and strut re-posts; a 404 delivers
 * the text alone.
 */

import { StrutRunStatus } from "@prisma/client";
import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import {
  ORCHESTRATOR_BUSY_NOTE,
  ORCHESTRATOR_TURN_KIND,
  ORCHESTRATOR_WORKFLOW,
  isOrchestratorSilentReply,
  orchestratorAskLine,
  orchestratorRowId,
  parseOrchestratorJobCalls,
  parseStrutProposalBriefs,
  strutProposalRowId,
  type StrutArtifactEnvelope,
  type OrchestratorJobLaunch,
  type OrchestratorLaunchRowSource,
  type OrchestratorRowSource,
  type OrchestratorTurnOutcome,
  type StrutProposalBrief,
  type StrutProposalResultRowSource,
  type StrutProposalRowSource,
} from "@/lib/strut-orchestrator";
import { labForRow, type StrutRunHandlerContext, type StrutRunRow } from "@/services/strut-runs";
import { fetchStrutJobWorkflow, fetchStrutRunEvents } from "@/services/strut-runs/lab";
import { nudgeCanvasCardJob } from "@/services/canvas-jobs";
import { adoptOrchestratorJobRun, recordedJobWorkflow } from "@/services/strut-runs/orchestrator-jobs";
import { jobTurnOutputSchema, mapStrutArtifacts, peerSwarmsFor, readRunArtifacts, strutEnvelopeFor } from "@/services/strut-runs/job-turn";

export { ORCHESTRATOR_TURN_KIND, ORCHESTRATOR_WORKFLOW };

const LOG_TAG = "ORCHESTRATOR_TURN";
const READ_TIMEOUT_MS = 10_000;
/** Cap on the agent's reply text stored on the row. */
const MAX_TEXT_CHARS = 20_000;
/** Cap on an error message shown in the row. */
const MAX_ERROR_CHARS = 1_000;

const cap = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

export interface OrchestratorReply {
  outcome: OrchestratorTurnOutcome;
  /** The agent's reply, or what went wrong. */
  text: string;
  ask?: string;
  /** Strut's error message for a failed turn (already capped). */
  error?: string;
}

/** What a settled row says — pure, so every branch is testable. */
export function replyForOrchestratorRow(row: StrutRunRow): OrchestratorReply {
  switch (row.status) {
    case StrutRunStatus.CANCELLED:
      return { outcome: "cancelled", text: "The turn was stopped." };
    case StrutRunStatus.LOST:
      return {
        outcome: "lost",
        text: "Strut lost track of this turn (it restarted before recording it). Send the message again.",
      };
    case StrutRunStatus.ERROR: {
      const error = cap(row.error || "The run failed.", MAX_ERROR_CHARS);
      const text = /\bsession_busy:/.test(error) ? ORCHESTRATOR_BUSY_NOTE : `The turn did not complete: ${error}`;
      return { outcome: "error", text, error };
    }
    case StrutRunStatus.PENDING:
      return { outcome: "error", text: "" };
    case StrutRunStatus.SUCCESS:
      break;
  }
  const parsed = jobTurnOutputSchema.safeParse(row.output);
  if (!parsed.success) {
    return {
      outcome: "error",
      text: "The turn ended, but its result was not in the shape the orchestrator answers in.",
      error: "unexpected output",
    };
  }
  const ask = parsed.data.ask?.message?.trim() || undefined;
  // The stay-silent convention: the marker alone, and no question.
  if (!ask && isOrchestratorSilentReply(parsed.data.text)) return { outcome: "silent", text: "" };
  const text = parsed.data.text?.trim() ? cap(parsed.data.text.trim(), MAX_TEXT_CHARS) : "_(no reply text)_";
  return { outcome: "success", text, ...(ask ? { ask } : {}) };
}

/** The reply row's text: the agent's words, its question, what could not be shown. */
export function renderOrchestratorContent(
  reply: OrchestratorReply,
  dropped: Array<{ title: string; reason: string }>,
): string {
  const parts = reply.text ? [reply.text] : [];
  if (reply.ask) parts.push(orchestratorAskLine(reply.ask));
  if (dropped.length > 0) parts.push(dropped.map((d) => `_Unavailable: ${d.title} (${d.reason})_`).join("\n"));
  return parts.join("\n\n");
}

/** A proposal row's text — what a reader of the stored conversation sees of it. */
export function renderProposalContent(brief: Pick<StrutProposalBrief, "title" | "step" | "rationale">): string {
  return `Proposed: ${brief.title} (\`${brief.step}\`)${brief.rationale ? ` — ${brief.rationale}` : ""}`;
}

export type OrchestratorMessageSource =
  | OrchestratorRowSource
  | OrchestratorLaunchRowSource
  | StrutProposalRowSource
  | StrutProposalResultRowSource;

export interface OrchestratorMessageRow {
  id: string;
  role: "assistant";
  content: string;
  timestamp: string;
  source: OrchestratorMessageSource;
  artifacts?: ArtifactRef[];
  /** strut's own entries for the reply, as they came (`StrutArtifactEnvelope`). */
  strut?: StrutArtifactEnvelope;
}

/** A row to append: everything but the stamp. */
export type OrchestratorRowDraft = Omit<OrchestratorMessageRow, "role" | "timestamp">;

// ─── Reading strut ────────────────────────────────────────────────────────

export type ProposalsRead =
  | { ok: true; proposals: StrutProposalBrief[] }
  /** The run is gone from strut (404), or a strut without proposals: deliver without. */
  | { ok: false; permanent: true; reason: string }
  /** Transient (unreachable, 5xx): throw so strut re-posts. */
  | { ok: false; permanent: false; reason: string };

/** `GET {lab}/workflows/<workflow>/runs/<runId>/proposals` on the ROW's swarm. Never throws. */
export async function readRunProposals(row: StrutRunRow): Promise<ProposalsRead> {
  if (!row.strutRunId) return { ok: false, permanent: true, reason: "no strut run id" };
  const lab = await labForRow(row);
  if (!lab) return { ok: false, permanent: true, reason: "swarm credentials unavailable" };
  try {
    const res = await fetch(
      `${lab.labBase}/workflows/${encodeURIComponent(row.workflow)}/runs/${encodeURIComponent(row.strutRunId)}/proposals`,
      { headers: { "x-api-token": lab.swarmApiKey }, cache: "no-store", signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
    );
    if (res.status === 404) return { ok: false, permanent: true, reason: "run not found on strut" };
    if (!res.ok) return { ok: false, permanent: false, reason: `HTTP ${res.status}` };
    const body = (await res.json()) as { proposals?: unknown };
    return { ok: true, proposals: parseStrutProposalBriefs(body.proposals) };
  } catch (err) {
    return { ok: false, permanent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The job turns the run launched, each with its `job_turn` row (found or
 * minted PENDING). Never throws: a log strut cannot serve, or a row that
 * cannot be written, leaves the job to land whole when it ends.
 */
export async function launchedJobTurns(row: StrutRunRow): Promise<OrchestratorJobLaunch[]> {
  const events = await fetchStrutRunEvents(row, READ_TIMEOUT_MS);
  if (!events) return [];
  const launches: OrchestratorJobLaunch[] = [];
  for (const call of parseOrchestratorJobCalls(events)) {
    try {
      const workflow =
        call.workflow ??
        (await recordedJobWorkflow(row.swarmId, call.job)) ??
        (await fetchStrutJobWorkflow(row, call.job, READ_TIMEOUT_MS)) ??
        undefined;
      const jobRow = await adoptOrchestratorJobRun(row, {
        job: call.job,
        runId: call.runId,
        title: call.title ?? null,
        ...(workflow ? { workflow } : {}),
      });
      launches.push({ jobId: call.job, title: call.title ?? "", runId: jobRow.id, ...(call.peer ? { peer: call.peer } : {}) });
      // Its canvas card can show the job's title and starter now.
      if (jobRow.status === StrutRunStatus.PENDING) await nudgeCanvasCardJob({ ...jobRow, jobId: call.job }, "running");
    } catch (err) {
      logger.warn("Orchestrator turn: could not mint the row of a job it launched", LOG_TAG, {
        runId: row.id,
        job: call.job,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return launches;
}

// ─── Delivery ─────────────────────────────────────────────────────────────

export type OrchestratorAppendResult = { appended: string[]; duplicate: string[]; skipped: boolean };

/**
 * Append rows to the conversation. The target comes from the ROW
 * (`conversationId`, `userId`, the workspace's org) and is re-checked
 * against hive's own rows the way the dispatch admitted it (the
 * workspace's org, owned by the user or shared). Each row is idempotent by
 * id; rows already there are left alone. Throws only on a database failure.
 */
export async function appendOrchestratorRows(
  row: Pick<StrutRunRow, "workspaceId" | "userId" | "conversationId">,
  drafts: OrchestratorRowDraft[],
  reason: "orchestrator" = "orchestrator",
): Promise<OrchestratorAppendResult> {
  const { conversationId } = row;
  const result: OrchestratorAppendResult = { appended: [], duplicate: [], skipped: true };
  if (!conversationId || drafts.length === 0) return result;

  await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({
      where: { id: row.workspaceId },
      select: { sourceControlOrgId: true },
    });
    const conversation = await tx.sharedConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, sourceControlOrgId: true, isShared: true },
    });
    if (!workspace?.sourceControlOrgId || !conversation) return;
    if (
      conversation.sourceControlOrgId !== workspace.sourceControlOrgId ||
      (conversation.userId !== row.userId && !conversation.isShared)
    ) {
      logger.warn("Orchestrator turn: conversation ownership mismatch — bail", LOG_TAG, {
        conversationId,
        rows: drafts.map((d) => d.id),
      });
      return;
    }

    const locked = await tx.$queryRaw<{ messages: unknown }[]>`
      SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return;
    const existing = Array.isArray(locked[0].messages) ? (locked[0].messages as Array<{ id?: string }>) : [];
    const have = new Set(existing.map((m) => m?.id).filter((id): id is string => typeof id === "string"));
    result.skipped = false;

    const stamp = new Date().toISOString();
    const fresh: OrchestratorMessageRow[] = [];
    for (const draft of drafts) {
      if (have.has(draft.id)) {
        result.duplicate.push(draft.id);
        continue;
      }
      fresh.push({ role: "assistant", timestamp: stamp, ...draft });
      result.appended.push(draft.id);
    }
    if (fresh.length === 0) return;

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: { messages: [...existing, ...fresh] as unknown as never, lastMessageAt: new Date() },
    });
  });

  if (result.appended.length > 0) notifyCanvasConversationUpdated(conversationId, reason);
  return result;
}

/** The rows a settled turn appends — pure, so the test can see them whole. */
export function orchestratorRowsFor(
  row: Pick<StrutRunRow, "id" | "strutRunId">,
  reply: OrchestratorReply,
  refs: ArtifactRef[],
  dropped: Array<{ title: string; reason: string }>,
  proposals: StrutProposalBrief[],
  jobs: OrchestratorJobLaunch[] = [],
  strut?: StrutArtifactEnvelope,
  /** The slug of the workspace whose strut ran the turn, kept on each proposal row. */
  workspace?: string,
): OrchestratorRowDraft[] {
  const main: OrchestratorRowDraft = {
    id: orchestratorRowId(row.id),
    content: renderOrchestratorContent(reply, dropped),
    source: {
      kind: "orchestrator",
      runId: row.id,
      strutRunId: row.strutRunId ?? "",
      status: reply.outcome,
      ...(reply.ask ? { ask: reply.ask } : {}),
      ...(jobs.length > 0 ? { jobs } : {}),
    },
    ...(refs.length > 0 ? { artifacts: refs } : {}),
    ...(strut ? { strut } : {}),
  };
  const cards: OrchestratorRowDraft[] = proposals.map((p) => ({
    id: strutProposalRowId(row.id, p.id),
    content: renderProposalContent(p),
    source: {
      kind: "proposal",
      runId: row.id,
      proposalId: p.id,
      url: p.url,
      step: p.step,
      status: p.status,
      title: p.title,
      ...(p.summary ? { summary: p.summary } : {}),
      ...(p.card ? { card: p.card } : {}),
      ...(p.rationale ? { rationale: p.rationale } : {}),
      ...(p.createdAt ? { createdAt: p.createdAt } : {}),
      ...(workspace ? { workspace } : {}),
    },
  }));
  return [main, ...cards];
}

/** The `StrutRunHandler` for `orchestrator_turn`. Throws to be retried. */
export async function handleOrchestratorTurnSettled(row: StrutRunRow, _ctx?: StrutRunHandlerContext): Promise<void> {
  if (row.status === StrutRunStatus.PENDING) return;
  const reply = replyForOrchestratorRow(row);

  let refs: ArtifactRef[] = [];
  let dropped: Array<{ title: string; reason: string }> = [];
  let proposals: StrutProposalBrief[] = [];
  let jobs: OrchestratorJobLaunch[] = [];
  let strut: StrutArtifactEnvelope | undefined;
  // A silent turn may still have produced cards or proposals: read them
  // too, and the row shows as nothing only when it carries none.
  if (reply.outcome === "success" || reply.outcome === "silent") {
    const [artifacts, read, launched] = await Promise.all([
      readRunArtifacts(row),
      readRunProposals(row),
      launchedJobTurns(row),
    ]);
    jobs = launched;
    if (artifacts.ok) {
      ({ refs, dropped } = mapStrutArtifacts(artifacts.artifacts, row.swarmId, await peerSwarmsFor(row, artifacts.artifacts)));
      strut = await strutEnvelopeFor(row, artifacts.raw);
    } else if (artifacts.permanent) {
      logger.warn("Orchestrator turn artifacts unavailable — delivering the text alone", LOG_TAG, {
        runId: row.id,
        reason: artifacts.reason,
      });
      dropped = [{ title: "the turn's artifacts", reason: artifacts.reason }];
    } else {
      throw new Error(`orchestrator turn artifacts unavailable: ${artifacts.reason}`);
    }
    if (read.ok) {
      proposals = read.proposals;
    } else if (read.permanent) {
      logger.warn("Orchestrator turn proposals unavailable — delivering without them", LOG_TAG, {
        runId: row.id,
        reason: read.reason,
      });
    } else {
      throw new Error(`orchestrator turn proposals unavailable: ${read.reason}`);
    }
  }

  // A proposal's id is its strut's: a reader outside hive (a tribe's post) opens it on that workspace.
  const workspace =
    proposals.length > 0
      ? (strut?.workspace ??
        (await db.workspace.findUnique({ where: { id: row.workspaceId }, select: { slug: true } }))?.slug ??
        undefined)
      : undefined;
  const result = await appendOrchestratorRows(
    row,
    orchestratorRowsFor(row, reply, refs, dropped, proposals, jobs, strut, workspace),
  );
  logger.info("Orchestrator turn delivered", LOG_TAG, {
    runId: row.id,
    status: reply.outcome,
    artifacts: refs.map((r) => ({ id: r.id, kind: r.kind })),
    proposals: proposals.map((p) => ({ id: p.id, step: p.step, status: p.status })),
    jobs: jobs.map((j) => ({ jobId: j.jobId, runId: j.runId })),
    dropped: dropped.length,
    appended: result.appended.length,
    duplicate: result.duplicate.length,
    skipped: result.skipped,
  });

  // The Stop button: this run is no longer something to stop.
  if (row.conversationId) {
    try {
      const { clearActiveRun, notifyRunActive } = await import("@/services/canvas-active-runs-hooks");
      const { wasLast } = await clearActiveRun(row.conversationId, row.id);
      if (wasLast) await notifyRunActive(row.conversationId, false);
    } catch (err) {
      logger.warn("clearActiveRun failed after an orchestrator turn (non-fatal)", LOG_TAG, {
        runId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
