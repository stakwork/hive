import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus, ArtifactType } from "@prisma/client";
import { updateFeatureStatusFromTasks } from "@/services/roadmap/feature-status-sync";
import { notifyFeatureCanvasRefresh } from "@/lib/canvas";
import { linkFeatureToConcepts } from "@/lib/graph-walker";
import { extractPrArtifact } from "@/lib/helpers/tasks";
import { autoResolveErrorIssuesForFeatures } from "@/services/error-issues";

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    let userId = (session?.user as { id?: string })?.id ?? null;

    if (!userId) {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET! });
      if (token?.id && typeof token.id === "string") {
        userId = token.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { taskId } = await params;
    const body = await request.json();
    const { message, role, artifacts } = body;

    if (!message && (!artifacts || artifacts.length === 0)) {
      return NextResponse.json({ error: "Message or artifacts are required" }, { status: 400 });
    }

    if (!role || (role !== "USER" && role !== "ASSISTANT")) {
      return NextResponse.json({ error: "Valid role is required (USER or ASSISTANT)" }, { status: 400 });
    }

    // Verify task exists and user has access
    const task = await db.task.findFirst({
      where: {
        id: taskId,
        deleted: false,
      },
      select: {
        workspaceId: true,
        workspace: {
          select: {
            ownerId: true,
            members: {
              where: {
                userId: userId,
              },
              select: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Check if user is workspace owner or member
    const isOwner = task.workspace.ownerId === userId;
    const isMember = task.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Create the chat message with artifacts
    const chatMessage = await db.chatMessage.create({
      data: {
        taskId,
        message: message || "",
        role: role as ChatRole,
        contextTags: JSON.stringify([]),
        status: ChatStatus.SENT,
        artifacts: artifacts
          ? {
              create: artifacts.map((artifact: { type: ArtifactType; content: unknown; icon?: string }) => ({
                type: artifact.type,
                content: artifact.content,
                icon: artifact.icon || null,
              })),
            }
          : undefined,
      },
      include: {
        artifacts: true,
      },
    });

    // Check if artifacts contain PULL_REQUEST to auto-complete task
    const hasPullRequest = artifacts?.some(
      (artifact: { type: ArtifactType }) => artifact.type === ArtifactType.PULL_REQUEST,
    );

    if (hasPullRequest) {
      const updatedTask = await db.task.update({
        where: { id: taskId },
        data: {
          status: "DONE",
          workflowStatus: "COMPLETED",
        },
        select: {
          featureId: true,
        },
      });

      // Sync feature status if task belongs to a feature
      if (updatedTask.featureId) {
        try {
          await updateFeatureStatusFromTasks(updatedTask.featureId);
        } catch (error) {
          console.error('Failed to sync feature status:', error);
          // Don't fail the request if feature sync fails
        }
        // Org canvas refresh — milestone progress + agent count may
        // have shifted regardless of whether the feature's status did.
        // `taskId` from the route param; `updatedTask` only carried
        // `featureId` in its select.
        void notifyFeatureCanvasRefresh(updatedTask.featureId, "task-messages-saved", {
          taskId,
        });
        // Feature→Concept edge bridge — fire async, never blocks user path
        void linkFeatureToConcepts(updatedTask.featureId).catch((err) =>
          console.error("[FeatureConceptBridge] live hook failed", {
            featureId: updatedTask.featureId,
            err,
          })
        );

        // Error auto-resolve: if the just-recorded PR is already merged,
        // resolve any linked UNRESOLVED ErrorIssues for this feature.
        // Fire-and-forget — never blocks the message-save request.
        const featureIdForResolve = updatedTask.featureId;
        void (async () => {
          try {
            // Re-fetch the task with its chat messages so extractPrArtifact can read the PR artifact.
            const taskWithMessages = await db.task.findUnique({
              where: { id: taskId },
              select: {
                id: true,
                status: true,
                podId: true,
                workspaceId: true,
                chatMessages: {
                  select: {
                    artifacts: {
                      select: { id: true, type: true, content: true },
                    },
                  },
                },
              },
            });

            if (!taskWithMessages) return;

            const prArtifact = await extractPrArtifact(taskWithMessages, userId);
            if (prArtifact?.content?.status !== "DONE") return;

            console.log("[error-auto-resolve] PR already merged at artifact write — triggering resolve", {
              taskId,
              featureId: featureIdForResolve,
            });
            const { resolvedIssueIds } = await autoResolveErrorIssuesForFeatures([featureIdForResolve]);
            console.log("[error-auto-resolve] artifact-write resolve complete", {
              taskId,
              featureId: featureIdForResolve,
              resolvedIssueIds,
            });
          } catch (err) {
            console.error("[error-auto-resolve] artifact-write hook failed (non-blocking)", {
              taskId,
              featureId: featureIdForResolve,
              error: err,
            });
          }
        })();
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: chatMessage,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error saving chat message:", error);
    return NextResponse.json({ error: "Failed to save chat message" }, { status: 500 });
  }
}
