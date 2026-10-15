/**
 * A strut job's CLAIMS on hive (strut `plans/job-claims.md` §7): what the
 * work must deliver, and whether it does, as one card per job.
 *
 * - **The card.** After a turn the job-turn handler (`strut-runs/job-turn.ts`)
 *   reads the job's ledger off the ROW's swarm — `GET {lab}/jobs/<job>/claims`,
 *   each claim's status as of the newest turn, the latest verdict with the
 *   turn it is about and what it pointed at (a screenshot in the job's
 *   files), each check's outcome on the latest pass — and enriches it from
 *   the claims listing (`GET {lab}/claims?kind=job&name=<job>`: who stated
 *   each claim, the open slots and what they ask). One `ArtifactRef` of
 *   kind `claims`, id `claims-<job>`, inline: every turn a version. A swarm
 *   without the claims layer answers `enabled: false`, an older one 404:
 *   no card, never an error.
 * - **The card's actions** (`api/orgs/[githubLogin]/strut/jobs/[jobId]/claims`),
 *   as the job's owner and with no agent: Verify (`POST {lab}/jobs/<job>/verify`
 *   — every check against the newest turn), an answer to an open slot
 *   (`POST {lab}/claims/<claim>/evidence { job, runId, supports, content,
 *   slot }`), a new claim (`POST {lab}/claims` with an external check — a
 *   person's acceptance criterion; the job's agent may hang its instrument
 *   on it). Each re-reads the ledger and publishes a NEW VERSION of the card
 *   as a quiet `job_claims` row (`appendJobClaimsRow`), so the conversation
 *   is the record. A rejection with a note is the one that goes further:
 *   the slot is filled first, then the note is the job's next turn,
 *   `[claim-event] refuted "<claim>": <note>` (`formatClaimEvent`), through
 *   the same launch as an artifact event — that turn's reply brings the
 *   card's next version.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { claimNeedsLook, parseJobClaims, type ArtifactRef, type JobClaim } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { JOB_TURN_KIND, formatClaimEvent, jobTitleOf } from "@/lib/strut-jobs";
import { STRUT_ACTOR_HEADER, resolveStrutActor } from "@/services/bifrost/strut-delegation";
import { labForRow, type StrutRunRow } from "@/services/strut-runs";

const LOG_TAG = "JOB_CLAIMS";
/** A Verify runs every check — a browser drives a page per claim — so it gets the route's whole budget. */
const VERIFY_TIMEOUT_MS = 280_000;
const WRITE_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 10_000;

/** The card's id: one per job, so each turn's ledger is a version of it (`artifactIdentity`). */
export const claimsArtifactId = (jobId: string): string => `claims-${jobId}`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ─── The ledger, read and merged ─────────────────────────────────────────

/**
 * The ledger (`GET {lab}/jobs/<job>/claims`: status, latest verdict, each
 * check's last outcome) with what only the listing has (`GET
 * {lab}/claims?kind=job`: the speaker, the open slots and their questions,
 * an external check's description), matched by claim id. Pure. Without a
 * listing, an open slot is still known from the ledger — a check whose
 * outcome is `planned` — just without its question.
 */
export function mergeClaims(ledger: unknown, listing?: unknown): JobClaim[] {
  const listed = new Map<string, Record<string, unknown>>();
  if (Array.isArray(listing)) for (const r of listing) if (isRecord(r) && typeof r.id === "string") listed.set(r.id, r);
  const merged = parseJobClaims(ledger).map((claim) => {
    const l = listed.get(claim.id);
    const listedChecks = Array.isArray(l?.checks) ? l.checks.filter(isRecord) : [];
    const checks = claim.checks.map((k) => {
      const description = listedChecks.find((x) => x.id === k.id)?.description;
      return typeof description === "string" && description ? { ...k, description } : k;
    });
    const slots = Array.isArray(l?.slots)
      ? l.slots.filter(isRecord).map((s) => ({
          evidence: s.evidence,
          check: s.check,
          runId: isRecord(s.run) ? s.run.runId : undefined,
          question: s.question,
        }))
      : checks.flatMap((k) => (k.lastVerify && "planned" in k.lastVerify ? [{ evidence: k.lastVerify.planned, check: k.id }] : []));
    return { ...claim, ...(typeof l?.speaker === "string" ? { speaker: l.speaker } : {}), checks, slots };
  });
  return parseJobClaims(merged);
}

