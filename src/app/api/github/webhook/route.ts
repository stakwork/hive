import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { triggerAsyncSync, AsyncSyncResult } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { timingSafeEqual, computeHmacSha256Hex } from "@/lib/encryption";
import { RepositoryStatus } from "@prisma/client";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";

//
export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-hub-signature-256");
    const event = request.headers.get("x-github-event");
    const delivery = request.headers.get("x-github-delivery");

    console.log("[GithubWebhook] Received", {
      event,
      delivery,
      hasSignature: !!signature,
    });

    if (!signature || !event) {
      console.error("[GithubWebhook] Missing signature or event", { hasSignature: !!signature, event });
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
    const candidateUrl = repoHtmlUrl || (fullName ? `https://github.com/${fullName}` : undefined);
    if (!candidateUrl) {
      console.error("[GithubWebhook] Missing candidate url", { delivery });
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const webhookId = request.headers.get("x-github-hook-id");
    if (!webhookId) {
      console.error("[GithubWebhook] Missing webhook ID", { delivery, candidateUrl });
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
        workspace: {
          select: {
            swarm: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (!repository || !repository.githubWebhookSecret) {
      console.error("[GithubWebhook] Repository not found or missing secret", {
        delivery,
        webhookId,
        candidateUrl,
      });
      return NextResponse.json({ success: false }, { status: 404 });
    }

    console.log("[GithubWebhook] Repository found", {
      delivery,
      repositoryUrl: repository.repositoryUrl,
      workspaceId: repository.workspaceId,
      branch: repository.branch,
    });

    const enc = EncryptionService.getInstance();
    const secret = enc.decryptField("githubWebhookSecret", repository.githubWebhookSecret);

    const expectedDigest = computeHmacSha256Hex(secret, rawBody);
    const expected = `sha256=${expectedDigest}`;

    if (!timingSafeEqual(expected, signature)) {
      console.error("[GithubWebhook] Signature verification failed", {
        delivery,
        repositoryUrl: repository.repositoryUrl,
        workspaceId: repository.workspaceId,
      });
      return NextResponse.json({ success: false }, { status: 401 });
    }

    console.log("[GithubWebhook] Signature verified", {
      delivery,
      workspaceId: repository.workspaceId,
    });

    const repoDefaultBranch: string | undefined = payload?.repository?.default_branch;
    const allowedBranches = new Set<string>(
      [repository.branch, repoDefaultBranch, "main", "master"].filter(Boolean) as string[],
    );

    if (event === "push") {
      const ref: string | undefined = payload?.ref;
      if (!ref) {
        console.error("[GithubWebhook] Missing ref in push event", {
          delivery,
          workspaceId: repository.workspaceId,
        });
        return NextResponse.json({ success: false }, { status: 400 });
      }
      const pushedBranch = ref.split("/").pop();
      if (!pushedBranch) {
        console.error("[GithubWebhook] Missing pushed branch", {
          delivery,
          workspaceId: repository.workspaceId,
          ref,
        });
        return NextResponse.json({ success: false }, { status: 400 });
      }
      if (!allowedBranches.has(pushedBranch)) {
        console.log("[GithubWebhook] Branch not in allowed list, skipping", {
          delivery,
          workspaceId: repository.workspaceId,
          pushedBranch,
          allowedBranches: Array.from(allowedBranches),
        });
        return NextResponse.json({ success: true }, { status: 202 });
      }
      console.log("[GithubWebhook] Branch validated", {
        delivery,
        workspaceId: repository.workspaceId,
        pushedBranch,
      });
    } else {
      console.log("[GithubWebhook] Event type not handled, skipping", {
        delivery,
        event,
        workspaceId: repository.workspaceId,
      });
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
      console.error("[GithubWebhook] Swarm not found or misconfigured", {
        delivery,
        workspaceId: repository.workspaceId,
        hasSwarm: !!swarm,
        hasName: !!swarm?.name,
        hasApiKey: !!swarm?.swarmApiKey,
      });
      return NextResponse.json({ success: false }, { status: 400 });
    }

    console.log("[GithubWebhook] Swarm found", {
      delivery,
      workspaceId: repository.workspaceId,
      swarmId: swarm.id,
      swarmName: swarm.name,
    });

    const workspace = await db.workspace.findUnique({
      where: { id: repository.workspaceId },
      select: { ownerId: true },
    });
    const ownerId = workspace?.ownerId;

    let username: string | undefined;
    let pat: string | undefined;
    if (ownerId) {
      const workspaceData = await db.workspace.findUnique({
        where: { id: repository.workspaceId },
        select: { slug: true },
      });

      if (workspaceData) {
        const creds = await getGithubUsernameAndPAT(ownerId, workspaceData.slug);
        if (creds) {
          username = creds.username;
          pat = creds.token;
        }
      }
    }

    console.log("[GithubWebhook] GitHub credentials", {
      delivery,
      workspaceId: repository.workspaceId,
      hasCredentials: !!(username && pat),
    });

    // Decrypt the swarm API key
    let decryptedSwarmApiKey: string;
    try {
      const parsed = typeof swarm.swarmApiKey === "string" ? JSON.parse(swarm.swarmApiKey) : swarm.swarmApiKey;
      decryptedSwarmApiKey = enc.decryptField("swarmApiKey", parsed);
    } catch (error) {
      console.error("Failed to decrypt swarmApiKey:", error);
      decryptedSwarmApiKey = swarm.swarmApiKey as string;
    }

    const swarmHost = swarm.swarmUrl ? new URL(swarm.swarmUrl).host : `${swarm.name}.sphinx.chat`;
    try {
      await db.repository.update({
        where: { id: repository.id },
        data: { status: RepositoryStatus.PENDING },
      });
      console.log("[GithubWebhook] Repository status → PENDING", {
        delivery,
        workspaceId: repository.workspaceId,
        repositoryUrl: repository.repositoryUrl,
      });
    } catch (err) {
      console.error("[GithubWebhook] Failed to set repository to PENDING", {
        delivery,
        workspaceId: repository.workspaceId,
        error: err,
      });
    }

    const callbackUrl = getStakgraphWebhookCallbackUrl(request);

    console.log("[GithubWebhook] Triggering async sync", {
      delivery,
      workspaceId: repository.workspaceId,
      swarmId: swarm.id,
      swarmHost,
      repositoryUrl: repository.repositoryUrl,
      callbackUrl,
      hasGithubAuth: !!(username && pat),
    });

    const apiResult: AsyncSyncResult = await triggerAsyncSync(
      swarmHost,
      decryptedSwarmApiKey,
      repository.repositoryUrl,
      username && pat ? { username, pat } : undefined,
      callbackUrl,
    );

    console.log("[GithubWebhook] Async sync response", {
      delivery,
      workspaceId: repository.workspaceId,
      swarmId: swarm.id,
      ok: apiResult.ok,
      status: apiResult.status,
      hasRequestId: !!apiResult.data?.request_id,
    });

    try {
      const reqId = apiResult.data?.request_id;
      if (reqId) {
        await db.swarm.update({
          where: { id: swarm.id },
          data: { ingestRefId: reqId },
        });
        console.log("[GithubWebhook] Saved ingest reference", {
          delivery,
          requestId: reqId,
          workspaceId: repository.workspaceId,
          swarmId: swarm.id,
        });
      } else {
        console.error("[GithubWebhook] No request_id in response", {
          delivery,
          workspaceId: repository.workspaceId,
          swarmId: swarm.id,
        });
      }
    } catch (e) {
      console.error("[GithubWebhook] Failed to persist ingestRefId", {
        delivery,
        workspaceId: repository.workspaceId,
        swarmId: swarm.id,
        error: e,
      });
    }

    return NextResponse.json({ success: apiResult.ok, delivery }, { status: 202 });
  } catch (error) {
    console.error("[GithubWebhook] Unhandled error", { error });
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
