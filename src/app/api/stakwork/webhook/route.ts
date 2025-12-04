import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeHmacSha256Hex, timingSafeEqual, EncryptionService } from "@/lib/encryption";
import { pusherServer } from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";

const encryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest) {
  try {
    // Step 1: Extract signature from header
    const signature = request.headers.get("x-stakwork-signature");
    if (!signature) {
      return NextResponse.json(
        { error: "Missing signature header" },
        { status: 401 }
      );
    }

    // Step 2: Get raw body for signature verification
    const rawBody = await request.text();
    if (!rawBody) {
      return NextResponse.json(
        { error: "Missing request body" },
        { status: 400 }
      );
    }

    // Step 3: Parse payload to extract identifying information
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    const { project_status, task_id, run_id, project_id } = payload;

    // Step 4: Validate required fields
    if (!task_id && !run_id) {
      return NextResponse.json(
        { error: "task_id or run_id required" },
        { status: 400 }
      );
    }

    // Step 5: Lookup task and workspace to get webhook secret
    const taskIdentifier = task_id || run_id;
    const task = await db.task.findUnique({
      where: { id: taskIdentifier },
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

    if (!task || !task.workspace) {
      return NextResponse.json(
        { error: "Task or workspace not found" },
        { status: 404 }
      );
    }

    // Step 6: Verify webhook signature
    if (!task.workspace.stakworkWebhookSecret) {
      return NextResponse.json(
        { error: "Webhook secret not configured for workspace" },
        { status: 500 }
      );
    }

    const webhookSecret = await encryptionService.decryptField(
      "stakworkWebhookSecret",
      task.workspace.stakworkWebhookSecret
    );

    const expectedSignature = computeHmacSha256Hex(webhookSecret, rawBody);

    if (!timingSafeEqual(expectedSignature, signature)) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // Step 7: Process webhook payload
    const workflowStatus = mapStakworkStatus(project_status);

    await db.task.update({
      where: { id: task.id },
      data: {
        workflowStatus,
        ...(project_id && { stakworkProjectId: project_id }),
      },
    });

    // Step 8: Broadcast real-time update
    await pusherServer.trigger(
      `workspace-${task.workspace.slug}`,
      "WORKSPACE_TASK_TITLE_UPDATE",
      {
        taskId: task.id,
        workflowStatus,
      }
    );

    return NextResponse.json(
      { success: true, message: "Webhook processed successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Stakwork webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
