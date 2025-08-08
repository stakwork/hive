import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { triggerAsyncSync } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import crypto from "node:crypto";

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function normalizeRepoUrl(url: string): string {
  return url.replace(/\.git$/i, "");
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-hub-signature-256");
    const event = request.headers.get("x-github-event");
    const delivery = request.headers.get("x-github-delivery");

    if (!signature || !event) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const rawBody = await request.text();
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const repoHtmlUrl: string | undefined = payload?.repository?.html_url;
    const fullName: string | undefined = payload?.repository?.full_name;
    const candidateUrl =
      repoHtmlUrl || (fullName ? `https://github.com/${fullName}` : undefined);
    if (!candidateUrl) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const normalizedUrl = normalizeRepoUrl(candidateUrl);

    const repository = await db.repository.findFirst({
      where: {
        OR: [
          { repositoryUrl: normalizedUrl },
          { repositoryUrl: `${normalizedUrl}.git` },
        ],
      },
      select: {
        id: true,
        repositoryUrl: true,
        branch: true,
        workspaceId: true,
        githubWebhookSecret: true,
      },
    });

    if (!repository || !repository.githubWebhookSecret) {
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const expected =
      "sha256=" +
      crypto
        .createHmac("sha256", repository.githubWebhookSecret)
        .update(rawBody)
        .digest("hex");

    if (!timingSafeEqual(expected, signature)) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const repoDefaultBranch: string | undefined =
      payload?.repository?.default_branch;
    const allowedBranches = new Set<string>(
      [repository.branch, repoDefaultBranch, "main", "master"].filter(
        Boolean,
      ) as string[],
    );

    if (event === "push") {
      const ref: string | undefined = payload?.ref;
      if (!ref) {
        return NextResponse.json({ success: false }, { status: 400 });
      }
      const pushedBranch = ref.split("/").pop();
      if (!pushedBranch) {
        return NextResponse.json({ success: false }, { status: 400 });
      }
      if (!allowedBranches.has(pushedBranch)) {
        return NextResponse.json({ success: true }, { status: 202 });
      }
    } else if (event === "pull_request") {
      const action: string | undefined = payload?.action;
      const merged: boolean | undefined = payload?.pull_request?.merged;
      const baseRef: string | undefined = payload?.pull_request?.base?.ref;
      if (
        !(
          action === "closed" &&
          merged &&
          baseRef &&
          allowedBranches.has(baseRef)
        )
      ) {
        return NextResponse.json({ success: true }, { status: 202 });
      }
    } else {
      return NextResponse.json({ success: true }, { status: 202 });
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: repository.workspaceId },
    });
    if (!swarm || !swarm.name || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const workspace = await db.workspace.findUnique({
      where: { id: repository.workspaceId },
      select: { ownerId: true },
    });
    const ownerId = workspace?.ownerId;

    let username: string | undefined;
    let pat: string | undefined;
    if (ownerId) {
      const creds = await getGithubUsernameAndPAT(ownerId);
      if (creds) {
        username = creds.username;
        pat = creds.pat;
      }
    }

    const apiResult = await triggerAsyncSync(
      swarm.name,
      swarm.swarmApiKey,
      repository.repositoryUrl,
      username && pat ? { username, pat } : undefined,
    );

    return NextResponse.json(
      { success: apiResult.ok, delivery },
      { status: 202 },
    );
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
