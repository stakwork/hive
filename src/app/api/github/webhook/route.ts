import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { triggerAsyncSync, AsyncSyncResult } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { timingSafeEqual, computeHmacSha256Hex } from "@/lib/encryption";
import { RepositoryStatus } from "@prisma/client";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { storePullRequest, type PullRequestPayload } from "@/lib/github/storePullRequest";
import { logger } from "@/lib/logger";

//
export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-hub-signature-256");
    const event = request.headers.get("x-github-event");
    const delivery = request.headers.get("x-github-delivery");

    logger.debug("[GithubWebhook] Received", "webhook/route", { {
      event,
      delivery,
      hasSignature: !!signature,
    } });

    if (!signature || !event) {
      logger.error("[GithubWebhook] Missing signature or event", "webhook/route", { { hasSignature: !!signature, event } });
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const rawBody = await request.text();
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      logger.error(`Error parsing payload: ${error}`);
      logger.error("Debug output", { rawBody });
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const repoHtmlUrl: string | undefined = payload?.repository?.html_url;
    const fullName: string | undefined = payload?.repository?.full_name;
    const candidateUrl = repoHtmlUrl || (fullName ? `https://github.com/${fullName}` : undefined);
    if (!candidateUrl) {
      logger.error("[GithubWebhook] Missing candidate url", "webhook/route", { { delivery } });
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const webhookId = request.headers.get("x-github-hook-id");
    if (!webhookId) {
      logger.error("[GithubWebhook] Missing webhook ID", "webhook/route", { { delivery, candidateUrl } });
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const repository = await db.repository.findFirst({
      where: {
        githubWebhookId: webhookId,
        workspace: {
          deleted: false,
          deletedAt: null,
        },
      },
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
      logger.error("[GithubWebhook] Repository not found or missing secret", "webhook/route", { {
        delivery,
        webhookId,
        candidateUrl,
      } });
      return NextResponse.json({ success: false }, { status: 404 });
    }

    logger.debug("[GithubWebhook] Repository found", "webhook/route", { {
      delivery,
      repositoryUrl: repository.repositoryUrl,
      workspaceId: repository.workspaceId,
      branch: repository.branch,
    } });

    const enc = EncryptionService.getInstance();
    const secret = enc.decryptField("githubWebhookSecret", repository.githubWebhookSecret);

    const expectedDigest = computeHmacSha256Hex(secret, rawBody);
    const expected = `sha256=${expectedDigest}`;

    if (!timingSafeEqual(expected, signature)) {
      logger.error("[GithubWebhook] Signature verification failed", "webhook/route", { {
        delivery,
        repositoryUrl: repository.repositoryUrl,
        workspaceId: repository.workspaceId,
      } });
      return NextResponse.json({ success: false }, { status: 401 });
    }

    logger.debug("[GithubWebhook] Signature verified", "webhook/route", { {
      delivery,
      workspaceId: repository.workspaceId,
    } });

    const repoDefaultBranch: string | undefined = payload?.repository?.default_branch;
    const allowedBranches = new Set<string>(
      [repository.branch, repoDefaultBranch, "main", "master"].filter(Boolean) as string[],
    );

    // Fetch GitHub credentials early for both push and PR events
    const workspace = await db.workspace.findUnique({
      where: { id: repository.workspaceId },
      select: { ownerId: true, slug: true },
    });

    let githubPat: string | undefined;
    if (workspace?.ownerId) {
      const creds = await getGithubUsernameAndPAT(workspace.ownerId, workspace.slug);
      if (creds) {
        githubPat = creds.token;
      }
    }

    logger.debug("[GithubWebhook] GitHub credentials", "webhook/route", { {
      delivery,
      workspaceId: repository.workspaceId,
      hasCredentials: !!githubPat,
    } });

    if (event === "push") {
      const ref: string | undefined = payload?.ref;
      if (!ref) {
        logger.error("[GithubWebhook] Missing ref in push event", "webhook/route", { {
          delivery,
          workspaceId: repository.workspaceId,
        } });
        return NextResponse.json({ success: false }, { status: 400 });
      }
      const pushedBranch = ref.split("/").pop();
      if (!pushedBranch) {
        logger.error("[GithubWebhook] Missing pushed branch", "webhook/route", { {
          delivery,
          workspaceId: repository.workspaceId,
          ref,
        } });
        return NextResponse.json({ success: false }, { status: 400 });
      }
      if (!allowedBranches.has(pushedBranch)) {
        logger.debug("[GithubWebhook] Branch not in allowed list, skipping", "webhook/route", { {
          delivery,
          workspaceId: repository.workspaceId,
          pushedBranch,
          allowedBranches: Array.from(allowedBranches }),
        });
        return NextResponse.json({ success: true }, { status: 202 });
      }
      logger.debug("[GithubWebhook] Branch validated", "webhook/route", { {
        delivery,
        workspaceId: repository.workspaceId,
        pushedBranch,
      } });
    } else if (event === "pull_request") {
      const action = payload?.action;
      const merged = payload?.pull_request?.merged;

      if (action === "closed" && merged === true) {
        logger.debug("[GithubWebhook] Processing merged PR", "webhook/route", { {
          delivery,
          workspaceId: repository.workspaceId,
          prNumber: payload.number,
        } });

        // Store PR data without failing the webhook if this fails
        try {
          await storePullRequest(
            payload as PullRequestPayload,
            repository.id,
            repository.workspaceId,
            githubPat,
          );
        } catch (error) {
          logger.error("[GithubWebhook] Failed to store PR, continuing", "webhook/route", { {
            delivery,
            workspaceId: repository.workspaceId,
            prNumber: payload.number,
            error,
          } });
        }
      } else {
        logger.debug("[GithubWebhook] PR action not handled, skipping", "webhook/route", { {
          delivery,
          workspaceId: repository.workspaceId,
          action,
          merged,
        } });
      }

      // For pull_request events, we don't trigger sync, so return here
      return NextResponse.json({ success: true }, { status: 202 });
    } else {
      logger.debug("[GithubWebhook] Event type not handled, skipping", "webhook/route", { {
        delivery,
        event,
        workspaceId: repository.workspaceId,
      } });
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
      logger.error("[GithubWebhook] Swarm not found or misconfigured", "webhook/route", { {
        delivery,
        workspaceId: repository.workspaceId,
        hasSwarm: !!swarm,
        hasName: !!swarm?.name,
        hasApiKey: !!swarm?.swarmApiKey,
      } });
      return NextResponse.json({ success: false }, { status: 400 });
    }

    logger.debug("[GithubWebhook] Swarm found", "webhook/route", { {
      delivery,
      workspaceId: repository.workspaceId,
      swarmId: swarm.id,
      swarmName: swarm.name,
    } });

    // Get username from credentials for async sync
    const username = workspace?.ownerId
      ? (await getGithubUsernameAndPAT(workspace.ownerId, workspace.slug))?.username
      : undefined;

    // Decrypt the swarm API key
    let decryptedSwarmApiKey: string;
    try {
      const parsed = typeof swarm.swarmApiKey === "string" ? JSON.parse(swarm.swarmApiKey) : swarm.swarmApiKey;
      decryptedSwarmApiKey = enc.decryptField("swarmApiKey", parsed);
    } catch (error) {
      logger.error("Failed to decrypt swarmApiKey:", { error });
      decryptedSwarmApiKey = swarm.swarmApiKey as string;
    }

    const swarmHost = swarm.swarmUrl ? new URL(swarm.swarmUrl).host : `${swarm.name}.sphinx.chat`;
    try {
      await db.repository.update({
        where: { id: repository.id },
        data: { status: RepositoryStatus.PENDING },
      });
      logger.debug("[GithubWebhook] Repository status → PENDING", "webhook/route", { {
        delivery,
        workspaceId: repository.workspaceId,
        repositoryUrl: repository.repositoryUrl,
      } });
    } catch (err) {
      logger.error("[GithubWebhook] Failed to set repository to PENDING", "webhook/route", { {
        delivery,
        workspaceId: repository.workspaceId,
        error: err,
      } });
    }

    const callbackUrl = getStakgraphWebhookCallbackUrl(request);

    logger.debug("[GithubWebhook] Triggering async sync", { {
      delivery,
      workspaceId: repository.workspaceId,
      swarmId: swarm.id,
      swarmHost,
      repositoryUrl: repository.repositoryUrl,
      callbackUrl,
      hasGithubAuth: !!(username && githubPat }),
    });

    const apiResult: AsyncSyncResult = await triggerAsyncSync(
      swarmHost,
      decryptedSwarmApiKey,
      repository.repositoryUrl,
      username && githubPat ? { username, pat: githubPat } : undefined,
      callbackUrl,
    );

    logger.debug("[GithubWebhook] Async sync response", "webhook/route", { {
      delivery,
      workspaceId: repository.workspaceId,
      swarmId: swarm.id,
      ok: apiResult.ok,
      status: apiResult.status,
      hasRequestId: !!apiResult.data?.request_id,
    } });

    try {
      const reqId = apiResult.data?.request_id;
      if (reqId) {
        await db.swarm.update({
          where: { id: swarm.id },
          data: { ingestRefId: reqId },
        });
        logger.debug("[GithubWebhook] Saved ingest reference", "webhook/route", { {
          delivery,
          requestId: reqId,
          workspaceId: repository.workspaceId,
          swarmId: swarm.id,
        } });
      } else {
        logger.error("[GithubWebhook] No request_id in response", "webhook/route", { {
          delivery,
          workspaceId: repository.workspaceId,
          swarmId: swarm.id,
        } });
      }
    } catch (e) {
      logger.error("[GithubWebhook] Failed to persist ingestRefId", "webhook/route", { {
        delivery,
        workspaceId: repository.workspaceId,
        swarmId: swarm.id,
        error: e,
      } });
    }

    return NextResponse.json({ success: apiResult.ok, delivery }, { status: 202 });
  } catch (error) {
    logger.error("[GithubWebhook] Unhandled error", "webhook/route", { { error } });
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
