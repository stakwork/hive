import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { pusherServer, getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";
import { StakworkStatusPayload } from "@/types";
import { EncryptionService } from "@/lib/encryption";
import { computeHmacSha256Hex, timingSafeEqual } from "@/lib/encryption";

export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  try {
    // Get signature from headers for verification
    const signature = request.headers.get("x-stakwork-signature");
    
    // Get raw body for signature verification (must be done before .json())
    const rawBody = await request.text();
    
    // Parse JSON and handle parse errors
    let body: StakworkStatusPayload;
    try {
      body = JSON.parse(rawBody) as StakworkStatusPayload;
    } catch (error) {
      console.error("[StakworkWebhook] Invalid JSON payload", { error });
      return NextResponse.json(
        { success: false, error: "Invalid JSON" },
        { status: 400 }
      );
    }
    
    const { project_status, task_id } = body;
    const url = new URL(request.url);
    const taskIdFromQuery = url.searchParams.get("task_id");
    const runIdFromQuery = url.searchParams.get("run_id");
    const finalTaskId = task_id || taskIdFromQuery;
    const finalRunId = runIdFromQuery;

    // Must provide either task_id or run_id
    if (!finalTaskId && !finalRunId) {
      console.error("[StakworkWebhook] No task_id or run_id provided");
      return NextResponse.json(
        { success: false, error: "Either task_id or run_id is required" },
        { status: 400 }
      );
    }

    if (!project_status) {
      console.error("[StakworkWebhook] No project_status provided");
      return NextResponse.json(
        { success: false, error: "project_status is required" },
        { status: 400 }
      );
    }

    // Lookup workspace with webhook secret for verification
    let workspace: { id: string; slug: string; stakworkWebhookSecret: string | null } | null = null;

    if (finalRunId) {
      const run = await db.stakworkRun.findFirst({
        where: { id: finalRunId },
        include: {
          workspace: {
            select: {
              id: true,
              slug: true,
              stakworkWebhookSecret: true,
            },
          },
        },
      });
      
      if (!run) {
        console.error("[StakworkWebhook] StakworkRun not found", { runId: finalRunId });
        return NextResponse.json(
          { success: false, error: "Run not found" },
          { status: 404 }
        );
      }
      
      workspace = run.workspace;
    } else if (finalTaskId) {
      const task = await db.task.findFirst({
        where: {
          id: finalTaskId,
          deleted: false,
        },
        include: {
          workspace: {
            select: {
              id: true,
              slug: true,
              stakworkWebhookSecret: true,
            },
          },
        },
      });
      
      if (!task) {
        console.error("[StakworkWebhook] Task not found", { taskId: finalTaskId });
        return NextResponse.json(
          { success: false, error: "Task not found" },
          { status: 404 }
        );
      }
      
      workspace = task.workspace;
    }

    // Verify workspace exists and has webhook secret
    if (!workspace || !workspace.stakworkWebhookSecret) {
      console.error("[StakworkWebhook] Workspace not found or missing webhook secret", {
        workspaceId: workspace?.id,
        hasSecret: !!workspace?.stakworkWebhookSecret,
      });
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Decrypt webhook secret
    const encryptionService = EncryptionService.getInstance();
    let secret: string;
    
    try {
      secret = encryptionService.decryptField("stakworkWebhookSecret", workspace.stakworkWebhookSecret);
    } catch (error) {
      console.error("[StakworkWebhook] Failed to decrypt webhook secret", {
        workspaceId: workspace.id,
        error,
      });
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify HMAC-SHA256 signature
    if (!signature) {
      console.error("[StakworkWebhook] Missing signature header", {
        workspaceId: workspace.id,
        taskId: finalTaskId,
        runId: finalRunId,
      });
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const sigHeader = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    const expected = computeHmacSha256Hex(secret, rawBody);

    if (!timingSafeEqual(expected, sigHeader)) {
      console.error("[StakworkWebhook] Signature verification failed", {
        workspaceId: workspace.id,
        taskId: finalTaskId,
        runId: finalRunId,
      });
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    console.log("[StakworkWebhook] Signature verified", {
      workspaceId: workspace.id,
      taskId: finalTaskId,
      runId: finalRunId,
    });

    // Map status
    const workflowStatus = mapStakworkStatus(project_status);

    if (workflowStatus === null) {
      return NextResponse.json(
        {
          success: true,
          message: `Unknown status '${project_status}' - no update performed`,
          data: {
            taskId: finalTaskId,
            runId: finalRunId,
            receivedStatus: project_status,
            action: "ignored",
          },
        },
        { status: 200 }
      );
    }

    // Handle StakworkRun updates
    if (finalRunId) {
      const run = await db.stakworkRun.findFirst({
        where: {
          id: finalRunId,
        },
        include: {
          workspace: {
            select: {
              slug: true,
            },
          },
        },
      });

      if (!run) {
        console.error(`[StakworkWebhook] StakworkRun not found: ${finalRunId}`);
        return NextResponse.json({ success: false, error: "Run not found" }, { status: 404 });
      }

      const updatedRun = await db.stakworkRun.update({
        where: { id: finalRunId },
        data: {
          status: workflowStatus,
          updatedAt: new Date(),
        },
      });

      // Broadcast via Pusher
      try {
        const channelName = getWorkspaceChannelName(run.workspace.slug);
        await pusherServer.trigger(channelName, PUSHER_EVENTS.STAKWORK_RUN_UPDATE, {
          runId: finalRunId,
          type: updatedRun.type,
          status: workflowStatus,
          featureId: updatedRun.featureId,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error("[StakworkWebhook] Error broadcasting to Pusher:", error);
      }

      return NextResponse.json(
        {
          success: true,
          data: {
            runId: finalRunId,
            workflowStatus,
            previousStatus: run.status,
          },
        },
        { status: 200 }
      );
    }

    // Handle Task updates
    if (!finalTaskId) {
      return NextResponse.json(
        { success: false, error: "task_id is required for task updates" },
        { status: 400 }
      );
    }

    const task = await db.task.findFirst({
      where: {
        id: finalTaskId,
        deleted: false,
      },
    });

    if (!task) {
      console.error(`[StakworkWebhook] Task not found: ${finalTaskId}`);
      return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {
      workflowStatus,
      updatedAt: new Date(),
    };

    if (workflowStatus === WorkflowStatus.IN_PROGRESS) {
      updateData.workflowStartedAt = new Date();
    } else if (
      workflowStatus === WorkflowStatus.COMPLETED ||
      workflowStatus === WorkflowStatus.FAILED ||
      workflowStatus === WorkflowStatus.HALTED
    ) {
      updateData.workflowCompletedAt = new Date();
    }

    const updatedTask = await db.task.update({
      where: { id: finalTaskId },
      data: updateData,
    });

    try {
      const channelName = getTaskChannelName(finalTaskId);
      const eventPayload = {
        taskId: finalTaskId,
        workflowStatus,
        workflowStartedAt: updatedTask.workflowStartedAt,
        workflowCompletedAt: updatedTask.workflowCompletedAt,
        timestamp: new Date(),
      };

      await pusherServer.trigger(
        channelName,
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        eventPayload
      );
    } catch (error) {
      console.error("[StakworkWebhook] Error broadcasting to Pusher:", error);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          taskId: finalTaskId,
          workflowStatus,
          previousStatus: task.workflowStatus,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[StakworkWebhook] Error processing webhook:", error);
    return NextResponse.json(
      { success: false, error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}