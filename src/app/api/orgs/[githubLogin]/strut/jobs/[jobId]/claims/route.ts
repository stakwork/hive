/**
 * POST /api/orgs/[githubLogin]/strut/jobs/[jobId]/claims
 *
 * The claims card's actions (strut `plans/job-claims.md` §7;
 * `services/strut-jobs/claims.ts`), on the job's own swarm, as the job's
 * owner, with no agent — each re-reads the job's ledger and publishes the
 * card's next version into the job's conversation:
 *
 *   { action: "verify" }
 *     every check on every claim against the newest turn, now;
 *   { action: "answer", claimId, slot, runId, supports, note? }
 *     a person's Accept / Reject on an open check (a write, no turn).
 *     A rejection WITH a note fills the slot, then goes to the job as its
 *     next turn — `[claim-event] refuted "<claim>": <note>` — through the
 *     same launch an artifact event takes (202 `{ runId }`); a job with a
 *     turn in flight answers 409 `busy` before anything is written;
 *   { action: "claim", text, description }
 *     the person's own acceptance criterion: a claim about the job with an
 *     external check, which the job's agent may hang its instrument on.
 *
 * A click where a `continue_job` would be, under the tool's rule: the job
 * must be the clicker's (its first row's `userId`), 403 for anyone else.
 * 200 `{ card, summary? }` — `card` the version just published.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { jobTitleOf } from "@/lib/strut-jobs";
import { getBaseUrl } from "@/lib/utils";
import { BUSY_NOTE, firstJobTurn, jobHasLiveTurn, launchJobTurn } from "@/services/strut-jobs";
import { JobClaimsError, addJobClaim, answerJobClaim, verifyJobClaims } from "@/services/strut-jobs/claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A Verify drives a browser per page claim. */
export const maxDuration = 300;

const id = z.string().trim().min(1).max(200);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify") }),
  z.object({
    action: z.literal("answer"),
    claimId: id,
    slot: id,
    runId: id,
    supports: z.boolean(),
    note: z.string().max(2_000).optional(),
  }),
  z.object({
    action: z.literal("claim"),
    text: z.string().trim().min(1).max(500),
    description: z.string().trim().min(1).max(2_000),
  }),
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ githubLogin: string; jobId: string }> }) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin, jobId } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected { action: "verify" }, { action: "answer", claimId, slot, runId, supports, note? } or { action: "claim", text, description }' },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The job, in this org — then the tool's rule: only the person who
  // started a job acts on it.
  const first = await firstJobTurn(jobId);
  const workspace = first
    ? await db.workspace.findFirst({ where: { id: first.workspaceId, sourceControlOrgId: orgId, deleted: false }, select: { id: true } })
    : null;
  if (!first || !workspace) return NextResponse.json({ error: "No such job" }, { status: 404 });
  if (first.userId !== userId) {
    return NextResponse.json({ error: "Only the person who started a job can act on its claims" }, { status: 403 });
  }

  try {
    switch (body.action) {
      case "verify":
        return NextResponse.json(await verifyJobClaims(first, jobId));
      case "claim":
        return NextResponse.json(await addJobClaim(first, jobId, { text: body.text, description: body.description }));
      case "answer": {
        const toTurn = !body.supports && !!body.note?.trim();
        if (toTurn) {
          if (!first.conversationId) return NextResponse.json({ error: "This job has no conversation to reply into" }, { status: 409 });
          if (await jobHasLiveTurn(jobId)) return NextResponse.json({ error: BUSY_NOTE, busy: true }, { status: 409 });
        }
        const conversationId = first.conversationId;
        const result = await answerJobClaim(first, jobId, body, async (prompt) => {
          if (!conversationId) return { error: "no conversation" };
          const launched = await launchJobTurn(
            { userId, workspaceId: first.workspaceId, conversationId, publicBaseUrl: getBaseUrl(request.headers.get("host")) },
            { jobId, title: jobTitleOf(first), prompt, started: false, event: true },
          );
          if (launched.status === "busy") return { busy: launched.note };
          if (launched.status === "error") return { error: launched.error };
          return { runId: launched.runId };
        });
        if (result.turn?.runId) return NextResponse.json({ runId: result.turn.runId }, { status: 202 });
        // The slot is filled either way; the turn could not start.
        if (result.turn?.busy) return NextResponse.json({ error: result.turn.busy, busy: true, recorded: true }, { status: 409 });
        if (result.turn?.error) return NextResponse.json({ error: result.turn.error, recorded: true }, { status: 502 });
        return NextResponse.json({ card: result.card });
      }
    }
  } catch (err) {
    if (err instanceof JobClaimsError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
