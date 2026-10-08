/**
 * Artifact events — an event about an artifact a job reported becomes a
 * turn on that job (strut `plans/job-artifact-events.md` §3). Three generic
 * parts, each over the KIND of artifact; the pull request is the first
 * case, not the shape:
 *
 *  - THE INDEX (`StrutJobArtifact`): every ref a turn reports that has a
 *    URL, written when the turn settles (`indexJobArtifacts`, from the
 *    `job_turn` handler) — one row per (job, ref), keyed on the launch's
 *    workspace. One query: which jobs of this workspace reported URL X.
 *  - THE SHAPE: one first line, `[artifact-event] <kind> <url> <what>`
 *    (`formatArtifactEvent`, `lib/strut-jobs.ts`), the specifics below.
 *  - THE DOOR (`deliverArtifactEvent`): a SOURCE — the GitHub webhook —
 *    names a URL and what happened; every job that reported it gets one
 *    turn, launched as the job's owner into the job's conversation
 *    (`launchJobTurn`), with the event as the whole prompt. A job whose
 *    turn is in flight cannot take one — and a webhook on Vercel cannot
 *    wait it out — so the event is STORED on the ref's row (one slot; a
 *    later event on the same ref replaces it: the latest state is the one
 *    worth a turn) and the settle handler launches what is pending as the
 *    next turn (`launchPendingArtifactEvents`): the chat notifier's rule,
 *    hive-side. Several waiting on one job go as one turn, one line each.
 *
 * What to DO with an event is the job's: the `Pod` page on the swarm says
 * what a merge means for the pod. Hive models no lifecycle; the thread is
 * the state. A source is an adapter and nothing else is per kind.
 */

import { after } from "next/server";
import { Prisma } from "@prisma/client";
import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { formatArtifactEvent, jobTitleOf, parseArtifactEvent } from "@/lib/strut-jobs";
import { firstJobTurn, jobHasLiveTurn, launchJobTurn } from "@/services/strut-jobs";

const LOG_TAG = "JOB_ARTIFACT_EVENT";
/** Cap on an event's text, stored and sent. */
const MAX_EVENT_CHARS = 8_000;

/** An event's text within the cap — every source caps what it stores or sends. */
export const capEventText = (s: string): string => (s.length > MAX_EVENT_CHARS ? `${s.slice(0, MAX_EVENT_CHARS)}…` : s);
const cap = capEventText;
const isAbsolute = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//i.test(url);

// ─── The index ────────────────────────────────────────────────────────────

export interface IndexedArtifact {
  artifactId: string;
  kind: string;
  url: string;
}

/**
 * The refs of a turn an external system can name: inline content with an
 * absolute URL — a pull request (the URL `pullRequestContent` settles on),
 * a page, a deploy. A file in the job's directory is strut's own and has
 * no life outside it. Pure.
 */
export function indexableArtifacts(refs: ArtifactRef[]): IndexedArtifact[] {
  const out: IndexedArtifact[] = [];
  for (const ref of refs) {
    if (ref.source.type !== "inline") continue;
    const url = ref.source.content.url;
    if (!isAbsolute(url)) continue;
    out.push({ artifactId: ref.id, kind: ref.kind, url });
  }
  return out;
}

/** Write a turn's refs into the index — the same id again is the same ref, newer. Throws on a database failure (the handler retries). */
export async function indexJobArtifacts(row: { workspaceId: string; swarmId: string }, jobId: string, refs: ArtifactRef[]): Promise<number> {
  const entries = indexableArtifacts(refs);
  for (const entry of entries) {
    await db.strutJobArtifact.upsert({
      where: { jobId_artifactId: { jobId, artifactId: entry.artifactId } },
      create: { workspaceId: row.workspaceId, swarmId: row.swarmId, jobId, artifactId: entry.artifactId, kind: entry.kind, url: entry.url },
      update: { workspaceId: row.workspaceId, swarmId: row.swarmId, kind: entry.kind, url: entry.url },
    });
  }
  return entries.length;
}

// ─── The door ─────────────────────────────────────────────────────────────

export interface ArtifactEventSource {
  /** The source's workspace — the webhook route's `[workspaceId]`; a ref is matched within it only. */
  workspaceId: string;
  /** The artifact's URL as the source knows it (a pull request's `html_url`); matched case-insensitively. */
  url: string;
  /** What happened, one line. */
  what: string;
  /** The specifics, one per line (a failing check with its link). */
  details?: string[];
  publicBaseUrl: string;
}

export type ArtifactEventOutcome = "launched" | "queued" | "skipped";

export interface ArtifactEventDelivery {
  jobs: Array<{ jobId: string; outcome: ArtifactEventOutcome }>;
}

