import { NextRequest, NextResponse } from "next/server";
import { GraphWebhookService } from "@/services/swarm/GraphWebhookService";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";

const webhookService = new GraphWebhookService();

export async function POST(request: NextRequest) {
  try {
    // Step 1: Extract signature header and raw body
    const signature = request.headers.get("x-signature");
    
    if (!signature) {
      console.error("[GraphWebhook] Missing x-signature header");
      return NextResponse.json(
        { error: "Missing signature header" },
        { status: 400 }
      );
    }

    // CRITICAL: Get raw body BEFORE any JSON parsing for accurate HMAC computation
    const rawBody = await request.text();
    
    // Parse payload after capturing raw body
    let payload: {
      swarmId?: string;
      testFilePath?: string;
      status?: string;
      error?: string;
      [key: string]: unknown;
    };
    
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      console.error("[GraphWebhook] Invalid JSON payload:", error);
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    // Step 2: Validate required payload fields
    if (!payload.swarmId) {
      console.error("[GraphWebhook] Missing swarmId in payload");
      return NextResponse.json(
        { error: "Missing swarmId in payload" },
        { status: 400 }
      );
    }

    // Step 3: Lookup swarm and verify HMAC signature
    const swarm = await webhookService.lookupAndVerifySwarm(
      payload.swarmId,
      signature,
      rawBody
    );

    if (!swarm) {
      // Verification failed - could be invalid signature, missing secret, or swarm not found
      console.error(
        `[GraphWebhook] Signature verification failed for swarm: ${payload.swarmId}`
      );
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Signature verified successfully - process webhook event
    console.log(`[GraphWebhook] Verified webhook for swarm: ${swarm.id}`);

    // Process the webhook payload based on event type
    if (payload.testFilePath) {
      // Handle test execution status update
      await handleTestStatusUpdate(payload, swarm.workspaceId);
    }

    return NextResponse.json({
      success: true,
      message: "Webhook processed successfully",
    });
  } catch (error) {
    console.error("[GraphWebhook] Error processing webhook:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Handle test execution status updates from Graph webhook.
 * Updates task workflowStatus based on test results.
 */
async function handleTestStatusUpdate(
  payload: {
    testFilePath?: string;
    status?: string;
    error?: string;
    [key: string]: unknown;
  },
  workspaceId: string
) {
  const { testFilePath, status, error } = payload;

  if (!testFilePath) {
    return;
  }

  try {
    // Find task by testFilePath
    const task = await db.task.findFirst({
      where: {
        workspaceId,
        testFilePath,
        sourceType: "USER_JOURNEY",
      },
    });

    if (!task) {
      console.warn(
        `[GraphWebhook] No task found for testFilePath: ${testFilePath}`
      );
      return;
    }

    // Map test status to workflowStatus
    let workflowStatus: WorkflowStatus = WorkflowStatus.PENDING;
    
    if (status === "success" || status === "passed") {
      workflowStatus = WorkflowStatus.COMPLETED;
    } else if (status === "failed" || status === "error") {
      workflowStatus = WorkflowStatus.FAILED;
    } else if (status === "running" || status === "in_progress") {
      workflowStatus = WorkflowStatus.IN_PROGRESS;
    }

    // Update task workflowStatus
    await db.task.update({
      where: { id: task.id },
      data: {
        workflowStatus,
      },
    });

    console.log(
      `[GraphWebhook] Updated task ${task.id} workflowStatus to ${workflowStatus}`
    );
  } catch (error) {
    console.error(
      `[GraphWebhook] Error updating task status for ${testFilePath}:`,
      error
    );
  }
}