import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { triggerAsyncSync, AsyncSyncResult, SyncOptions } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { timingSafeEqual, computeHmacSha256Hex } from "@/lib/encryption";
import { RepositoryStatus, Prisma, TaskStatus, WorkflowStatus } from "@prisma/client";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { parseOwnerRepo } from "@/lib/ai/utils";
import { releaseTaskPod } from "@/lib/pods/utils";
import { pusherServer, getWorkspaceChannelName, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { updateFeatureStatusFromTasks } from "@/services/roadmap/feature-status-sync";

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    const signature = request.headers.get("x-hub-signature-256");
    const event = request.headers.get("x-github-event");
    const delivery = request.headers.get("x-github-delivery");

    console.log("[GithubWebhook] Received", {
      event,
      delivery,
      workspaceId,
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

    // Find repository by webhookId AND workspaceId for stronger isolation
    const repository = await db.repository.findFirst({
      where: {
        githubWebhookId: webhookId,
        workspaceId: workspaceId,
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
        codeIngestionEnabled: true,
        docsEnabled: true,
        mocksEnabled: true,
        embeddingsEnabled: true,
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
        workspaceId,
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

    console.log("[GithubWebhook] GitHub credentials", {
      delivery,
      workspaceId: repository.workspaceId,
      hasCredentials: !!githubPat,
    });

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

      // Check if code ingestion is enabled for this repository
      if (!repository.codeIngestionEnabled) {
        console.log("[GithubWebhook] Code ingestion disabled for repository, skipping sync", {
          delivery,
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        });
        return NextResponse.json({ success: true }, { status: 202 });
      }
    } else if (event === "pull_request") {
      const action = payload?.action;
      const merged = payload?.pull_request?.merged;
      const prUrl = payload?.pull_request?.html_url;

      // Check if PR was closed (with or without merge)
      if (action === "closed" && prUrl) {
        const isMerged = merged === true;
        console.log(`[GithubWebhook] PR ${isMerged ? 'merged' : 'closed'} - processing task updates`, {
          delivery,
          workspaceId: repository.workspaceId,
          prUrl,
          merged: isMerged,
        });

        try {
          // Query database for ALL tasks with matching PR artifact (not just those with pods)
          const tasks = await db.$queryRaw<
            Array<{
              task_id: string;
              pod_id: string | null;
              workspace_id: string;
              status: TaskStatus;
              feature_id: string | null;
              artifact_id: string;
              workflow_status: WorkflowStatus | null;
            }>
          >(
            Prisma.sql`
              SELECT t.id as task_id, t.pod_id, t.workspace_id, t.status, t.feature_id, 
                     a.id as artifact_id, t.workflow_status
              FROM artifacts a
              JOIN chat_messages m ON a.message_id = m.id
              JOIN tasks t ON m.task_id = t.id
              WHERE a.type = 'PULL_REQUEST'
                AND a.content->>'url' = ${prUrl}
                AND t.deleted = false
                AND t.archived = false
            `,
          );

          if (tasks.length === 0) {
            console.log(`[GithubWebhook] PR ${isMerged ? 'merged' : 'closed'} - no tasks found`, {
              delivery,
              prUrl,
            });
            return NextResponse.json({ success: true }, { status: 202 });
          }

          // Handle multiple tasks - update all of them
          console.log(`[GithubWebhook] PR ${isMerged ? 'merged' : 'closed'} - updating tasks`, {
            delivery,
            prUrl,
            taskCount: tasks.length,
            taskIds: tasks.map((t) => t.task_id),
          });

          // If PR was just closed (not merged), only update artifact status
          if (!isMerged) {
            for (const task of tasks) {
              // Update PR artifact content status to "CANCELLED" (matching UI expectations)
              try {
                const artifact = await db.artifact.findUnique({
                  where: { id: task.artifact_id },
                  select: { content: true },
                });

                if (artifact?.content && typeof artifact.content === 'object') {
                  const updatedContent = {
                    ...artifact.content,
                    status: "CANCELLED",
                  };

                  await db.artifact.update({
                    where: { id: task.artifact_id },
                    data: { content: updatedContent as Prisma.InputJsonValue },
                  });

                  console.log("[GithubWebhook] PR closed - artifact status updated to CANCELLED", {
                    delivery,
                    artifactId: task.artifact_id,
                  });
                }
              } catch (artifactError) {
                console.error("[GithubWebhook] PR closed - failed to update artifact status", {
                  delivery,
                  artifactId: task.artifact_id,
                  error: artifactError,
                });
                // Continue processing - don't fail on artifact update error
              }

              // Broadcast Pusher event for real-time UI updates
              if (workspace?.slug) {
                // Broadcast to workspace channel for UI-wide updates
                try {
                  const workspaceChannelName = getWorkspaceChannelName(workspace.slug);
                  await pusherServer.trigger(workspaceChannelName, PUSHER_EVENTS.PR_STATUS_CHANGE, {
                    taskId: task.task_id,
                    prNumber: payload.pull_request.number,
                    prUrl: prUrl,
                    state: "closed",
                    artifactStatus: "CANCELLED",
                    timestamp: new Date(),
                  });

                  console.log("[GithubWebhook] PR closed - workspace channel event broadcasted", {
                    delivery,
                    taskId: task.task_id,
                    channel: workspaceChannelName,
                  });
                } catch (workspacePusherError) {
                  console.error("[GithubWebhook] PR closed - workspace channel broadcast failed", {
                    delivery,
                    taskId: task.task_id,
                    error: workspacePusherError,
                  });
                }

                // Also broadcast to task-specific channel for task chat page
                try {
                  const taskChannelName = getTaskChannelName(task.task_id);
                  await pusherServer.trigger(taskChannelName, PUSHER_EVENTS.PR_STATUS_CHANGE, {
                    taskId: task.task_id,
                    prNumber: payload.pull_request.number,
                    prUrl: prUrl,
                    state: "closed",
                    artifactStatus: "CANCELLED",
                    timestamp: new Date(),
                  });

                  console.log("[GithubWebhook] PR closed - task channel event broadcasted", {
                    delivery,
                    taskId: task.task_id,
                    channel: taskChannelName,
                  });
                } catch (taskPusherError) {
                  console.error("[GithubWebhook] PR closed - task channel broadcast failed", {
                    delivery,
                    taskId: task.task_id,
                    error: taskPusherError,
                  });
                }
              }
            }

            console.log("[GithubWebhook] PR closed - all artifacts updated", {
              delivery,
              prUrl,
              totalTasks: tasks.length,
            });

            return NextResponse.json({ 
              success: true, 
              tasksProcessed: tasks.length,
            }, { status: 200 });
          }

          // Process each task for MERGED PRs
          const podReleaseResults: Array<{ taskId: string; success: boolean; podDropped?: boolean }> = [];
          const featureIds = new Set<string>();

          for (const task of tasks) {
            console.log("[GithubWebhook] PR merged - processing task", {
              delivery,
              prUrl,
              taskId: task.task_id,
              currentStatus: task.status,
              hasPod: !!task.pod_id,
              hasFeature: !!task.feature_id,
            });

            // Update task status to DONE
            try {
              await db.task.update({
                where: { id: task.task_id },
                data: { status: TaskStatus.DONE },
              });

              console.log("[GithubWebhook] PR merged - task status updated to DONE", {
                delivery,
                taskId: task.task_id,
              });
            } catch (taskUpdateError) {
              console.error("[GithubWebhook] PR merged - failed to update task status", {
                delivery,
                taskId: task.task_id,
                error: taskUpdateError,
              });
              continue; // Skip to next task
            }

            // Update PR artifact content status to "DONE"
            try {
              const artifact = await db.artifact.findUnique({
                where: { id: task.artifact_id },
                select: { content: true },
              });

              if (artifact?.content && typeof artifact.content === 'object') {
                const updatedContent = {
                  ...artifact.content,
                  status: "DONE",
                  merge_commit_sha: payload.pull_request.merge_commit_sha,
                };

                await db.artifact.update({
                  where: { id: task.artifact_id },
                  data: { content: updatedContent as Prisma.InputJsonValue },
                });

                console.log("[GithubWebhook] PR merged - artifact status updated to DONE", {
                  delivery,
                  artifactId: task.artifact_id,
                  mergeCommitSha: payload.pull_request.merge_commit_sha,
                });
              }
            } catch (artifactError) {
              console.error("[GithubWebhook] PR merged - failed to update artifact status", {
                delivery,
                artifactId: task.artifact_id,
                error: artifactError,
              });
              // Continue processing - don't fail on artifact update error
            }

            // Broadcast Pusher event for real-time UI updates
            if (workspace?.slug) {
              // Broadcast task status update to workspace channel
              try {
                const channelName = getWorkspaceChannelName(workspace.slug);
                await pusherServer.trigger(channelName, PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE, {
                  taskId: task.task_id,
                  status: TaskStatus.DONE,
                  workflowStatus: task.workflow_status,
                  archived: false,
                  timestamp: new Date(),
                });

                console.log("[GithubWebhook] PR merged - Pusher event broadcasted", {
                  delivery,
                  taskId: task.task_id,
                  channel: channelName,
                });
              } catch (pusherError) {
                console.error("[GithubWebhook] PR merged - Pusher broadcast failed (non-blocking)", {
                  delivery,
                  taskId: task.task_id,
                  error: pusherError,
                });
                // Continue processing - don't fail webhook on Pusher error
              }

              // Broadcast PR status change to workspace channel for UI-wide updates
              try {
                const workspaceChannelName = getWorkspaceChannelName(workspace.slug);
                await pusherServer.trigger(workspaceChannelName, PUSHER_EVENTS.PR_STATUS_CHANGE, {
                  taskId: task.task_id,
                  prNumber: payload.pull_request.number,
                  prUrl: prUrl,
                  state: "merged",
                  artifactStatus: "DONE",
                  timestamp: new Date(),
                });

                console.log("[GithubWebhook] PR merged - workspace channel PR status event broadcasted", {
                  delivery,
                  taskId: task.task_id,
                  channel: workspaceChannelName,
                });
              } catch (workspacePRPusherError) {
                console.error("[GithubWebhook] PR merged - workspace channel PR status broadcast failed", {
                  delivery,
                  taskId: task.task_id,
                  error: workspacePRPusherError,
                });
              }

              // Also send to task-specific channel for real-time updates on task chat page
              try {
                const taskChannelName = getTaskChannelName(task.task_id);
                await pusherServer.trigger(taskChannelName, PUSHER_EVENTS.PR_STATUS_CHANGE, {
                  taskId: task.task_id,
                  prNumber: payload.pull_request.number,
                  prUrl: prUrl,
                  state: "merged",
                  artifactStatus: "DONE",
                  timestamp: new Date(),
                });

                console.log("[GithubWebhook] PR merged - task channel event broadcasted", {
                  delivery,
                  taskId: task.task_id,
                  channel: taskChannelName,
                });
              } catch (taskPusherError) {
                console.error("[GithubWebhook] PR merged - task channel broadcast failed", {
                  delivery,
                  taskId: task.task_id,
                  error: taskPusherError,
                });
              }
            }

            // Collect feature IDs for batch processing
            if (task.feature_id) {
              featureIds.add(task.feature_id);
            }

            // Release pod if task has one assigned
            if (task.pod_id) {
              console.log("[GithubWebhook] PR merged - releasing pod for task", {
                delivery,
                prUrl,
                taskId: task.task_id,
                podId: task.pod_id,
              });

              const result = await releaseTaskPod({
                taskId: task.task_id,
                podId: task.pod_id,
                workspaceId: task.workspace_id,
                verifyOwnership: true,
                clearTaskFields: true,
                newWorkflowStatus: null, // Don't change workflow status - we already set task to DONE
              });

              podReleaseResults.push({
                taskId: task.task_id,
                success: result.success,
                podDropped: result.podDropped,
              });

              if (result.success) {
                if (result.reassigned) {
                  console.log("[GithubWebhook] PR merged - pod release: pod was reassigned", {
                    delivery,
                    prUrl,
                    taskId: task.task_id,
                    podId: task.pod_id,
                  });
                } else if (result.podDropped) {
                  console.log("[GithubWebhook] PR merged - pod release: success", {
                    delivery,
                    prUrl,
                    taskId: task.task_id,
                    podId: task.pod_id,
                  });
                } else {
                  console.log("[GithubWebhook] PR merged - pod release: partial success (task cleared)", {
                    delivery,
                    prUrl,
                    taskId: task.task_id,
                    taskCleared: result.taskCleared,
                  });
                }
              } else {
                console.error("[GithubWebhook] PR merged - pod release: failed (non-blocking)", {
                  delivery,
                  prUrl,
                  taskId: task.task_id,
                  error: result.error,
                });
              }
            }
          }

          // Trigger feature status cascade for all affected features (batch process)
          for (const featureId of featureIds) {
            try {
              await updateFeatureStatusFromTasks(featureId);
              console.log("[GithubWebhook] PR merged - feature status cascade triggered", {
                delivery,
                featureId,
              });
            } catch (featureError) {
              console.error("[GithubWebhook] PR merged - feature status cascade failed (non-blocking)", {
                delivery,
                featureId,
                error: featureError,
              });
              // Continue processing - don't fail webhook on feature sync error
            }
          }

          // Log summary
          console.log("[GithubWebhook] PR merged - all tasks processed", {
            delivery,
            prUrl,
            totalTasks: tasks.length,
            podsReleased: podReleaseResults.filter(r => r.podDropped).length,
            featuresUpdated: featureIds.size,
          });

          return NextResponse.json({ 
            success: true, 
            tasksProcessed: tasks.length,
            podsReleased: podReleaseResults.filter(r => r.podDropped).length,
          }, { status: 200 });
        } catch (error) {
          console.error("[GithubWebhook] PR merged - error processing task updates", {
            delivery,
            prUrl,
            error,
          });
          return NextResponse.json({ success: true }, { status: 202 });
        }
      }

      console.log("[GithubWebhook] PR action not handled, skipping", {
        delivery,
        workspaceId: repository.workspaceId,
        action,
        merged,
      });

      // For pull_request events, we don't trigger sync, so return here
      return NextResponse.json({ success: true }, { status: 202 });
    } else if (event === "deployment_status") {
      // Handle deployment_status events for tracking staging/production deployments
      console.log("[GithubWebhook] Processing deployment_status event", {
        delivery,
        workspaceId: repository.workspaceId,
      });

      try {
        const deploymentPayload = payload as {
          deployment_status: {
            state: string;
            target_url?: string;
            environment_url?: string;
          };
          deployment: {
            id: number;
            sha: string;
            environment: string;
          };
        };

        const deploymentState = deploymentPayload.deployment_status.state;
        const environment = deploymentPayload.deployment.environment.toLowerCase();
        const commitSha = deploymentPayload.deployment.sha;
        const githubDeploymentId = String(deploymentPayload.deployment.id);
        const deploymentUrl = deploymentPayload.deployment_status.target_url || deploymentPayload.deployment_status.environment_url;

        console.log("[GithubWebhook] Deployment status event details", {
          delivery,
          deploymentState,
          environment,
          commitSha,
          githubDeploymentId,
          hasUrl: !!deploymentUrl,
        });

        // Filter environments - only process staging and production
        if (environment !== "staging" && environment !== "production") {
          console.log("[GithubWebhook] Deployment environment not tracked, ignoring", {
            delivery,
            environment,
            commitSha,
          });
          return NextResponse.json({ success: true }, { status: 202 });
        }

        // Map deployment status
        let mappedStatus: "IN_PROGRESS" | "SUCCESS" | "FAILURE" | "ERROR";
        if (deploymentState === "success") {
          mappedStatus = "SUCCESS";
        } else if (deploymentState === "failure") {
          mappedStatus = "FAILURE";
        } else if (deploymentState === "error") {
          mappedStatus = "ERROR";
        } else if (deploymentState === "pending" || deploymentState === "in_progress") {
          mappedStatus = "IN_PROGRESS";
        } else {
          console.log("[GithubWebhook] Unknown deployment state, ignoring", {
            delivery,
            deploymentState,
            commitSha,
          });
          return NextResponse.json({ success: true }, { status: 202 });
        }

        // Get GitHub API client to fetch commit history
        const { getUserAppTokens } = await import("@/lib/githubApp");
        const { Octokit } = await import("@octokit/rest");
        
        // Get the repository owner from the webhook payload
        const repoOwner = payload.repository.owner.login;
        const repoName = payload.repository.name;
        
        // Get last successful deployment of same environment to find commit range
        // Find the last successful deployment to compare against
        // For production deployments, look for the last deployment of ANY environment
        // to ensure we upgrade all tasks that were deployed to staging
        // For staging deployments, only look for the last staging deployment
        const lastDeployment = await db.deployment.findFirst({
          where: {
            repositoryId: repository.id,
            environment: environment === "production" ? undefined : "STAGING",
            status: "SUCCESS",
          },
          orderBy: {
            completedAt: "desc",
          },
          select: {
            commitSha: true,
            environment: true,
          },
        });

        let commitsInDeployment: string[] = [commitSha];
        
        // Fetch commit history from GitHub to get all commits in this deployment
        try {
          // Get any user's token for this workspace to access the repo
          const workspaceUser = await db.workspaceMember.findFirst({
            where: { workspaceId: repository.workspaceId },
            select: { userId: true },
          });

          if (workspaceUser) {
            const tokens = await getUserAppTokens(workspaceUser.userId, repoOwner);
            if (tokens?.accessToken) {
              const octokit = new Octokit({ auth: tokens.accessToken });
              
              // PRODUCTION DEPLOYMENT: Check ALL staging tasks
              if (environment === "production") {
                console.log("[GithubWebhook] Production deployment detected - checking all staging tasks", {
                  delivery,
                  commitSha: commitSha.substring(0, 7),
                });
                
                // Get all tasks currently in STAGING for this repository
                const stagingTasks = await db.$queryRaw<Array<{
                  merge_commit_sha: string;
                }>>`
                  SELECT DISTINCT a.content->>'merge_commit_sha' as merge_commit_sha
                  FROM artifacts a
                  JOIN chat_messages m ON a.message_id = m.id
                  JOIN tasks t ON m.task_id = t.id
                  WHERE a.type = 'PULL_REQUEST'
                    AND a.content->>'merge_commit_sha' IS NOT NULL
                    AND t.repository_id = ${repository.id}
                    AND t.deployment_status = 'staging'
                    AND t.deleted = false
                    AND t.archived = false
                `;
                
                console.log("[GithubWebhook] Found staging tasks to verify", {
                  delivery,
                  stagingTaskCount: stagingTasks.length,
                });
                
                // For each staging task, check if its commit is included in this production deployment
                for (const task of stagingTasks) {
                  try {
                    // Check if the task's merge commit is an ancestor of the production deployment
                    const comparison = await octokit.repos.compareCommits({
                      owner: repoOwner,
                      repo: repoName,
                      base: task.merge_commit_sha,
                      head: commitSha,
                    });
                    
                    // If status is "ahead" or "identical", the task's commit is included
                    if (comparison.data.status === "ahead" || comparison.data.status === "identical") {
                      commitsInDeployment.push(task.merge_commit_sha);
                    }
                  } catch (compareError) {
                    console.warn("[GithubWebhook] Failed to compare staging task commit", {
                      delivery,
                      commitSha: task.merge_commit_sha.substring(0, 7),
                      error: compareError,
                    });
                  }
                }
                
                console.log("[GithubWebhook] Production deployment commit verification complete", {
                  delivery,
                  totalCommitsToUpdate: commitsInDeployment.length,
                  stagingTasksChecked: stagingTasks.length,
                });
                
              } else if (lastDeployment?.commitSha) {
                // STAGING DEPLOYMENT: Use commit comparison with pagination
                try {
                  const allCommits: string[] = [];
                  let page = 1;
                  const perPage = 100; // GitHub API max per page
                  let hasMorePages = true;
                  
                  console.log("[GithubWebhook] Fetching commits between deployments", {
                    delivery,
                    fromSha: lastDeployment.commitSha.substring(0, 7),
                    toSha: commitSha.substring(0, 7),
                  });
                  
                  // Paginate through all commits (GitHub API has 250 commit default limit)
                  while (hasMorePages) {
                    const comparison = await octokit.repos.compareCommits({
                      owner: repoOwner,
                      repo: repoName,
                      base: lastDeployment.commitSha,
                      head: commitSha,
                      per_page: perPage,
                      page,
                    });
                    
                    const commits = comparison.data.commits.map(c => c.sha);
                    allCommits.push(...commits);
                    
                    console.log("[GithubWebhook] Fetched commit page", {
                      delivery,
                      page,
                      commitsInPage: commits.length,
                      totalCommitsSoFar: allCommits.length,
                    });
                    
                    // Check if we got fewer results than requested (last page)
                    if (commits.length < perPage) {
                      hasMorePages = false;
                    } else {
                      page++;
                    }
                    
                    // Safety check: prevent infinite loops (max ~25k commits)
                    if (page > 250) {
                      console.warn("[GithubWebhook] Hit maximum page limit, stopping pagination", {
                        delivery,
                        totalCommits: allCommits.length,
                      });
                      break;
                    }
                  }
                  
                  // Extract all commit SHAs from the comparison
                  commitsInDeployment = allCommits;
                  commitsInDeployment.push(commitSha); // Include head commit
                  
                  console.log("[GithubWebhook] Found commits in deployment range", {
                    delivery,
                    fromSha: lastDeployment.commitSha.substring(0, 7),
                    toSha: commitSha.substring(0, 7),
                    commitCount: commitsInDeployment.length,
                    pagesFetched: page,
                  });
                  
                  // Warn if we're getting close to the old 250 limit
                  if (commitsInDeployment.length >= 200) {
                    console.warn("[GithubWebhook] Large number of commits in deployment", {
                      delivery,
                      commitCount: commitsInDeployment.length,
                      suggestion: "Consider deploying more frequently",
                    });
                  }
                } catch (compareError) {
                  console.warn("[GithubWebhook] Failed to compare commits, using single SHA", {
                    delivery,
                    error: compareError,
                  });
                }
              } else {
                console.log("[GithubWebhook] No previous deployment found, processing single commit", {
                  delivery,
                  environment,
                  commitSha: commitSha.substring(0, 7),
                });
              }
            }
          }
        } catch (githubError) {
          console.warn("[GithubWebhook] Failed to fetch commit history from GitHub", {
            delivery,
            error: githubError,
          });
        }

        // Query tasks by ALL commit SHAs in the deployment range
        const tasks = await db.$queryRaw<Array<{
          task_id: string;
          workspace_id: string;
          repository_id: string | null;
          artifact_id: string;
          pr_url: string;
          merge_commit_sha: string;
          current_deployment_status: string | null;
        }>>`
          SELECT DISTINCT t.id as task_id, t.workspace_id, t.repository_id,
                 a.id as artifact_id, a.content->>'url' as pr_url,
                 a.content->>'merge_commit_sha' as merge_commit_sha,
                 t.deployment_status as current_deployment_status
          FROM artifacts a
          JOIN chat_messages m ON a.message_id = m.id
          JOIN tasks t ON m.task_id = t.id
          WHERE a.type = 'PULL_REQUEST'
            AND a.content->>'merge_commit_sha' = ANY(${commitsInDeployment})
            AND t.deleted = false
            AND t.archived = false
            AND t.workspace_id = ${repository.workspaceId}
        `;

        console.log("[GithubWebhook] Tasks found for deployment", {
          delivery,
          commitSha: commitSha.substring(0, 7),
          commitsInRange: commitsInDeployment.length,
          taskCount: tasks.length,
          environment,
        });

        if (tasks.length === 0) {
          console.log("[GithubWebhook] No matching tasks found for deployment", {
            delivery,
            commitSha,
            environment,
          });
          return NextResponse.json({ success: true }, { status: 202 });
        }

        // Create Deployment records for all matching tasks
        const deploymentEnvironment = environment === "staging" ? "STAGING" : "PRODUCTION";
        const now = new Date();
        const completedAt = mappedStatus === "SUCCESS" || mappedStatus === "FAILURE" || mappedStatus === "ERROR" ? now : null;

        for (const task of tasks) {
          try {
            await db.deployment.create({
              data: {
                taskId: task.task_id,
                repositoryId: task.repository_id,
                commitSha: commitSha,
                prUrl: task.pr_url,
                environment: deploymentEnvironment,
                status: mappedStatus,
                deploymentUrl: deploymentUrl || null,
                githubDeploymentId: githubDeploymentId,
                startedAt: now,
                completedAt: completedAt,
              },
            });

            console.log("[GithubWebhook] Deployment record created", {
              delivery,
              taskId: task.task_id,
              environment: deploymentEnvironment,
              status: mappedStatus,
            });
          } catch (deploymentError) {
            console.error("[GithubWebhook] Failed to create deployment record", {
              delivery,
              taskId: task.task_id,
              error: deploymentError,
            });
            // Continue processing other tasks
          }
        }

        // Update task deployment status only for SUCCESS
        if (mappedStatus === "SUCCESS") {
          console.log("[GithubWebhook] Tasks before filtering", {
            delivery,
            environment,
            tasks: tasks.map(t => ({
              id: t.task_id,
              currentStatus: t.current_deployment_status,
            })),
          });
          
          // Filter tasks based on current status to prevent downgrades
          let tasksToUpdate = tasks;
          
          if (environment === "staging") {
            // Staging deployment: Only update tasks that are NOT already in production
            tasksToUpdate = tasks.filter(t => t.current_deployment_status !== "production");
            
            const skippedTasks = tasks.filter(t => t.current_deployment_status === "production");
            if (skippedTasks.length > 0) {
              console.log("[GithubWebhook] Skipping production tasks for staging deployment", {
                delivery,
                skippedCount: skippedTasks.length,
                skippedTaskIds: skippedTasks.map(t => t.task_id),
              });
            }
          }
          // For production deployments, update all tasks (including upgrades from staging)
          
          console.log("[GithubWebhook] Tasks after filtering", {
            delivery,
            environment,
            tasksToUpdate: tasksToUpdate.map(t => ({
              id: t.task_id,
              currentStatus: t.current_deployment_status,
            })),
          });

          if (tasksToUpdate.length > 0) {
            const taskIds = tasksToUpdate.map(t => t.task_id);
            const updateData: {
              deploymentStatus: string;
              deployedToStagingAt?: Date;
              deployedToProductionAt?: Date;
            } = {
              deploymentStatus: environment,
            };

            if (environment === "staging") {
              updateData.deployedToStagingAt = now;
            } else if (environment === "production") {
              updateData.deployedToProductionAt = now;
            }

            try {
              const updateResult = await db.task.updateMany({
                where: {
                  id: { in: taskIds },
                },
                data: updateData,
              });

              // Verify the update by querying the tasks again
              const verifyTasks = await db.task.findMany({
                where: { id: { in: taskIds } },
                select: { id: true, deploymentStatus: true },
              });
              
              console.log("[GithubWebhook] Task deployment status updated", {
                delivery,
                taskCount: taskIds.length,
                updatedCount: updateResult.count,
                taskIds: taskIds,
                environment,
                deploymentStatus: environment,
                updateData,
                upgradedFromStaging: environment === "production" 
                  ? tasksToUpdate.filter(t => t.current_deployment_status === "staging").length 
                  : 0,
                verifyTasks: verifyTasks.map(t => ({ id: t.id, status: t.deploymentStatus })),
              });
            } catch (updateError) {
              console.error("[GithubWebhook] Failed to update task deployment status", {
                delivery,
                taskCount: taskIds.length,
                error: updateError,
              });
            }
          } else {
            console.log("[GithubWebhook] No tasks to update after filtering", {
              delivery,
              environment,
              totalTasks: tasks.length,
            });
          }

          // Broadcast Pusher events only for tasks that were actually updated
          if (workspace?.slug && tasksToUpdate.length > 0) {
            // Broadcast to workspace channel for task list updates
            try {
              const workspaceChannelName = getWorkspaceChannelName(workspace.slug);
              for (const task of tasksToUpdate) {
                await pusherServer.trigger(workspaceChannelName, PUSHER_EVENTS.DEPLOYMENT_STATUS_CHANGE, {
                  taskId: task.task_id,
                  deploymentStatus: environment,
                  environment: environment,
                  deployedAt: now,
                  timestamp: now,
                });

                console.log("[GithubWebhook] Workspace deployment event broadcasted", {
                  delivery,
                  taskId: task.task_id,
                  channel: workspaceChannelName,
                  environment,
                });
              }
            } catch (pusherError) {
              console.error("[GithubWebhook] Workspace deployment broadcast failed", {
                delivery,
                error: pusherError,
              });
            }

            // Broadcast to individual task channels
            for (const task of tasksToUpdate) {
              try {
                const taskChannelName = getTaskChannelName(task.task_id);
                await pusherServer.trigger(taskChannelName, PUSHER_EVENTS.DEPLOYMENT_STATUS_CHANGE, {
                  taskId: task.task_id,
                  deploymentStatus: environment,
                  environment: environment,
                  deployedAt: now,
                  timestamp: now,
                });

                console.log("[GithubWebhook] Task deployment event broadcasted", {
                  delivery,
                  taskId: task.task_id,
                  channel: taskChannelName,
                  environment,
                });
              } catch (taskPusherError) {
                console.error("[GithubWebhook] Task deployment broadcast failed", {
                  delivery,
                  taskId: task.task_id,
                  error: taskPusherError,
                });
              }
            }
          }
        } else {
          console.log("[GithubWebhook] Deployment not successful, task status not updated", {
            delivery,
            mappedStatus,
            environment,
            taskCount: tasks.length,
          });
        }

        return NextResponse.json({ 
          success: true,
          tasksProcessed: tasks.length,
          environment,
          status: mappedStatus,
        }, { status: 202 });

      } catch (error) {
        console.error("[GithubWebhook] Error processing deployment_status event", {
          delivery,
          error,
        });
        return NextResponse.json({ success: true }, { status: 202 });
      }
    } else {
      console.log("[GithubWebhook] Event type not handled, skipping", {
        delivery,
        event,
        workspaceId: repository.workspaceId,
      });
      return NextResponse.json({ success: true }, { status: 202 });
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: repository.workspaceId },
      select: {
        id: true,
        name: true,
        swarmUrl: true,
        swarmApiKey: true,
        autoLearnEnabled: true,
      },
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

    // Build sync options based on repository settings
    const syncOptions: SyncOptions = {};
    if (repository.docsEnabled) syncOptions.docs = true;
    if (repository.mocksEnabled) syncOptions.mocks = true;
    if (repository.embeddingsEnabled) syncOptions.embeddings = true;

    console.log("[GithubWebhook] Triggering async sync", {
      delivery,
      workspaceId: repository.workspaceId,
      swarmId: swarm.id,
      swarmHost,
      repositoryUrl: repository.repositoryUrl,
      callbackUrl,
      hasGithubAuth: !!(username && githubPat),
      syncOptions,
    });

    const apiResult: AsyncSyncResult = await triggerAsyncSync(
      swarmHost,
      decryptedSwarmApiKey,
      repository.repositoryUrl,
      username && githubPat ? { username, pat: githubPat } : undefined,
      callbackUrl,
      false, // useLsp
      Object.keys(syncOptions).length > 0 ? syncOptions : undefined,
    );

    console.log("[GithubWebhook] Async sync response", {
      delivery,
      workspaceId: repository.workspaceId,
      swarmId: swarm.id,
      ok: apiResult.ok,
      status: apiResult.status,
      hasRequestId: !!apiResult.data?.request_id,
    });

    // Trigger auto-learn if enabled (for push events to allowed branches)
    try {
      triggerAutoLearnIfEnabled({
        workspaceId: repository.workspaceId,
        repositoryUrl: repository.repositoryUrl,
        githubPat,
        delivery,
        swarm: {
          autoLearnEnabled: swarm.autoLearnEnabled,
          swarmUrl: swarm.swarmUrl,
        },
        decryptedSwarmApiKey,
      });
    } catch (error) {
      console.error("[GithubWebhook] Auto-learn trigger failed, continuing", {
        delivery,
        workspaceId: repository.workspaceId,
        error,
      });
    }

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

interface AutoLearnParams {
  workspaceId: string;
  repositoryUrl: string;
  githubPat: string | undefined;
  delivery: string | null;
  swarm: {
    autoLearnEnabled: boolean | null;
    swarmUrl: string | null;
  };
  decryptedSwarmApiKey: string;
}

/**
 * Triggers the gitree/process endpoint if autoLearnEnabled is true on the workspace swarm.
 * This is called on push events to allowed branches to automatically update the knowledge base.
 */
function triggerAutoLearnIfEnabled({
  workspaceId,
  repositoryUrl,
  githubPat,
  delivery,
  swarm,
  decryptedSwarmApiKey,
}: AutoLearnParams) {
  if (!swarm.autoLearnEnabled) {
    console.log("[GithubWebhook] Auto-learn disabled, skipping", {
      delivery,
      workspaceId,
      autoLearnEnabled: swarm.autoLearnEnabled ?? false,
    });
    return;
  }

  if (!swarm.swarmUrl) {
    console.error("[GithubWebhook] Auto-learn enabled but swarm URL not configured", {
      delivery,
      workspaceId,
    });
    return;
  }

  if (!githubPat) {
    console.error("[GithubWebhook] Auto-learn enabled but no GitHub PAT available", {
      delivery,
      workspaceId,
    });
    return;
  }

  // Parse repository URL to get owner/repo
  let owner: string, repo: string;
  try {
    const parsed = parseOwnerRepo(repositoryUrl);
    owner = parsed.owner;
    repo = parsed.repo;
  } catch (error) {
    console.error("[GithubWebhook] Failed to parse repository URL for auto-learn", {
      delivery,
      workspaceId,
      repositoryUrl,
      error,
    });
    return;
  }

  // Build swarm base URL
  const swarmUrlObj = new URL(swarm.swarmUrl);
  let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
  if (swarm.swarmUrl.includes("localhost")) {
    baseSwarmUrl = `http://localhost:3355`;
  }

  // Trigger gitree/process (fire and forget)
  const gitreeUrl = `${baseSwarmUrl}/gitree/process?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&token=${encodeURIComponent(githubPat)}&summarize=true&link=true`;

  console.log("[GithubWebhook] Triggering auto-learn gitree/process", {
    delivery,
    workspaceId,
    owner,
    repo,
  });

  fetch(gitreeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": decryptedSwarmApiKey,
    },
  })
    .then((response) => {
      if (!response.ok) {
        console.error("[GithubWebhook] Auto-learn gitree/process failed", {
          delivery,
          workspaceId,
          status: response.status,
        });
      } else {
        console.log("[GithubWebhook] Auto-learn gitree/process initiated successfully", {
          delivery,
          workspaceId,
        });
      }
    })
    .catch((error) => {
      console.error("[GithubWebhook] Auto-learn gitree/process request failed", {
        delivery,
        workspaceId,
        error,
      });
    });
}
