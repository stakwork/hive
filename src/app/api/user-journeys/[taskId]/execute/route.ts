/**
 * User Journey Test Execution Endpoint
 *
 * Triggers Playwright test execution on a claimed pod when the play button
 * is clicked on the User Journeys page.
 *
 * Flow:
 * 1. Validate authentication and fetch task
 * 2. Claim pod from pool manager (or use CUSTOM_STAKLINK_URL for local testing)
 * 3. Generate one-time API key for webhook callback
 * 4. POST to pod control port to trigger test execution
 * 5. Update task workflowStatus to IN_PROGRESS
 * 6. Return success response with pod frontend URL
 *
 * Later, when test completes:
 * - Pod POSTs recording back to /api/tasks/[taskId]/recording webhook
 * - Recording webhook uploads video to S3 and creates artifacts
 * - API key is invalidated (one-time use)
 *
 * Local Development:
 * Set CUSTOM_STAKLINK_URL=http://localhost:PORT to bypass pod claiming
 * and test directly against a local StakLink service.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { claimPodAndGetFrontend, POD_PORTS } from "@/lib/pods";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccessById } from "@/services/workspace";
import crypto from "crypto";

export const fetchCache = "force-no-store";

const encryptionService = EncryptionService.getInstance();

export async function POST(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    // Step 1: Request Validation & Authentication
    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json({ error: "Task ID required" }, { status: 400 });
    }

    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch task with workspace, repository, and swarm relations
    const task = await db.task.findUnique({
      where: { id: taskId, deleted: false, sourceType: "USER_JOURNEY" },
      include: {
        workspace: {
          include: {
            repositories: true,
            swarm: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found or not a user journey" }, { status: 404 });
    }

    // Validate task has testFilePath
    if (!task.testFilePath) {
      return NextResponse.json({ error: "Task has no test file path" }, { status: 400 });
    }

    // Validate workspace has repository
    const repository = task.workspace.repositories[0];
    if (!repository) {
      return NextResponse.json({ error: "No repository configured for workspace" }, { status: 400 });
    }

    // Verify user has access to workspace
    const accessValidation = await validateWorkspaceAccessById(task.workspaceId, session.user.id);

    if (!accessValidation.hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check for local development mode using custom StakLink URL
    const customStakLinkUrl = process.env.CUSTOM_STAKLINK_URL;
    let controlUrl: string;
    let podPassword: string = ""; // Not needed for local development
    let frontendUrl: string | null = null;

    if (customStakLinkUrl) {
      // Local development mode - use custom StakLink URL directly
      console.log("Using CUSTOM_STAKLINK_URL for local testing:", customStakLinkUrl);
      controlUrl = customStakLinkUrl;
      frontendUrl = null; // No pod frontend in local mode
    } else {
      // Production mode - claim pod from pool manager

      // Validate workspace has swarm with pool configuration
      if (!task.workspace.swarm) {
        return NextResponse.json({ error: "No swarm found for this workspace" }, { status: 404 });
      }

      if (!task.workspace.swarm.id || !task.workspace.swarm.poolApiKey) {
        return NextResponse.json({ error: "Swarm not properly configured with pool information" }, { status: 400 });
      }

      // Step 2: Claim Pod (Reuse Existing Logic)
      const poolId = task.workspace.swarm.id || task.workspace.swarm.poolName;
      const poolApiKeyPlain = encryptionService.decryptField("poolApiKey", task.workspace.swarm.poolApiKey);

      // Get services from swarm
      const services = task.workspace.swarm.services as
        | Array<{
            name: string;
            port: number;
            scripts?: Record<string, string>;
          }>
        | null
        | undefined;

      let podResult;
      try {
        podResult = await claimPodAndGetFrontend(poolId as string, poolApiKeyPlain, services || undefined);
      } catch (error) {
        console.error("Failed to claim pod:", error);
        return NextResponse.json(
          {
            error: "Failed to claim pod",
            details: error instanceof Error ? error.message : "Unknown error",
          },
          { status: 503 },
        );
      }

      // Extract control URL and password from pod result
      controlUrl = podResult.workspace.portMappings[POD_PORTS.CONTROL];
      podPassword = podResult.workspace.password;
      frontendUrl = podResult.frontend;

      if (!controlUrl) {
        return NextResponse.json({ error: "Control port not available on claimed pod" }, { status: 500 });
      }
    }

    // Step 3: Generate One-Time API Key
    const apiKey = crypto.randomBytes(32).toString("hex");

    // Encrypt for storage (same pattern as recording webhook)
    const encryptedApiKey = encryptionService.encryptField("agentPassword", apiKey);

    // Store in database as JSON string
    await db.task.update({
      where: { id: taskId },
      data: {
        agentPassword: JSON.stringify(encryptedApiKey),
      },
    });

    // Step 4: Construct Webhook Response URL
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const responseUrl = `${baseUrl}/api/tasks/${taskId}/recording`;

    // Step 5: Extract Repository Name
    const repoName = repository.name;

    // Step 6: Trigger Test Execution on Pod
    const testPayload = {
      repoName: repoName,
      testFilePath: task.testFilePath,
      responseUrl: responseUrl,
      apiKey: apiKey, // Plain text - pod will use for webhook callback
    };
    console.log("[user-journeys] Test payload", testPayload);

    let testResponse;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Only add Authorization header if we have a pod password (production mode)
      if (podPassword) {
        headers.Authorization = `Bearer ${podPassword}`;
      }

      testResponse = await fetch(`${controlUrl}/playwright_test`, {
        method: "POST",
        headers,
        body: JSON.stringify(testPayload),
      });

      if (!testResponse.ok) {
        const errorText = await testResponse.text();
        throw new Error(`Pod returned ${testResponse.status}: ${errorText}`);
      }
    } catch (error) {
      console.error("Failed to start test execution:", error);

      // Revert task status on failure
      try {
        await db.task.update({
          where: { id: taskId },
          data: { workflowStatus: "ERROR" },
        });
      } catch (dbError) {
        console.error("Failed to update task status to ERROR:", dbError);
      }

      return NextResponse.json(
        {
          error: "Failed to start test execution",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }

    // Step 7: Update Task Status
    await db.task.update({
      where: { id: taskId },
      data: {
        workflowStatus: "IN_PROGRESS",
      },
    });

    // Step 8: Return Success Response
    return NextResponse.json(
      {
        success: true,
        data: {
          taskId: taskId,
          testFilePath: task.testFilePath,
          podStatus: customStakLinkUrl ? "local" : "claimed",
          testStatus: "running",
          frontendUrl: frontendUrl,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Unexpected error in test execution endpoint:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
