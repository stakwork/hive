import { NextRequest, NextResponse } from "next/server";
import { ArtifactType } from "@prisma/client";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { parseArtifactContent, type ArtifactContents } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { getUserAppTokens } from "@/lib/githubApp";
import { serviceConfigs } from "@/config/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ID_LENGTH = 200;
const PR_NUMBER = /\/pull\/(\d+)(?:[/?#]|$)/i;
const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  const artifactId = request.nextUrl.searchParams.get("id") ?? "";
  if (!artifactId || artifactId.length > MAX_ID_LENGTH) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const artifact = await db.artifact.findUnique({
    where: { id: artifactId },
    select: {
      id: true,
      type: true,
      content: true,
      message: {
        select: {
          task: {
            select: {
              id: true,
              deleted: true,
              branch: true,
              workspace: { select: { slug: true, deleted: true, sourceControlOrgId: true } },
            },
          },
        },
      },
    },
  });

  if (!artifact || artifact.type !== ArtifactType.PULL_REQUEST || !artifact.message?.task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const task = artifact.message.task;
  if (task.deleted || task.workspace.deleted || task.workspace.sourceControlOrgId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const access = await validateWorkspaceAccess(task.workspace.slug, userId);
  if (!access.canRead) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = parseArtifactContent("pull_request", artifact.content);
  if (!parsed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = await buildResponseContent(parsed, task.branch ?? undefined, userId);

  return NextResponse.json(payload, { status: 200, headers: { "cache-control": "private, no-store" } });
}

async function buildResponseContent(content: ArtifactContents["pull_request"], branch: string | undefined, userId: string) {
  const base = mapFromRow(content, branch);
  if (!content.progress?.lastCheckedAt && content.state !== "merged" && content.state !== "closed") {
    const fallback = await readGithubFallback(content, userId);
    if (fallback) return fallback;
  }
  return base;
}

function mapFromRow(content: ArtifactContents["pull_request"], branch: string | undefined) {
  const numberMatch = PR_NUMBER.exec(content.url);
  const number = numberMatch ? Number(numberMatch[1]) : content.number;
  const state = content.state;
  const status = state === "merged" ? "DONE" : state === "closed" ? "CANCELLED" : "IN_PROGRESS";
  const checks = content.progress?.failedChecks?.map((name) => ({ name, status: "failure" as const }));
  return {
    status,
    content: {
      url: content.url,
      repo: content.repo,
      number,
      state,
      author: content.author,
      headBranch: branch ?? content.headBranch,
      baseBranch: content.baseBranch,
      body: content.body,
      checks,
    },
  };
}

async function readGithubFallback(content: ArtifactContents["pull_request"], userId: string) {
  const [owner, repo] = content.repo.split("/");
  if (!owner || !repo) return null;
  const match = PR_NUMBER.exec(content.url);
  const number = match ? match[1] : `${content.number}`;
  const tokens = await getUserAppTokens(userId, owner);
  if (!tokens?.accessToken) return null;
  try {
    const res = await fetch(`${serviceConfigs.github.baseURL}/repos/${owner}/${repo}/pulls/${number}`, {
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${tokens.accessToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const pr = await res.json();
    const state = pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open";
    const status = state === "merged" ? "DONE" : state === "closed" ? "CANCELLED" : "IN_PROGRESS";
    return {
      status,
      content: {
        url: pr.html_url,
        repo: content.repo,
        number: pr.number,
        state,
        author: pr.user?.login,
        headBranch: pr.head?.ref,
        baseBranch: pr.base?.ref,
        body: pr.body ?? undefined,
      },
    };
  } catch {
    return null;
  }
}
