/**
 * Strut jobs on the infinite canvas's cards, server side
 * (`lib/canvas/canvas-jobs.ts` for the shapes; `docs/plans/infinite-canvas.md`
 * §2.3–4). A job is on the card its `job_turn` row's `input.focus` names —
 * stamped when the orchestrator turn that started it was launched from that
 * card. Two things here:
 *
 *  - `nudgeCanvasCardJob`: tell the org's open canvases a job on a card
 *    moved (a live update, a new row, a settled turn). Ids and state only.
 *  - `listCanvasJobs`: the jobs on an initiative's cards for the read
 *    route, each with the artifacts its turns delivered to the starter's
 *    chat — the same refs, read back from the job rows (`job-<StrutRun.id>`).
 */

import { StrutRunStatus } from "@prisma/client";
import { mockCanvasJobs } from "@/app/api/mock/graph/canvas-jobs";
import { mockLatency } from "@/app/api/mock/graph/latency";
import { MOCK_STRUT_SWARM_ID } from "@/app/api/mock/graph/strut-artifacts";
import { parseArtifactRefs, type ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { canvasFocusOfInput, type CanvasJob, type CanvasJobState } from "@/lib/canvas/canvas-jobs";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyCanvasCardJob } from "@/lib/pusher";
import { JOB_TURN_KIND, jobTitleOf } from "@/lib/strut-jobs";
import { getWorkspaceOrgGithubLogin, validateWorkspaceAccess } from "@/services/workspace";

const LOG_TAG = "CANVAS_JOBS";
/** How far back the canvas looks for a card's jobs. */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Turns read per initiative, newest first. */
const MAX_ROWS = 200;

const useMocks = () => process.env.USE_MOCKS === "true";

/** A settled (or pending) row's status as a card shows it. */
export function canvasJobStateOf(status: StrutRunStatus): CanvasJobState {
  if (status === StrutRunStatus.PENDING) return "running";
  return status === StrutRunStatus.SUCCESS ? "done" : "failed";
}

/** Workspace → org login, for the org channel; live updates come often, the answer never changes. */
const orgLogins = new Map<string, string | null>();
async function orgLoginOf(workspaceId: string): Promise<string | null> {
  if (orgLogins.has(workspaceId)) return orgLogins.get(workspaceId) ?? null;
  const login = await getWorkspaceOrgGithubLogin(workspaceId);
  orgLogins.set(workspaceId, login);
  return login;
}

/**
 * Nudge the org's canvases about a job on a card. Nothing for a row with no
 * canvas focus. Never throws: a live update or a settled turn never fails
 * for this.
 */
