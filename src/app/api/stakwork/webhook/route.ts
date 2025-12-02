import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapStakworkStatus } from "@/utils/conversions";
import { pusherServer } from "@/lib/pusher";
import { PUSHER_EVENTS } from "@/lib/pusher";
import { computeHmacSha256Hex, timingSafeEqual } from "@/lib/encryption";

interface StakworkStatusPayload {
  task_id?: string;
  run_id?: string;
  project_status: string;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Verify webhook signature for authentication
    const signature = request.headers.get("x-stakwork-signature");
    if (!signature) {
      console.error("Stakwork webhook: Missing signature header");
      return NextResponse.json(
        { error: "Unauthorized: Missing signature" },
        { status: 401 }
      );
    }

    // 2. Get raw request body for signature verification
    const rawBody = await request.text();
    
    // 3. Verify the webhook secret is configured
    const webhookSecret = process.env.STAKWORK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("Stakwork webhook: STAKWORK_WEBHOOK_SECRET not configured");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // 4. Compute expected signature
    const expectedSignature = computeHmacSha256Hex(webhookSecret, rawBody);

    // 5. Timing-safe comparison to prevent timing attacks
    if (!timingSafeEqual(expectedSignature, signature)) {
      console.error("Stakwork webhook: Invalid signature");
      return NextResponse.json(
        { error: "Unauthorized: Invalid signature" },
        { status: 401 }
      );
    }

    // 6. Parse the validated request body
    let payload: StakworkStatusPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      console.error("Stakwork webhook: Invalid JSON payload", error);
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    const { task_id, run_id, project_status } = payload;

    // Validate required fields
    if (!project_status) {
      return NextResponse.json(
        { error: "Missing project_status" },
        { status: 400 }
      );
    }

    if (!task_id && !run_id) {
      return NextResponse.json(
        { error: "Missing task_id or run_id" },
        { status: 400 }
      );
    }

    // Map external status to internal WorkflowStatus enum
    const workflowStatus = mapStakworkStatus(project_status);

    // Validate mapped status
    if (!workflowStatus) {
      return NextResponse.json(
        { error: "Invalid or unsupported project_status" },
        { status: 400 }
      );
    }

    // Handle task status update
    if (task_id) {
      const task = await db.task.findUnique({
        where: { id: task_id },
        include: { workspace: true },
      });

      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      // Update task workflow status
      const updatedTask = await db.task.update({
        where: { id: task_id },
        data: {
          workflowStatus,
        },
      });

      // Broadcast real-time update to workspace subscribers
      await pusherServer.trigger(
        `workspace-${task.workspace.slug}`,
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        {
          taskId: task_id,
          workflowStatus,
          updatedAt: updatedTask.updatedAt,
        }
      );

      return NextResponse.json({
        success: true,
        taskId: task_id,
        workflowStatus,
      });
    }

    // Handle StakworkRun status update
    if (run_id) {
      const run = await db.stakworkRun.findUnique({
        where: { id: run_id },
        include: { workspace: true },
      });

      if (!run) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }

      // Update run status
      const updatedRun = await db.stakworkRun.update({
        where: { id: run_id },
        data: {
          status: workflowStatus,
          updatedAt: new Date(),
        },
      });

      // Broadcast real-time update to workspace subscribers
      await pusherServer.trigger(
        `workspace-${run.workspace.slug}`,
        PUSHER_EVENTS.STAKWORK_RUN_UPDATE,
        {
          runId: run_id,
          status: workflowStatus,
          updatedAt: updatedRun.updatedAt,
        }
      );

      return NextResponse.json({
        success: true,
        runId: run_id,
        status: workflowStatus,
      });
    }

    return NextResponse.json(
      { error: "Unexpected error" },
      { status: 500 }
    );
  } catch (error) {
    console.error("Stakwork webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
