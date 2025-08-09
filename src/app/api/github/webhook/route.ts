import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
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
      console.error(`Missing signature or event: ${signature} ${event}`);
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const rawBody = await request.text();
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      console.error(`Error parsing payload: ${error}`);
      console.error(rawBody);
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const repoHtmlUrl: string | undefined = payload?.repository?.html_url;
    const fullName: string | undefined = payload?.repository?.full_name;
    const candidateUrl =
      repoHtmlUrl || (fullName ? `https://github.com/${fullName}` : undefined);
    if (!candidateUrl) {
      console.error("Missing candidate url in payload");
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
      console.error("Missing repository or githubWebhookSecret");
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const enc = EncryptionService.getInstance();
    const secret = enc.decryptField(
      "githubWebhookSecret",
      repository.githubWebhookSecret,
    );

    const expected =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    if (!timingSafeEqual(expected, signature)) {
      console.error("Signature mismatch");
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
        console.error("Missing ref");
        return NextResponse.json({ success: false }, { status: 400 });
      }
      const pushedBranch = ref.split("/").pop();
      if (!pushedBranch) {
        console.error("Missing pushed branch");
        return NextResponse.json({ success: false }, { status: 400 });
      }
      if (!allowedBranches.has(pushedBranch)) {
        console.error("Pushed branch not allowed");
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
        console.error("Pull request not allowed");
        return NextResponse.json({ success: true }, { status: 202 });
      }
    } else {
      console.error("Event not allowed", event);
      return NextResponse.json({ success: true }, { status: 202 });
    }

    // const mockSwarm = {
    //   name: "alpha-swarm",
    //   swarmApiKey: "sk_test_mock_123",
    //   workspaceId: "123",
    // };
    // const swarm = mockSwarm;
    const swarm = await db.swarm.findUnique({
      where: { workspaceId: repository.workspaceId },
    });
    if (!swarm || !swarm.name || !swarm.swarmApiKey) {
      console.error("Missing swarm or swarmApiKey");
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
  } catch (error) {
    console.error(`Error processing webhook: ${error}`);
    console.error(error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
