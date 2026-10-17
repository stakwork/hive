/**
 * /api/orgs/[githubLogin]/strut/jobs/[jobId]/captcha
 *
 * POST — a person's answer to a captcha a job posted (artifact kind
 * `captcha`): taps on the image, text, or a skip. It becomes the job's next
 * turn, the same launch the `events` route makes — a line
 * `[captcha-answer] <JSON>` (`lib/strut-jobs.ts`) — under the same rule: the
 * job must be the answerer's (its first row's `userId`), 403 for anyone else.
 *
 * Body: `{ round, site, taps? | text? | skip? }`, exactly one of the three.
 * The text is passed on exactly as typed. A job with a turn in flight answers
 * 409 `busy`; 202 `{ runId }` once strut has the turn.
 *
 * GET — whether the caller is the job's owner, for the viewer to show or hide
 * its controls.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { formatCaptchaAnswer, jobTitleOf } from "@/lib/strut-jobs";
import { getBaseUrl } from "@/lib/utils";
import { BUSY_NOTE, firstJobTurn, jobHasLiveTurn, launchJobTurn } from "@/services/strut-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fraction = z.number().min(0).max(1);

const bodySchema = z
  .object({
    round: z.number().int().min(1),
    site: z.string().min(1).max(300),
    taps: z.array(z.object({ nx: fraction, ny: fraction })).max(40).optional(),
    text: z.string().max(200).optional(),
    skip: z.boolean().optional(),
  })
  .refine((b) => [b.taps !== undefined, b.text !== undefined, b.skip !== undefined].filter(Boolean).length === 1, "exactly one of taps, text, skip");

type Params = { params: Promise<{ githubLogin: string; jobId: string }> };

/** The job's first row, when its workspace is in this org, or null. */
async function jobInOrg(orgId: string, jobId: string) {
  const first = await firstJobTurn(jobId);
  const workspace = first
    ? await db.workspace.findFirst({
        where: { id: first.workspaceId, sourceControlOrgId: orgId, deleted: false },
        select: { id: true },
      })
    : null;
  return first && workspace ? first : null;
}

export async function GET(request: NextRequest, { params }: Params) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin, jobId } = await params;

  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const first = await jobInOrg(orgId, jobId);
  if (!first) return NextResponse.json({ error: "No such job" }, { status: 404 });

  return NextResponse.json({ owner: first.userId === userId });
}

export async function POST(request: NextRequest, { params }: Params) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin, jobId } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { round, site, taps | text | skip }: exactly one answer" }, { status: 400 });
  }
  const { round, site, taps, text, skip } = parsed.data;
  const mode = taps ? "taps" : text !== undefined ? "text" : "skip";
  // One line per answer; never the text.
  const log = (outcome: string) => console.log("[captcha-answer]", JSON.stringify({ jobId, round, mode, taps: taps?.length ?? 0, outcome }));

  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const first = await jobInOrg(orgId, jobId);
  if (!first) return NextResponse.json({ error: "No such job" }, { status: 404 });
  if (first.userId !== userId) {
    log("not_owner");
    return NextResponse.json({ error: "Only the person who started a job can continue it" }, { status: 403 });
  }
  if (!first.conversationId) {
    return NextResponse.json({ error: "This job has no conversation to reply into" }, { status: 409 });
  }

  if (await jobHasLiveTurn(jobId)) {
    log("busy");
    return NextResponse.json({ error: BUSY_NOTE, busy: true }, { status: 409 });
  }
  const prompt = formatCaptchaAnswer({ round, site, ...(taps ? { taps } : {}), ...(text !== undefined ? { text } : {}), ...(skip !== undefined ? { skip } : {}) });
  const result = await launchJobTurn(
    {
      userId,
      workspaceId: first.workspaceId,
      conversationId: first.conversationId,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
    },
    { jobId, title: jobTitleOf(first), prompt, started: false, event: true },
  );
  if (result.status === "busy") {
    log("busy");
    return NextResponse.json({ error: result.note, busy: true }, { status: 409 });
  }
  if (result.status === "error") {
    log("error");
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  log("sent");
  return NextResponse.json({ runId: result.runId }, { status: 202 });
}
