/**
 * GET /api/orgs/[githubLogin]/strut/pull-request
 *   ?swarmId=<Swarm.id>&jobId=<StrutRun.jobId>&repo=owner/name&number=N
 *
 * Returns live GitHub PR status (state, checks, branches, author) for a PR
 * that was opened by a Strut job turn. The org-canvas PR artifact card polls
 * this every 30 s to keep state current after merge/close/CI changes.
 *
 * Auth chain (mirrors sibling strut/artifacts/route.ts):
 *   1. Session auth (middleware default), then the org: caller must belong
 *      to `githubLogin` (`resolveAuthorizedOrgId`) — 404 otherwise.
 *   2. The swarm must belong to a workspace in THAT org the caller can
 *      read (`validateWorkspaceAccess canRead`). 403 otherwise.
 *   3. A `StrutRun` with that `jobId` on that `swarmId` must exist. 404 otherwise.
 *   4. `repo` must be `owner/name`; `number` must be a positive integer. 400 otherwise.
 *   5. SECURITY: the requested PR must have actually been reported by this
 *      job — `jobReportedPullRequest` scans the job's StrutRun outputs (capped
 *      at 50 rows). Returns 404 (not 403) if not found, to avoid leaking
 *      information. This prevents an org member from using the job owner's
 *      elevated GitHub token to read arbitrary private PRs.
 *
 * Token strategy: the job owner's GitHub token is preferred (see
 * `resolveJobOwnerOctokit`); the viewing user's token is the fallback;
 * if neither is available a 502 is returned.
 *
 * Cache: `private, max-age=15` — short-lived, user-specific.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { db } from "@/lib/db";
import { jobReportedPullRequest } from "@/lib/github/jobReportedPullRequest";
import { getPullRequestStatus } from "@/lib/github/pullRequestStatus";
import { resolveJobOwnerOctokit } from "@/lib/github/resolveJobOwnerOctokit";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;

  const { githubLogin } = await params;
  const sp = request.nextUrl.searchParams;
  const swarmId = sp.get("swarmId") ?? "";
  const jobId = sp.get("jobId") ?? "";
  const repo = sp.get("repo") ?? "";
  const numberStr = sp.get("number") ?? "";

  // ── Input validation ────────────────────────────────────────────────────
  if (!swarmId || swarmId.length > 200 || !jobId || jobId.length > 200) {
    return NextResponse.json({ error: "swarmId and jobId are required" }, { status: 400 });
  }
  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ error: "repo must be owner/name" }, { status: 400 });
  }
  const number = parseInt(numberStr, 10);
  if (!Number.isFinite(number) || number <= 0 || String(number) !== numberStr) {
    return NextResponse.json({ error: "number must be a positive integer" }, { status: 400 });
  }

  // ── Org membership ──────────────────────────────────────────────────────
  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── Swarm → workspace membership ────────────────────────────────────────
  const swarm = await db.swarm.findUnique({
    where: { id: swarmId },
    select: {
      workspace: { select: { id: true, slug: true, sourceControlOrgId: true, deleted: true } },
    },
  });
  if (!swarm || swarm.workspace.deleted || swarm.workspace.sourceControlOrgId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const access = await validateWorkspaceAccess(swarm.workspace.slug, userId);
  if (!access.canRead) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ── Job existence: a StrutRun with that jobId on that swarm ────────────
  const run = await db.strutRun.findFirst({
    where: { jobId, swarmId },
    select: { id: true },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── SECURITY: PR must have been reported by this job ───────────────────
  // Prevents an org member from using the job owner's elevated GitHub token
  // to read arbitrary PRs. Returns 404 — not 403 — to avoid leaking info.
  const reported = await jobReportedPullRequest(jobId, swarmId, repo, number);
  if (!reported) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── GitHub token for the job owner (or viewer fallback) ────────────────
  const [owner] = repo.split("/");
  const octokitResult = await resolveJobOwnerOctokit(jobId, swarmId, owner, userId);
  if (!octokitResult.ok) {
    return NextResponse.json({ error: "GitHub token unavailable" }, { status: 502 });
  }

  // ── Fetch live PR status ────────────────────────────────────────────────
  const [repoOwner, repoName] = repo.split("/");
  let status;
  try {
    status = await getPullRequestStatus(octokitResult.octokit, { owner: repoOwner, repo: repoName, number });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/404|not found/i.test(msg)) {
      return NextResponse.json({ error: "PR not found" }, { status: 404 });
    }
    console.warn("[strut-pull-request] GitHub API error", { repo, number, error: msg });
    return NextResponse.json({ error: "GitHub API error" }, { status: 502 });
  }

  return NextResponse.json(status, {
    headers: { "Cache-Control": "private, max-age=15" },
  });
}
