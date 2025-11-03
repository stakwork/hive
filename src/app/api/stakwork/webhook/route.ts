import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";
import { StakworkStatusPayload } from "@/types";
import { computeHmacSha256Hex, timingSafeEqual } from "@/lib/encryption";

export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  try {
    // Extract signature header for HMAC verification
    const signature = request.headers.get("x-signature");
    if (!signature) {
      console.error("[StakworkWebhook] Missing signature header");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    // Load webhook secret from environment
    const secret = process.env.STAKWORK_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[StakworkWebhook] STAKWORK_WEBHOOK_SECRET not configured");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    // Read raw body for HMAC computation (must be done before JSON parsing)
    const rawBody = await request.text();

    // Parse JSON payload
    let body: StakworkStatusPayload;
    try {
      body = JSON.parse(rawBody) as StakworkStatusPayload;
    } catch (error) {
      console.error("[StakworkWebhook] Invalid JSON payload", { error });
      return NextResponse.json(
        { error: "Invalid JSON" },
        { status: 400 },
      );
    }

    // Verify HMAC signature
    const sigHeader = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    const expected = computeHmacSha256Hex(secret, rawBody);

    if (!timingSafeEqual(expected, sigHeader)) {
      console.error("[StakworkWebhook] Signature verification failed", {
        taskId: body.task_id,
        signature: "redacted",
      });
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    console.log("[StakworkWebhook] Signature verified successfully", {
      taskId: body.task_id,
    });

    const { project_status, task_id } = body;

    const url = new URL(request.url);
    const taskIdFromQuery = url.searchParams.get("task_id");
    const finalTaskId = task_id || taskIdFromQuery;

    if (!finalTaskId) {
      console.error("No task_id provided in webhook");
      return NextResponse.json(
        { error: "task_id is required" },
        { status: 400 },
      );
    }

    if (!project_status) {
      console.error("No project_status provided in webhook");
      return NextResponse.json(
        { error: "project_status is required" },
        { status: 400 },
      );
    }

    const task = await db.task.findFirst({
      where: {
        id: finalTaskId,
        deleted: false,
      },
    });

    if (!task) {
      console.error(`Task not found: ${finalTaskId}`);
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

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
      console.error("Error broadcasting to Pusher:", error);
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
    console.error("Error processing Stakwork webhook:", error);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 },
    );
  }
}
