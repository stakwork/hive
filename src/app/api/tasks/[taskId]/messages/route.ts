import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { type ChatMessage, type ContextTag, type Artifact } from "@/lib/chat";
import { resolveWorkspaceAccess, requireReadAccess, isPublicViewer } from "@/lib/auth/workspace-access";
import { toPublicUser, redactArtifactContentForPublic } from "@/lib/auth/public-redact";

// Disable caching for real-time messaging
export const fetchCache = "force-no-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json(
        { error: "Task ID is required" },
        { status: 400 },
      );
    }

    // Look up the task's workspaceId first so we can run the standard
    // access check. We deliberately don't return the task details until
    // we confirm the caller may read the workspace.
    const taskMeta = await db.task.findFirst({
      where: { id: taskId, deleted: false },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        workflowStatus: true,
        stakworkProjectId: true,
        mode: true,
        podId: true,
        featureId: true,
        sourceType: true,
        feature: { select: { id: true, title: true } },
      },
    });

    if (!taskMeta) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const access = await resolveWorkspaceAccess(request, {
      workspaceId: taskMeta.workspaceId,
    });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;
    const redactForPublic = isPublicViewer(ok);

    const task = taskMeta;

    // Get all chat messages for the task
    const chatMessages = await db.chatMessage.findMany({
      where: {
        taskId: taskId,
      },
      include: {
        artifacts: {
          orderBy: {
            createdAt: "asc",
          },
        },
        attachments: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            githubAuth: {
              select: { githubUsername: true },
            },
          },
        },
      },
      orderBy: {
        timestamp: "asc", // Show messages in chronological order
      },
    });

    // Convert to client-side types with proper JSON parsing
    const clientMessages = chatMessages.map((msg) => {
      let contextTags: ContextTag[] = [];

      // Handle contextTags - may be string, object, or null
      if (msg.contextTags) {
        if (typeof msg.contextTags === 'string') {
          try {
            contextTags = JSON.parse(msg.contextTags) as ContextTag[];
          } catch (error) {
            console.error('Error parsing contextTags for message', msg.id, ':', error, 'value:', msg.contextTags);
          }
        } else if (Array.isArray(msg.contextTags)) {
          contextTags = msg.contextTags as unknown as ContextTag[];
        }
      }

      const redactedCreatedBy = redactForPublic
        ? toPublicUser(msg.createdBy)
        : msg.createdBy;

      return {
        ...msg,
        createdBy: redactedCreatedBy,
        contextTags,
        // For public viewers, scrub credential-bearing fields out of
        // artifact content (pod URL + agentPassword on IDE/BROWSER, etc).
        // Members keep the full payload so the IDE/Browser artifact UI works.
        artifacts: msg.artifacts.map((artifact) => ({
          ...artifact,
          content: redactForPublic
            ? redactArtifactContentForPublic(artifact.type, artifact.content)
            : (artifact.content as unknown),
        })) as Artifact[],
        attachments: msg.attachments || [],
      } as ChatMessage;
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          task: {
            id: task.id,
            title: task.title,
            workspaceId: task.workspaceId,
            workflowStatus: task.workflowStatus,
            // Stakwork project ID is an internal identifier; hide from public viewers.
            stakworkProjectId: redactForPublic ? null : task.stakworkProjectId,
            mode: task.mode,
            // Pod ID is infra; hide from public viewers.
            podId: redactForPublic ? null : task.podId,
            featureId: task.featureId,
            sourceType: task.sourceType,
            feature: task.feature,
          },
          messages: clientMessages,
          count: clientMessages.length,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching chat messages for task:", error);
    return NextResponse.json(
      { error: "Failed to fetch chat messages" },
      { status: 500 },
    );
  }
}
