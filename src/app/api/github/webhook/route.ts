import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { triggerAsyncSync } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { timingSafeEqual, computeHmacSha256Hex } from "@/lib/encryption";

//
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

    const webhookId = request.headers.get("x-github-hook-id");
    if (!webhookId) {
      console.error("Missing webhook ID header");
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const repository = await db.repository.findFirst({
      where: { githubWebhookId: webhookId },
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

    const expectedDigest = computeHmacSha256Hex(secret, rawBody);
    const expected = `sha256=${expectedDigest}`;

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
        console.log("Missing ref");
        return NextResponse.json({ success: false }, { status: 400 });
      }
      const pushedBranch = ref.split("/").pop();
      if (!pushedBranch) {
        console.log("Missing pushed branch");
        return NextResponse.json({ success: false }, { status: 400 });
      }
      if (!allowedBranches.has(pushedBranch)) {
        console.log("Pushed branch ", pushedBranch, "not allowed");
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
        console.log("Pull request not allowed. action:", action);
        return NextResponse.json({ success: true }, { status: 202 });
      }
    } else {
      console.log("Event not allowed", event);
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

    // Decrypt the swarm API key
    let decryptedSwarmApiKey: string;
    try {
      const parsed =
        typeof swarm.swarmApiKey === "string"
          ? JSON.parse(swarm.swarmApiKey)
          : swarm.swarmApiKey;
      decryptedSwarmApiKey = enc.decryptField("swarmApiKey", parsed);
    } catch (error) {
      console.error("Failed to decrypt swarmApiKey:", error);
      decryptedSwarmApiKey = swarm.swarmApiKey as string;
    }

    const swarmHost = swarm.swarmUrl
      ? new URL(swarm.swarmUrl).host
      : `${swarm.name}.sphinx.chat`;
    console.log(
      "Trigger sync at:",
      swarmHost,
      decryptedSwarmApiKey.slice(0, 2) + "...",
    );
    const apiResult = await triggerAsyncSync(
      swarmHost,
      decryptedSwarmApiKey,
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