export async function nudgeCanvasCardJob(
  row: { id?: string; jobId: string | null; workspaceId: string; input: unknown },
  state: CanvasJobState,
  latest?: { kind: string },
): Promise<void> {
  const focus = canvasFocusOfInput(row.input);
  if (!focus || !row.jobId) return;
  try {
    const login = await orgLoginOf(row.workspaceId);
    if (!login) return;
    notifyCanvasCardJob(login, {
      jobId: row.jobId,
      ...(row.id ? { runId: row.id } : {}),
      state,
      refId: focus.refId,
      initiativeRefId: focus.initiativeRefId,
      workspaceSlug: focus.workspaceSlug,
      at: Date.now(),
      ...(latest ? { latest } : {}),
    });
  } catch (err) {
    logger.warn("Canvas job nudge failed (non-fatal)", LOG_TAG, {
      jobId: row.jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** A run's error as one short line for a card. */
const errorLine = (error: string) => {
  const line = error.split("\n")[0].trim();
  return line.length > ERROR_CHARS ? `${line.slice(0, ERROR_CHARS - 1)}…` : line;
};
const ERROR_CHARS = 160;

export interface CanvasJobsRead {
  jobs: CanvasJob[];
  /** Card ref_id → the artifacts of its jobs, newest job first, one per artifact id (its latest version). */
  artifactsByRef: Record<string, ArtifactRef[]>;
}

/**
 * The jobs on one initiative's cards that `userId` may see: rows whose
 * focus names the initiative, in workspaces of the org the caller can read.
 * Chats stay personal; the jobs and their artifacts are the canvas's.
 */
export async function listCanvasJobs(orgId: string, userId: string, initiativeRefId: string): Promise<CanvasJobsRead> {
  if (useMocks()) {
    // Mock jobs carry strut's own `run.end` entries; they map the way a real job's do. Imported here because
    // job-turn imports this module (a top-level import would be circular).
    const { mapStrutArtifacts } = await import("@/services/strut-runs/job-turn");
    await mockLatency();
    return mockCanvasJobs(initiativeRefId, (e) => mapStrutArtifacts(e, MOCK_STRUT_SWARM_ID).refs);
  }

  const rows = await db.strutRun.findMany({
    where: {
      kind: JOB_TURN_KIND,
      jobId: { not: null },
      createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
      input: { path: ["focus", "initiativeRefId"], equals: initiativeRefId },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
    select: {
      id: true,
      jobId: true,
      workspaceId: true,
      userId: true,
      status: true,
      error: true,
      input: true,
      conversationId: true,
      createdAt: true,
      settledAt: true,
    },
  });
  if (rows.length === 0) return { jobs: [], artifactsByRef: {} };

  // Only the org's workspaces the caller can read — the reader route's rule.
  const workspaces = await db.workspace.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.workspaceId))] }, sourceControlOrgId: orgId, deleted: false },
    select: { id: true, slug: true },
  });
  const readable = new Set<string>();
  await Promise.all(
    workspaces.map(async (w) => {
      if ((await validateWorkspaceAccess(w.slug, userId)).canRead) readable.add(w.id);
    }),
  );
  const visible = rows.filter((r) => readable.has(r.workspaceId));

  // Per job, its turns newest first: the newest says the state, the first who started it.
  const turnsByJob = new Map<string, typeof visible>();
  for (const r of visible) {
    const list = turnsByJob.get(r.jobId!) ?? [];
    list.push(r);
    turnsByJob.set(r.jobId!, list);
  }

  const [starters, delivered] = await Promise.all([
    db.user.findMany({
      where: { id: { in: [...new Set([...turnsByJob.values()].map((t) => t[t.length - 1].userId))] } },
      select: { id: true, name: true },
    }),
    deliveredArtifacts(visible),
  ]);
  const nameOf = new Map(starters.map((u) => [u.id, u.name]));

  const jobs: CanvasJob[] = [];
  const artifactsByRef: Record<string, ArtifactRef[]> = {};
  for (const [jobId, turns] of turnsByJob) {
    const newest = turns[0];
    const first = turns[turns.length - 1];
    const focus = canvasFocusOfInput(first.input) ?? canvasFocusOfInput(newest.input);
    if (!focus) continue;
    jobs.push({
      jobId,
      runId: newest.id,
      title: jobTitleOf(first),
      state: canvasJobStateOf(newest.status),
      startedBy: { id: first.userId, name: nameOf.get(first.userId) ?? null },
      refId: focus.refId,
      initiativeRefId: focus.initiativeRefId,
      updatedAt: (newest.settledAt ?? newest.createdAt).getTime(),
      ...(canvasJobStateOf(newest.status) === "failed" && newest.error ? { error: errorLine(newest.error) } : {}),
    });
    // Oldest turn first, so a card's later version (claims, trace) replaces its earlier one.
    const refs = new Map<string, ArtifactRef>();
    for (const t of [...turns].reverse()) for (const ref of delivered.get(t.id) ?? []) refs.set(ref.id, ref);
    if (refs.size > 0) (artifactsByRef[focus.refId] ??= []).push(...refs.values());
  }
  jobs.sort((a, b) => b.updatedAt - a.updatedAt);
  return { jobs, artifactsByRef };
}

/**
 * The artifacts each settled turn's row carried into its conversation —
 * `StrutRun.id` → refs — read with one query over the job rows only.
 */
async function deliveredArtifacts(
  rows: ReadonlyArray<{ id: string; status: StrutRunStatus; conversationId: string | null }>,
): Promise<Map<string, ArtifactRef[]>> {
  const settled = rows.filter((r) => r.status !== StrutRunStatus.PENDING && r.conversationId);
  const out = new Map<string, ArtifactRef[]>();
  if (settled.length === 0) return out;
  const conversationIds = [...new Set(settled.map((r) => r.conversationId!))];
  const rowIds = settled.map((r) => `job-${r.id}`);
  const found = await db.$queryRaw<Array<{ id: string; artifacts: unknown }>>`
    SELECT m->>'id' AS id, m->'artifacts' AS artifacts
    FROM shared_conversations c,
      jsonb_array_elements(CASE WHEN jsonb_typeof(c.messages) = 'array' THEN c.messages ELSE '[]'::jsonb END) m
    WHERE c.id = ANY(${conversationIds}::text[])
      AND m->>'id' = ANY(${rowIds}::text[])
  `;
  for (const f of found) {
    const refs = parseArtifactRefs(f.artifacts);
    if (refs) out.set(f.id.slice("job-".length), refs);
  }
  return out;
}