/** Every job of the workspace that reported the URL gets the event: a turn now, or one queued behind the live one. */
export async function deliverArtifactEvent(source: ArtifactEventSource): Promise<ArtifactEventDelivery> {
  const refs = await db.strutJobArtifact.findMany({
    where: { workspaceId: source.workspaceId, url: { equals: source.url, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, jobId: true, kind: true, url: true },
  });
  const jobs: ArtifactEventDelivery["jobs"] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.jobId)) continue;
    seen.add(ref.jobId);
    const text = cap(formatArtifactEvent({ kind: ref.kind, url: ref.url, what: source.what }, source.details));
    jobs.push({ jobId: ref.jobId, outcome: await startEventTurn(ref.jobId, text, ref.id, source.publicBaseUrl) });
  }
  logger.info("Artifact event delivered", LOG_TAG, { workspaceId: source.workspaceId, url: source.url, what: source.what, jobs });
  return { jobs };
}

/**
 * A card's action on an artifact the job reported (strut
 * plans/job-artifact-events.md §5 — the pull-request panel's Fix): the
 * event, composed as a source's would be, with the ref's kind and the URL
 * as indexed. Null when the job never reported that URL — a viewer sends
 * to the job on its own row only.
 */
export async function composeJobArtifactEvent(jobId: string, url: string, what: string, details?: string[]): Promise<string | null> {
  const ref = await db.strutJobArtifact.findFirst({
    where: { jobId, url: { equals: url, mode: "insensitive" } },
    select: { kind: true, url: true },
  });
  return ref ? cap(formatArtifactEvent({ kind: ref.kind, url: ref.url, what }, details)) : null;
}

/**
 * `deliverArtifactEvent` after the response, never throwing — for a
 * webhook that must answer GitHub now and has nowhere to retry from. A
 * delivery that fails is logged; the idle sweep on strut is the backstop.
 */
export function forwardArtifactEvent(source: ArtifactEventSource): void {
  const run = () =>
    deliverArtifactEvent(source).then(
      () => undefined,
      (err: unknown) =>
        logger.warn("Artifact event delivery failed (non-fatal)", LOG_TAG, {
          workspaceId: source.workspaceId,
          url: source.url,
          error: err instanceof Error ? err.message : String(err),
        }),
    );
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * Launch the event as the job's next turn — or store it on the ref's row
 * when the job is busy. The door's one step every source ends on: the
 * webhook through `deliverArtifactEvent`, a check failure hive forwards
 * on its own (`check-failures.ts`) with its own event text.
 */
export async function startEventTurn(jobId: string, text: string, slotId: string, publicBaseUrl: string): Promise<ArtifactEventOutcome> {
  const first = await firstJobTurn(jobId);
  if (!first?.conversationId) {
    logger.warn("Artifact event for a job with no conversation — dropped", LOG_TAG, { jobId });
    return "skipped";
  }
  if (await jobHasLiveTurn(jobId)) {
    await queueEvent(slotId, text);
    return "queued";
  }
  const result = await launchJobTurn(
    { userId: first.userId, workspaceId: first.workspaceId, conversationId: first.conversationId, publicBaseUrl },
    { jobId, title: jobTitleOf(first), prompt: text, started: false, event: true },
  );
  if (result.status === "busy") {
    await queueEvent(slotId, text);
    return "queued";
  }
  if (result.status === "error") {
    logger.warn("Artifact event turn refused — dropped", LOG_TAG, { jobId, error: result.error });
    return "skipped";
  }
  return "launched";
}

async function queueEvent(slotId: string, text: string): Promise<void> {
  await db.strutJobArtifact.update({ where: { id: slotId }, data: { pendingEvent: text, pendingAt: new Date() } });
}

/**
 * A turn that could not start because the job was busy (strut's
 * `job_busy:`, the race the live check cannot close) gives its event back
 * to the ref's slot — unless a newer event has taken it since.
 */
export async function requeueArtifactEvent(jobId: string, text: string): Promise<boolean> {
  const event = parseArtifactEvent(text);
  if (!event) return false;
  const { count } = await db.strutJobArtifact.updateMany({
    where: { jobId, url: event.url, pendingEvent: null },
    data: { pendingEvent: cap(text), pendingAt: new Date() },
  });
  return count > 0;
}

/**
 * What the settle handler calls once a turn of the job has ended: the
 * events that waited go as ONE turn, one `[artifact-event]` block each,
 * oldest first. Taken atomically, so two deliveries settling the same row
 * (a replay) cannot both launch them; a job busy again (a person continued
 * it meanwhile) gets them back on the first slot.
 */
export async function launchPendingArtifactEvents(jobId: string, publicBaseUrl: string): Promise<ArtifactEventOutcome | "none"> {
  const taken = await db.$queryRaw<Array<{ id: string; pending_event: string; pending_at: Date | null }>>(Prisma.sql`
    UPDATE strut_job_artifacts
    SET pending_event = NULL, pending_at = NULL, updated_at = NOW()
    WHERE job_id = ${jobId} AND pending_event IS NOT NULL
    RETURNING id, pending_event, pending_at
  `);
  if (taken.length === 0) return "none";
  taken.sort((a, b) => (a.pending_at?.getTime() ?? 0) - (b.pending_at?.getTime() ?? 0));
  const text = cap(Array.from(new Set(taken.map((t) => t.pending_event))).join("\n\n"));
  return startEventTurn(jobId, text, taken[0].id, publicBaseUrl);
}
