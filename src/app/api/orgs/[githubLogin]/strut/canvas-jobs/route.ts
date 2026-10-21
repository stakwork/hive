/**
 * GET /api/orgs/[githubLogin]/strut/canvas-jobs?initiative=<ref_id>
 *
 * The strut jobs on one initiative's infinite-canvas cards, for any member
 * of the org (`useCanvasJobs`; `services/canvas-jobs.ts`):
 *
 *   { jobs: CanvasJob[], artifactsByRef: { [cardRefId]: ArtifactRef[] } }
 *
 * A job is on the card its turn was asked from (`StrutRun.input.focus`),
 * whoever started it; its artifacts are the refs its turns delivered to the
 * starter's chat, opened through the same reader route
 * (`strut/artifacts`), which admits any member who can read the swarm's
 * workspace. Only jobs in the org's workspaces the caller can read.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { logger } from "@/lib/logger";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { isRunGraphRefId } from "@/lib/strut-run-graph/hydrate";
import { listCanvasJobs } from "@/services/canvas-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  const initiative = request.nextUrl.searchParams.get("initiative") ?? "";
  if (!isRunGraphRefId(initiative)) {
    return NextResponse.json({ error: "initiative (a ref_id) is required" }, { status: 400 });
  }

  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    return NextResponse.json(await listCanvasJobs(orgId, userId, initiative));
  } catch (err) {
    logger.error("Canvas jobs read failed", "CANVAS_JOBS", {
      githubLogin,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not read the jobs" }, { status: 500 });
  }
}
