import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";
import { StakworkStatusPayload } from "@/types";
import { EncryptionService, computeHmacSha256Hex, timingSafeEqual } from "@/lib/encryption";

export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  try {
    // Extract signature header before reading body
    const signature = request.headers.get("x-stakwork-signature");
    
    if (!signature) {
      console.error("[StakworkWebhook] Missing signature header");
      return NextResponse.json(
        { error: "Missing signature" },
        { status: 401 },
      );
    }

    // Read raw body before JSON parsing (required for signature verification)
    const rawBody = await request.text();
    
    let body: StakworkStatusPayload;
    try {
      body = JSON.parse(rawBody);
    } catch (error) {
      console.error("[StakworkWebhook] Invalid JSON payload:", error);
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 },
      );
    }

    const { project_status, task_id } = body;

    const url = new URL(request.url);
    const taskIdFromQuery = url.searchParams.get("task_id");
    const finalTaskId = task_id || taskIdFromQuery;

    if (!finalTaskId) {
      console.error("[StakworkWebhook] No task_id provided");
      return NextResponse.json(
        { error: "task_id is required" },
        { status: 400 },
      );
    }

    if (!project_status) {
      console.error("[StakworkWebhook] No project_status provided");
      return NextResponse.json(
        { error: "project_status is required" },
        { status: 400 },
      );
    }

    // Lookup task and workspace with webhook secret
    const task = await db.task.findFirst({
      where: {
        id: finalTaskId,
        deleted: false,
      },
      select: {
        id: true,
        workflowStatus: true,
        workspace: {
          select: {
            id: true,
            stakworkWebhookSecret: true,
          },
        },
      },
    });

    if (!task) {
      console.error(`[StakworkWebhook] Task not found: ${finalTaskId}`);
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Verify webhook secret is configured
    if (!task.workspace.stakworkWebhookSecret) {
      console.error(`[StakworkWebhook] Webhook secret not configured for workspace ${task.workspace.id}`);
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 401 },
      );
    }

    // Decrypt the webhook secret
    const encryptionService = EncryptionService.getInstance();
    let webhookSecret: string;
    try {
      webhookSecret = encryptionService.decryptField(
        "stakworkWebhookSecret",
        task.workspace.stakworkWebhookSecret,
      );
    } catch (error) {
      console.error("[StakworkWebhook] Failed to decrypt webhook secret:", error);
      return NextResponse.json(
        { error: "Webhook authentication failed" },
        { status: 401 },
      );
    }

    // Strip signature prefix if present (e.g., "sha256=")
    const signatureValue = signature.startsWith("sha256=")
      ? signature.slice(7)
      : signature;

    // Compute expected HMAC-SHA256 signature
    const expectedSignature = computeHmacSha256Hex(webhookSecret, rawBody);

    // Perform timing-safe comparison to prevent timing attacks
    if (!timingSafeEqual(expectedSignature, signatureValue)) {
      console.error("[StakworkWebhook] Signature verification failed", {
        taskId: finalTaskId,
        workspaceId: task.workspace.id,
      });
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 },
      );
    }

    console.log("[StakworkWebhook] Signature verified successfully", {
      taskId: finalTaskId,
      workspaceId: task.workspace.id,
    });

    // Signature verified - proceed with status update
    const workflowStatus = mapStakworkStatus(project_status);

    if (workflowStatus === null) {
      return NextResponse.json(
        {
          success: true,
          message: `Unknown status '${project_status}' - no update performed`,
          data: {
            taskId: finalTaskId,
            receivedStatus: project_status,
            action: "ignored",
          },
        },
        { status: 200 },
      );
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
        eventPayload,
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
      { status: 200 },
    );
  } catch (error) {
    console.error("[StakworkWebhook] Error processing webhook:", error);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 },
    );
  }
}