/**
 * POST /api/orgs/[githubLogin]/strut/pull-request/merge
 * Body: `{ repo: "owner/name", number, mergeMethod?: "merge"|"squash"|"rebase", conversationId? }`
 *
 * Merge a pull request shown in the org chat. The chat's PR artifacts are
 * inline refs inside `SharedConversation.messages`, not `Artifact` rows, so
 * this is the org-scoped counterpart of the task page's `/api/github/pr/merge`.
 *
 * Auth: a session (middleware) and membership of `githubLogin`
 * (`resolveAuthorizedOrgId`, 404 otherwise). The merge is made with the
 * VIEWER's GitHub App token for the repo's owner, so GitHub decides whether
 * they may merge. No token for that owner is a 403.
 *
 * Optional `conversationId`: after a merge (or an already merged PR) the
 * state is written back onto that chat's stored PR refs
 * (`reconcileChatPullRequestState`). Best-effort: a failure is logged and
 * never changes the response.
 */

import { Octokit } from "@octokit/rest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { getUserAppTokens } from "@/lib/githubApp";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { reconcileChatPullRequestState } from "@/services/orgs/reconcile-chat-pull-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `owner/name` in the characters GitHub allows in each. */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

type MergeMethod = "merge" | "squash" | "rebase";

const NOT_ALLOWED_RE = /(merge commits|squash merges|rebase merges|merge method).*not allowed|not allowed.*merge/i;

function githubMessage(err: unknown): string | undefined {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message;
}

/** Another method the repo allows (prefer squash, then rebase, then merge). */
async function pickAllowedMethod(octokit: Octokit, owner: string, repo: string, tried: MergeMethod) {
  const { data } = await octokit.repos.get({ owner, repo });
  const allowed: [MergeMethod, boolean | undefined][] = [
    ["squash", data.allow_squash_merge],
    ["rebase", data.allow_rebase_merge],
    ["merge", data.allow_merge_commit],
  ];
  return allowed.find(([m, ok]) => ok && m !== tried)?.[0];
}

const bodySchema = z.object({
  repo: z.string().regex(REPO_RE, "repo must be owner/name"),
  number: z.number().int().positive(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).default("squash"),
  conversationId: z.string().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;

  const { githubLogin } = await params;

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }
  const { repo, number, mergeMethod, conversationId } = parsed.data;

  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The viewer's own token for the repo's owner: GitHub decides whether they may merge.
  const [owner, name] = repo.split("/");
  const tokens = await getUserAppTokens(userId, owner);
  if (!tokens?.accessToken) {
    return NextResponse.json({ error: `GitHub is not connected for ${owner}` }, { status: 403 });
  }
  const octokit = new Octokit({ auth: tokens.accessToken });

  const reconcile = async () => {
    if (!conversationId) return;
    try {
      await reconcileChatPullRequestState({ conversationId, orgId, userId, repo, number, state: "merged" });
    } catch (err) {
      console.warn("[strut-pull-request-merge] reconcile failed", {
        conversationId,
        repo,
        number,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  try {
    const { data: pull } = await octokit.pulls.get({ owner, repo: name, pull_number: number });

    if (pull.merged) {
      await reconcile();
      return NextResponse.json({ success: true, merged: true, alreadyMerged: true });
    }
    if (pull.state === "closed") {
      return NextResponse.json({ error: "Pull request is closed" }, { status: 409 });
    }
    if (pull.draft) {
      return NextResponse.json({ error: "Pull request is a draft" }, { status: 409 });
    }
    if (pull.mergeable === false) {
      return NextResponse.json({ error: "Pull request has merge conflicts" }, { status: 409 });
    }

    const doMerge = (method: MergeMethod) =>
      octokit.pulls.merge({
        owner,
        repo: name,
        pull_number: number,
        merge_method: method,
        sha: pull.head.sha,
      });
    let merge;
    try {
      ({ data: merge } = await doMerge(mergeMethod));
    } catch (err) {
      const msg = githubMessage(err);
      if ((err as { status?: number }).status !== 405 || !msg || !NOT_ALLOWED_RE.test(msg)) throw err;
      const alt = await pickAllowedMethod(octokit, owner, name, mergeMethod);
      if (!alt) throw err;
      ({ data: merge } = await doMerge(alt));
    }

    await reconcile();
    return NextResponse.json({ success: true, merged: true, sha: merge.sha });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 405) {
      return NextResponse.json(
        {
          error:
            githubMessage(err) ??
            (err as Error).message ??
            "Pull request is not mergeable (checks failing, conflicts, or branch protection)",
        },
        { status: 409 },
      );
    }
    if (status === 409) {
      return NextResponse.json({ error: githubMessage(err) ?? "Head branch was modified — refresh and try again" }, { status: 409 });
    }
    if (status === 403 || status === 404) {
      return NextResponse.json({ error: "No permission to merge this pull request" }, { status: 403 });
    }
    console.warn("[strut-pull-request-merge] GitHub API error", {
      repo,
      number,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "GitHub API error" }, { status: 502 });
  }
}
