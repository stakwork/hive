/**
 * GET /api/orgs/[githubLogin]/strut/pull-request?repo=owner/name&number=N
 *
 * The live state of a pull request a job reported — state, checks, branches,
 * author — read from GitHub. The org-canvas PR card polls this while it is
 * on screen (`useArtifactContent`), so a card stored as "open" follows the
 * PR to merged or closed.
 *
 * Auth: a session (middleware), membership of `githubLogin`
 * (`resolveAuthorizedOrgId`, 404 otherwise), and then GitHub's own answer.
 * The read is made with the VIEWER's GitHub App token for the repo's owner,
 * so they see exactly what github.com would show them: nothing of anyone
 * else's is borrowed, and so nothing here has to prove which job the PR
 * belongs to — which is what lets a PR ref stored before this route exist
 * be read like any other. No token for that owner is a 403; a PR GitHub
 * will not show them is a 404, as GitHub answers.
 *
 * Cache: `private, max-age=15`.
 */

import { Octokit } from "@octokit/rest";
import { NextRequest, NextResponse } from "next/server";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { getPullRequestStatus } from "@/lib/github/pullRequestStatus";
import { getUserAppTokens } from "@/lib/githubApp";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `owner/name` in the characters GitHub allows in each. */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;

  const { githubLogin } = await params;
  const sp = request.nextUrl.searchParams;
  const repo = sp.get("repo") ?? "";
  const numberStr = sp.get("number") ?? "";

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ error: "repo must be owner/name" }, { status: 400 });
  }
  const number = parseInt(numberStr, 10);
  if (!Number.isFinite(number) || number <= 0 || String(number) !== numberStr) {
    return NextResponse.json({ error: "number must be a positive integer" }, { status: 400 });
  }

  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The viewer's own token for the repo's owner: GitHub decides what they may see.
  const [owner, name] = repo.split("/");
  const tokens = await getUserAppTokens(userId, owner);
  if (!tokens?.accessToken) {
    return NextResponse.json({ error: `GitHub is not connected for ${owner}` }, { status: 403 });
  }
  const octokit = new Octokit({ auth: tokens.accessToken });

  let status;
  try {
    status = await getPullRequestStatus(octokit, { owner, repo: name, number });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/404|not found/i.test(msg)) {
      return NextResponse.json({ error: "PR not found" }, { status: 404 });
    }
    console.warn("[strut-pull-request] GitHub API error", { repo, number, error: msg });
    return NextResponse.json({ error: "GitHub API error" }, { status: 502 });
  }

  return NextResponse.json(status, { headers: { "Cache-Control": "private, max-age=15" } });
}