type Lab = { labBase: string; swarmApiKey: string };

/** The job's claims on its swarm; null when the swarm has no claims layer, the job is not there, or it did not answer. Never throws. */
export async function readJobClaims(lab: Lab, jobId: string, timeoutMs = READ_TIMEOUT_MS): Promise<JobClaim[] | null> {
  const headers = { "x-api-token": lab.swarmApiKey };
  const get = (path: string) => fetch(`${lab.labBase}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  try {
    const [ledgerRes, listingRes] = await Promise.all([
      get(`/jobs/${encodeURIComponent(jobId)}/claims`),
      get(`/claims?${new URLSearchParams({ kind: "job", name: jobId })}`).catch(() => null),
    ]);
    if (!ledgerRes.ok) return null;
    const ledger = (await ledgerRes.json()) as { enabled?: unknown; claims?: unknown };
    if (ledger.enabled !== true) return null;
    let listing: unknown;
    if (listingRes?.ok) listing = ((await listingRes.json().catch(() => ({}))) as { claims?: unknown }).claims;
    return mergeClaims(ledger.claims, listing);
  } catch (err) {
    logger.warn("Job claims unavailable", LOG_TAG, { jobId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ─── The card ─────────────────────────────────────────────────────────────

/** "2 supported, 1 needs a look" — the card's sentence; a claim waiting on a person counts once, as that. Pure. */
export function summarizeClaims(claims: JobClaim[]): string {
  const looks = claims.filter(claimNeedsLook).length;
  const n = (status: JobClaim["status"]) => claims.filter((c) => c.status === status && !claimNeedsLook(c)).length;
  const parts = [
    n("supported") ? `${n("supported")} supported` : "",
    n("refuted") ? `${n("refuted")} refuted` : "",
    n("stale") ? `${n("stale")} stale` : "",
    n("unknown") ? `${n("unknown")} unknown` : "",
    looks ? `${looks} ${looks === 1 ? "needs" : "need"} a look` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

/** The card as a ref. Pure. */
export function claimsArtifact(args: {
  jobId: string;
  title: string;
  /** The job's workspace, by slug. */
  workspace: string;
  /** The swarm the job runs on. */
  swarmId: string;
  /** The turn the ledger is of — a strut run id. */
  turn: string;
  turns?: Record<string, number>;
  claims: JobClaim[];
}): ArtifactRef {
  const { jobId, title, workspace, swarmId, turn, turns, claims } = args;
  return {
    id: claimsArtifactId(jobId),
    kind: "claims",
    title,
    summary: summarizeClaims(claims),
    source: { type: "inline", content: { workspace, swarmId, job: jobId, turn, ...(turns && Object.keys(turns).length ? { turns } : {}), claims } },
  };
}

/** The job's turns hive launched, numbered from 1 — for "verified on turn N" — restricted to `ids`. */
export async function jobTurnNumbers(jobId: string, ids: Iterable<string>): Promise<Record<string, number>> {
  const want = new Set(ids);
  const rows = await db.strutRun.findMany({
    where: { jobId, kind: JOB_TURN_KIND, strutRunId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { strutRunId: true },
  });
  const out: Record<string, number> = {};
  rows.forEach((r, i) => {
    if (r.strutRunId && want.has(r.strutRunId)) out[r.strutRunId] = i + 1;
  });
  return out;
}

const turnIdsOf = (claims: JobClaim[], turn: string): string[] => [turn, ...claims.flatMap((c) => (c.latest?.about ? [c.latest.about] : []))];

/**
 * The card for a turn that just settled, read off the ROW's swarm: null when
 * the swarm has no claims layer or the job claims nothing yet, a workspace
 * that is gone, or a read that failed or ran out of time. Never throws.
 */
export async function readTurnClaimsCard(row: StrutRunRow, jobId: string, timeoutMs: number): Promise<ArtifactRef | null> {
  try {
    if (!row.strutRunId) return null;
    const lab = await labForRow(row);
    if (!lab) return null;
    const claims = await readJobClaims(lab, jobId, timeoutMs);
    if (!claims || claims.length === 0) return null;
    const workspace = await db.workspace.findUnique({ where: { id: row.workspaceId }, select: { slug: true } });
    if (!workspace) return null;
    const turns = await jobTurnNumbers(jobId, turnIdsOf(claims, row.strutRunId));
    return claimsArtifact({ jobId, title: jobTitleOf(row), workspace: workspace.slug, swarmId: row.swarmId, turn: row.strutRunId, turns, claims });
  } catch (err) {
    logger.warn("Job turn claims card unavailable — delivering without it", LOG_TAG, {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── The card's actions ───────────────────────────────────────────────────

/** The job's first turn — its owner, workspace, swarm and conversation (`firstJobTurn`). */
export type JobClaimsOwner = Pick<StrutRunRow, "id" | "workspaceId" | "swarmId" | "userId" | "conversationId" | "input">;

/** What went wrong, as the route answers it. */
export class JobClaimsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "JobClaimsError";
  }
}

/** The job's swarm, called as its owner: the swarm key, and the owner as `x-strut-actor` — whose delegation pays for a paid check. */
async function ownerLab(first: JobClaimsOwner): Promise<{ lab: Lab; headers: Record<string, string> }> {
  const lab = await labForRow(first);
  if (!lab) throw new JobClaimsError(502, "This job's swarm cannot be reached (its credentials are unavailable).");
  const actor = await resolveStrutActor(first.userId);
  return { lab, headers: { "Content-Type": "application/json", "x-api-token": lab.swarmApiKey, [STRUT_ACTOR_HEADER]: actor } };
}

/** A lab write; its error message when it is refused. */
async function labWrite(lab: Lab, headers: Record<string, string>, path: string, body: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${lab.labBase}${path}`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new JobClaimsError(502, `The job's swarm did not answer: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok && !("error" in parsed)) return parsed;
  const error = typeof parsed.error === "string" ? parsed.error : `HTTP ${res.status}`;
  if (res.status === 409 && /claims/i.test(error)) throw new JobClaimsError(409, "This job's swarm has no claims layer.");
  if (res.status === 404) throw new JobClaimsError(404, "The job is not on its swarm.");
  throw new JobClaimsError(res.status >= 500 ? 502 : 400, error);
}

/** The job's newest turn hive launched — what a version made without a Verify is of. */
async function newestTurn(jobId: string): Promise<string | null> {
  const row = await db.strutRun.findFirst({
    where: { jobId, kind: JOB_TURN_KIND, strutRunId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { strutRunId: true },
  });
  return row?.strutRunId ?? null;
}

/** Re-read the ledger and publish it as the card's next version; the card comes back. */
async function publishVersion(first: JobClaimsOwner, jobId: string, lab: Lab, args: { turn: string | null; content: string; claims?: JobClaim[] }): Promise<ArtifactRef | null> {
  const claims = args.claims ?? (await readJobClaims(lab, jobId));
  const turn = args.turn ?? (await newestTurn(jobId));
  if (!claims || !turn) return null;
  const workspace = await db.workspace.findUnique({ where: { id: first.workspaceId }, select: { slug: true } });
  if (!workspace) return null;
  const title = jobTitleOf(first);
  const card = claimsArtifact({ jobId, title, workspace: workspace.slug, swarmId: first.swarmId, turn, turns: await jobTurnNumbers(jobId, turnIdsOf(claims, turn)), claims });
  if (first.conversationId) {
    const { appendJobClaimsRow } = await import("@/services/strut-runs/job-turn");
    await appendJobClaimsRow(first, { content: args.content, source: { kind: "job_claims", jobId, title }, artifacts: [card] });
  }
  return card;
}

const turnLabel = (turns: Record<string, number> | undefined, turn: string): string => (turns?.[turn] ? `turn ${turns[turn]}` : "the newest turn");

/**
 * Verify: every check on every claim against the job's newest turn, now —
 * the person's door two (strut `POST /jobs/:id/verify`) — then the card's
 * next version with each check's outcome on this pass.
 */
export async function verifyJobClaims(first: JobClaimsOwner, jobId: string): Promise<{ card: ArtifactRef | null; summary: string }> {
  const { lab, headers } = await ownerLab(first);
  const result = await labWrite(lab, headers, `/jobs/${encodeURIComponent(jobId)}/verify`, {}, VERIFY_TIMEOUT_MS);
  const turn = typeof result.runId === "string" && result.runId ? result.runId : null;
  if (!turn) throw new JobClaimsError(409, "The job has no turn to verify yet.");
  // The pass's own ledger carries each check's outcome on it; the listing adds the speaker and the slots.
  const listing = await fetch(`${lab.labBase}/claims?${new URLSearchParams({ kind: "job", name: jobId })}`, {
    headers: { "x-api-token": lab.swarmApiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const claims = mergeClaims(result.claims, isRecord(listing) ? listing.claims : undefined);
  const summary = summarizeClaims(claims);
  const turns = await jobTurnNumbers(jobId, [turn]);
  const card = await publishVersion(first, jobId, lab, { turn, claims, content: `Verified the job's claims on ${turnLabel(turns, turn)}: ${summary}.` });
  return { card, summary };
}

export interface ClaimAnswer {
  claimId: string;
  /** The open slot (its evidence id) the answer fills. */
  slot: string;
  /** The turn the slot is on — a strut run id. */
  runId: string;
  supports: boolean;
  note?: string;
}

/**
 * A person's answer to an open check: Accept or Reject fills the slot
 * (a write, no turn). A rejection WITH a note goes on to the job as its
 * next turn — `[claim-event] refuted "<claim>": <note>` — so the agent
 * starts from a ledger that already says refuted and a line that says why.
 * `launch` is the caller's: the route owns who may start a turn.
 */
export async function answerJobClaim(
  first: JobClaimsOwner,
  jobId: string,
  answer: ClaimAnswer,
  launch: (prompt: string) => Promise<{ runId?: string; busy?: string; error?: string }>,
): Promise<{ card: ArtifactRef | null; turn?: { runId?: string; busy?: string; error?: string } }> {
  const { lab, headers } = await ownerLab(first);
  const note = answer.note?.trim() ?? "";
  const content = note || (answer.supports ? "Looked: it holds." : "Looked: it does not hold.");
  await labWrite(lab, headers, `/claims/${encodeURIComponent(answer.claimId)}/evidence`, { job: jobId, runId: answer.runId, supports: answer.supports, content, slot: answer.slot }, WRITE_TIMEOUT_MS);
  const claims = await readJobClaims(lab, jobId);
  if (!answer.supports && note) {
    const text = claims?.find((c) => c.id === answer.claimId)?.text ?? "a claim";
    return { card: null, turn: await launch(formatClaimEvent(text, note)) };
  }
  const verdict = answer.supports ? "supports" : "refutes";
  const text = claims?.find((c) => c.id === answer.claimId)?.text;
  const card = await publishVersion(first, jobId, lab, { turn: null, ...(claims ? { claims } : {}), content: `Answered${text ? ` "${text}"` : " a check"}: ${verdict}.` });
  return { card };
}

/** A person's own acceptance criterion: a claim about the job with an external check — the agent may add its instrument to it. */
export async function addJobClaim(first: JobClaimsOwner, jobId: string, claim: { text: string; description: string }): Promise<{ card: ArtifactRef | null }> {
  const { lab, headers } = await ownerLab(first);
  await labWrite(lab, headers, "/claims", { subjects: [{ kind: "job", name: jobId }], text: claim.text, checks: [{ description: claim.description }] }, WRITE_TIMEOUT_MS);
  const card = await publishVersion(first, jobId, lab, { turn: null, content: `Added a claim: "${claim.text}".` });
  return { card };
}
