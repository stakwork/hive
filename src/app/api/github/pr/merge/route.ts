import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { validateWorkspaceAccess } from "@/services/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  artifactId: z.string().min(1),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).default("squash"),
});

function parsePrUrl(url: unknown): { owner: string; repo: string; number: number } | null {
  if (typeof url !== "string") return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const artifact = await db.artifact.findFirst({
    where: { id: body.artifactId, type: "PULL_REQUEST" },
    include: {
      message: {
        include: { task: { select: { workspaceId: true, workspace: { select: { slug: true } } } } },
      },
    },
  });
  const slug = artifact?.message?.task?.workspace?.slug;
  if (!artifact || !slug) {
    return NextResponse.json({ error: "Pull request artifact not found" }, { status: 404 });
  }

  const access = await validateWorkspaceAccess(slug, userId);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "Pull request artifact not found" }, { status: 404 });
  }
  if (!access.canWrite) {
    return NextResponse.json({ error: "You do not have permission to merge pull requests" }, { status: 403 });
  }

  const content = (artifact.content ?? {}) as Record<string, unknown>;
  const pr = parsePrUrl(content.url);
  if (!pr) {
    return NextResponse.json({ error: "Invalid pull request URL" }, { status: 400 });
  }

  const creds = await getGithubUsernameAndPAT(userId, slug);
  if (!creds?.token) {
    return NextResponse.json({ error: "GitHub authorization required" }, { status: 403 });
  }

  const markMerged = () =>
    db.artifact.update({
      where: { id: artifact.id },
      data: { content: { ...content, status: "DONE" } as Prisma.InputJsonValue },
    });

  const octokit = new Octokit({ auth: creds.token });
  const ref = { owner: pr.owner, repo: pr.repo, pull_number: pr.number };

  try {
    const { data: pull } = await octokit.pulls.get(ref);

    if (pull.merged) {
      await markMerged();
      return NextResponse.json({ success: true, merged: true, alreadyMerged: true });
    }
    if (pull.state === "closed") {
      return NextResponse.json({ error: "Pull request is closed" }, { status: 409 });
    }
    if (pull.draft) {
      return NextResponse.json({ error: "Pull request is a draft and cannot be merged" }, { status: 409 });
    }
    if (pull.mergeable === false) {
      return NextResponse.json(
        { error: "Pull request has conflicts and cannot be merged" },
        { status: 409 },
      );
    }

    const doMerge = (method: MergeMethod) =>
      octokit.pulls.merge({ ...ref, merge_method: method, sha: pull.head.sha });
    let result;
    try {
      ({ data: result } = await doMerge(body.mergeMethod));
    } catch (err) {
      const msg = githubMessage(err);
      if ((err as { status?: number }).status !== 405 || !msg || !NOT_ALLOWED_RE.test(msg)) throw err;
      const alt = await pickAllowedMethod(octokit, pr.owner, pr.repo, body.mergeMethod);
      if (!alt) throw err;
      ({ data: result } = await doMerge(alt));
    }
    await markMerged();
    return NextResponse.json({ success: true, merged: true, sha: result.sha });
  } catch (error) {
    const status = (error as { status?: number })?.status;
    console.error("[GithubPrMerge] merge failed", { artifactId: artifact.id, status });
    if (status === 405) {
      return NextResponse.json(
        {
          error:
            githubMessage(error) ??
            (error as Error).message ??
            "Pull request is not mergeable (checks failing, conflicts, or branch protection)",
        },
        { status: 409 },
      );
    }
    if (status === 409) {
      return NextResponse.json(
        { error: githubMessage(error) ?? "Pull request head branch was modified. Refresh and try again." },
        { status: 409 },
      );
    }
    if (status === 403 || status === 404) {
      return NextResponse.json({ error: "No permission to merge this pull request" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to merge pull request on GitHub" }, { status: 502 });
  }
}
