import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { triggerAsyncSync, AsyncSyncResult } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { timingSafeEqual, computeHmacSha256Hex } from "@/lib/encryption";
import { RepositoryStatus } from "@prisma/client";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { storePullRequest, type PullRequestPayload } from "@/lib/github/storePullRequest";

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

    const repositories = await db.repository.findMany({
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

    if (!repositories || repositories.length === 0) {
      console.error("[GithubWebhook] No repositories found", {
        delivery,
        webhookId,
        candidateUrl,
      });
      return NextResponse.json({ success: false }, { status: 404 });
    }

    console.log("[GithubWebhook] Repositories found", {
      delivery,
      count: repositories.length,
      workspaceIds: repositories.map(r => r.workspaceId),
    });

    // Use the first repository's secret for signature verification
    // (all repositories sharing the same webhook should have the same secret)
    const firstRepository = repositories[0];
    if (!firstRepository.githubWebhookSecret) {
      console.error("[GithubWebhook] First repository missing secret", {
        delivery,
        webhookId,
        workspaceId: firstRepository.workspaceId,
      });
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const enc = EncryptionService.getInstance();
    const secret = enc.decryptField("githubWebhookSecret", firstRepository.githubWebhookSecret);

    const expectedDigest = computeHmacSha256Hex(secret, rawBody);
    const expected = `sha256=${expectedDigest}`;

    if (!timingSafeEqual(expected, signature)) {
      console.error("[GithubWebhook] Signature verification failed", {
        delivery,
        webhookId,
        workspaceIds: repositories.map(r => r.workspaceId),
      });
      return NextResponse.json({ success: false }, { status: 401 });
    }

    console.log("[GithubWebhook] Signature verified", {
      delivery,
      webhookId,
      repositoryCount: repositories.length,
    });

    const repoDefaultBranch: string | undefined = payload?.repository?.default_branch;

    if (event === "push") {
      const ref: string | undefined = payload?.ref;
      if (!ref) {
        console.error("[GithubWebhook] Missing ref in push event", { delivery });
        return NextResponse.json({ success: false }, { status: 400 });
      }
      const pushedBranch = ref.split("/").pop();
      if (!pushedBranch) {
        console.error("[GithubWebhook] Missing pushed branch", { delivery, ref });
        return NextResponse.json({ success: false }, { status: 400 });
      }

      console.log("[GithubWebhook] Processing push event", {
        delivery,
        pushedBranch,
        repositoryCount: repositories.length,
      });

      // Process all repositories - validate branch per repository
      // Continue processing even if some fail
    } else if (event === "pull_request") {
      const action = payload?.action;
      const merged = payload?.pull_request?.merged;

      if (action === "closed" && merged === true) {
        console.log("[GithubWebhook] Processing merged PR for all repositories", {
          delivery,
          prNumber: payload.number,
          repositoryCount: repositories.length,
        });

        // Store PR data for all repositories
        const prResults = await Promise.allSettled(
          repositories.map(async (repository) => {
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

            return storePullRequest(
              payload as PullRequestPayload,
              repository.id,
              repository.workspaceId,
              githubPat,
            );
          })
        );

        // Log any failures
        prResults.forEach((result, index) => {
          if (result.status === "rejected") {
            console.error("[GithubWebhook] Failed to store PR for repository", {
              delivery,
              workspaceId: repositories[index].workspaceId,
              prNumber: payload.number,
              error: result.reason,
            });
          }
        });
      } else {
        console.log("[GithubWebhook] PR action not handled, skipping", {
          delivery,
          action,
          merged,
        });
      }

      // For pull_request events, we don't trigger sync, so return here
      return NextResponse.json({ success: true }, { status: 202 });
    } else {
      console.log("[GithubWebhook] Event type not handled, skipping", {
        delivery,
        event,
      });
      return NextResponse.json({ success: true }, { status: 202 });
    }

    // Process sync for all repositories (push event only reaches here)
    const pushedBranch = payload?.ref?.split("/").pop();
    const callbackUrl = getStakgraphWebhookCallbackUrl(request);

    const syncResults = await Promise.allSettled(
      repositories.map(async (repository) => {
        // Validate branch for this repository
        const allowedBranches = new Set<string>(
          [repository.branch, repoDefaultBranch, "main", "master"].filter(Boolean) as string[],
        );

        if (pushedBranch && !allowedBranches.has(pushedBranch)) {
          console.log("[GithubWebhook] Branch not allowed for repository, skipping", {
            delivery,
            workspaceId: repository.workspaceId,
            pushedBranch,
            allowedBranches: Array.from(allowedBranches),
          });
          return { skipped: true, workspaceId: repository.workspaceId, reason: "branch_not_allowed" };
        }

        // Get workspace and credentials
        const workspace = await db.workspace.findUnique({
          where: { id: repository.workspaceId },
          select: { ownerId: true, slug: true },
        });

        let githubPat: string | undefined;
        let username: string | undefined;
        if (workspace?.ownerId) {
          const creds = await getGithubUsernameAndPAT(workspace.ownerId, workspace.slug);
          if (creds) {
            githubPat = creds.token;
            username = creds.username;
          }
        }

        // Get swarm
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
          return { skipped: true, workspaceId: repository.workspaceId, reason: "swarm_not_configured" };
        }

        console.log("[GithubWebhook] Processing sync for workspace", {
          delivery,
          workspaceId: repository.workspaceId,
          swarmId: swarm.id,
          repositoryUrl: repository.repositoryUrl,
        });

        // Decrypt the swarm API key
        let decryptedSwarmApiKey: string;
        try {
          const parsed = typeof swarm.swarmApiKey === "string" ? JSON.parse(swarm.swarmApiKey) : swarm.swarmApiKey;
          decryptedSwarmApiKey = enc.decryptField("swarmApiKey", parsed);
        } catch (error) {
          console.error("[GithubWebhook] Failed to decrypt swarmApiKey", {
            delivery,
            workspaceId: repository.workspaceId,
            error,
          });
          decryptedSwarmApiKey = swarm.swarmApiKey as string;
        }

        // Update repository status to PENDING
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

        // Trigger async sync
        const swarmHost = swarm.swarmUrl ? new URL(swarm.swarmUrl).host : `${swarm.name}.sphinx.chat`;

        console.log("[GithubWebhook] Triggering async sync", {
          delivery,
          workspaceId: repository.workspaceId,
          swarmId: swarm.id,
          swarmHost,
          repositoryUrl: repository.repositoryUrl,
          callbackUrl,
          hasGithubAuth: !!(username && githubPat),
        });

        const apiResult: AsyncSyncResult = await triggerAsyncSync(
          swarmHost,
          decryptedSwarmApiKey,
          repository.repositoryUrl,
          username && githubPat ? { username, pat: githubPat } : undefined,
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

        // Save ingest reference
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

        return { success: apiResult.ok, workspaceId: repository.workspaceId };
      })
    );

    // Log summary of sync results
    const successful = syncResults.filter((r) => r.status === "fulfilled" && r.value.success).length;
    const failed = syncResults.filter((r) => r.status === "rejected").length;
    const skipped = syncResults.filter(
      (r) => r.status === "fulfilled" && (r.value as any).skipped
    ).length;

    console.log("[GithubWebhook] Sync completed for all repositories", {
      delivery,
      total: repositories.length,
      successful,
      failed,
      skipped,
    });

    // Log any failures
    syncResults.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error("[GithubWebhook] Sync failed for repository", {
          delivery,
          workspaceId: repositories[index].workspaceId,
          error: result.reason,
        });
      }
    });

    return NextResponse.json(
      { success: successful > 0, delivery, processed: repositories.length, successful, failed, skipped },
      { status: 202 }
    );
  } catch (error) {
    console.error("[GithubWebhook] Unhandled error", { error });
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
