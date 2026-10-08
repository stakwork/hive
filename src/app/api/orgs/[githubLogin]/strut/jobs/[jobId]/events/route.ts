/**
 * POST /api/orgs/[githubLogin]/strut/jobs/[jobId]/events
 *
 * A card's action on an artifact a job reported — the pull-request panel's
 * Fix (strut `plans/job-artifact-events.md` §5): the viewer composes what
 * happened from the card's live state, and this route makes it the job's
 * next turn — the same `[artifact-event]` line the GitHub webhook sends,
 * through the same launch (`services/strut-jobs/artifact-events.ts`,
 * `services/strut-jobs.ts`). A click where a `continue_job` would be,
 * under the tool's rule: the job must be the clicker's (its first row's
 * `userId`), 403 for anyone else, so the turn runs as the owner, whose
 * GitHub token pushes and whose delegation pays.
 *
 * Body: `{ url, what, details? }` — the artifact's URL (one the job
 * reported, else 404), what happened (one line), the specifics (one per
 * line). A job with a turn in flight answers 409 `busy`: a button has
 * nowhere to queue from, and the note says to try again in a minute.
 * 202 `{ runId }` once strut has the turn.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { jobTitleOf } from "@/lib/strut-jobs";
import { getBaseUrl } from "@/lib/utils";
import { BUSY_NOTE, firstJobTurn, jobHasLiveTurn, launchJobTurn } from "@/services/strut-jobs";
import { composeJobArtifactEvent } from "@/services/strut-jobs/artifact-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[\r\n]/.test(s), "one line");

const bodySchema = z.object({
  url: z
    .string()
    .trim()
    .max(2_000)
    .refine((u) => /^https?:\/\/\S+$/i.test(u), "an http(s) URL"),
  what: oneLine(200),
  details: z.array(oneLine(500)).max(40).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ githubLogin: string; jobId: string }> }) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin, jobId } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { url, what, details? }: an http(s) url, one line of what happened, lines of detail" }, { status: 400 });
  }
  const { url, what, details } = parsed.data;

  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The job, in this org — then the tool's rule: only the person who
  // started a job can continue it.
  const first = await firstJobTurn(jobId);
  const workspace = first
    ? await db.workspace.findFirst({
        where: { id: first.workspaceId, sourceControlOrgId: orgId, deleted: false },
        select: { id: true },
      })
    : null;
  if (!first || !workspace) return NextResponse.json({ error: "No such job" }, { status: 404 });
  if (first.userId !== userId) {
    return NextResponse.json({ error: "Only the person who started a job can continue it" }, { status: 403 });
  }
  if (!first.conversationId) {
    return NextResponse.json({ error: "This job has no conversation to reply into" }, { status: 409 });
  }

  const prompt = await composeJobArtifactEvent(jobId, url, what, details);
  if (!prompt) return NextResponse.json({ error: "The job did not report that artifact" }, { status: 404 });

  if (await jobHasLiveTurn(jobId)) return NextResponse.json({ error: BUSY_NOTE, busy: true }, { status: 409 });
  const result = await launchJobTurn(
    {
      userId,
      workspaceId: first.workspaceId,
      conversationId: first.conversationId,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
    },
    { jobId, title: jobTitleOf(first), prompt, started: false, event: true },
  );
  if (result.status === "busy") return NextResponse.json({ error: result.note, busy: true }, { status: 409 });
  if (result.status === "error") return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ runId: result.runId }, { status: 202 });
}
