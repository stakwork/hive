import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { type ApiError } from "@/types";
import { getPodFromPool, POD_PORTS } from "@/lib/pods";
import { ActionResult } from "@/lib/chat";
import { logger } from "@/lib/logger";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest) {
  try {
    console.log(">>> [DIFF] Starting diff request");
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      console.log(">>> [DIFF] No user session found");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      console.log(">>> [DIFF] Invalid user session - no userId");
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const body = await request.json();
    const { podId, workspaceId, taskId } = body;
    logger.debug(">>> [DIFF] Request params:", {  podId, workspaceId, taskId, userId  });

    // Validate required fields
    if (!podId) {
      console.log(">>> [DIFF] Missing podId");
      return NextResponse.json({ error: "Missing required field: podId" }, { status: 400 });
    }

    if (!workspaceId) {
      console.log(">>> [DIFF] Missing workspaceId");
      return NextResponse.json({ error: "Missing required field: workspaceId" }, { status: 400 });
    }

    if (!taskId) {
      console.log(">>> [DIFF] Missing taskId");
      return NextResponse.json({ error: "Missing required field: taskId" }, { status: 400 });
    }

    // Verify user has access to the workspace
    const workspace = await db.workspace.findFirst({
      where: { id: workspaceId },
      include: {
        owner: true,
        members: {
          where: { userId },
          select: { role: true },
        },
        swarm: true,
      },
    });

    if (!workspace) {
      logger.debug(">>> [DIFF] Workspace not found:", { workspaceId });
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    logger.debug(">>> [DIFF] Workspace found:", {  id: workspace.id, hasSwarm: !!workspace.swarm  });

    if (process.env.MOCK_BROWSER_URL || process.env.CUSTOM_GOOSE_URL) {
      console.log(">>> [DIFF] Using mock mode");
      // Mock diff data for testing - create a proper message structure
      const mockDiff: ActionResult[] = [
        {
          file: "example.ts",
          action: "modify",
          content: `diff --git a/example.ts b/example.ts
index 1234567..abcdefg 100644
--- a/example.ts
+++ b/example.ts
@@ -1,3 +1,3 @@
-const old = "old value";
+const new = "new value";
 console.log("test");`,
          repoName: "test/repo",
        },
      ];

      const mockMessage = {
        id: "mock-message-id",
        taskId,
        message: "Diff retrieved successfully (mock)",
        role: ChatRole.ASSISTANT,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        workflowUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        artifacts: [
          {
            id: "mock-artifact-id",
            messageId: "mock-message-id",
            type: "DIFF" as const,
            content: { diffs: mockDiff },
            icon: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        attachments: [],
      };

      return NextResponse.json({ success: true, message: mockMessage }, { status: 200 });
    }

    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;
    logger.debug(">>> [DIFF] Access check:", {  isOwner, isMember  });

    if (!isOwner && !isMember) {
      console.log(">>> [DIFF] Access denied");
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check if workspace has a swarm
    if (!workspace.swarm) {
      console.log(">>> [DIFF] No swarm found for workspace");
      return NextResponse.json({ error: "No swarm found for this workspace" }, { status: 404 });
    }

    const poolApiKey = workspace.swarm.poolApiKey;

    // Check if swarm has pool configuration
    if (!poolApiKey) {
      console.log(">>> [DIFF] Swarm not configured with pool API key");
      return NextResponse.json({ error: "Swarm not properly configured with pool information" }, { status: 400 });
    }

    const poolApiKeyPlain = encryptionService.decryptField("poolApiKey", poolApiKey);

    logger.debug(">>> [DIFF] Getting pod from pool, podId:", "diff/route", { podId });

    // Fetch pod details to get port mappings and password
    let podWorkspace;
    try {
      podWorkspace = await getPodFromPool(podId, poolApiKeyPlain);
      logger.debug(">>> [DIFF] Pod workspace retrieved:", { 
        id: podWorkspace.id,
        state: podWorkspace.state,
        hasControlPort: !!podWorkspace.portMappings[POD_PORTS.CONTROL],
       });
    } catch (error) {
      logger.error(">>> [DIFF] Failed to get pod from pool:", { error });
      throw error;
    }

    const controlPortUrl = podWorkspace.portMappings[POD_PORTS.CONTROL];

    if (!controlPortUrl) {
      console.log(">>> [DIFF] Control port not found in port mappings");
      return NextResponse.json(
        { error: `Control port (${POD_PORTS.CONTROL}) not found in port mappings` },
        { status: 500 },
      );
    }

    logger.debug(">>> [DIFF] Fetching diff from control port:", { controlPortUrl });

    // GET /diff from the control port
    const diffUrl = `${controlPortUrl}/diff`;
    const diffResponse = await fetch(diffUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${podWorkspace.password}`,
      },
    });

    if (!diffResponse.ok) {
      const errorText = await diffResponse.text();
      logger.error(`>>> [DIFF] Failed to fetch diff: ${diffResponse.status} - ${errorText}`);
      return NextResponse.json(
        { error: `Failed to fetch diff: ${diffResponse.status}`, details: errorText },
        { status: diffResponse.status },
      );
    }

    const diffs: ActionResult[] = await diffResponse.json();
    logger.debug(">>> [DIFF] Diff fetched successfully, count:", "diff/route", { count: diffs.length });

    // If there are no diffs, don't create an artifact
    if (!diffs || diffs.length === 0) {
      console.log(">>> [DIFF] No diffs to display, skipping artifact creation");
      return NextResponse.json(
        {
          success: true,
          noDiffs: true,
        },
        { status: 200 },
      );
    }

    console.log(">>> [DIFF] Creating chat message with DIFF artifact");

    // Create a chat message with the DIFF artifact
    const chatMessage = await db.chatMessage.create({
      data: {
        taskId,
        message: "Diff retrieved successfully",
        role: ChatRole.ASSISTANT,
        contextTags: JSON.stringify([]),
        status: ChatStatus.SENT,
        artifacts: {
          create: [
            {
              type: "DIFF",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              content: { diffs } as any,
            },
          ],
        },
      },
      include: {
        artifacts: true,
      },
    });

    logger.debug(">>> [DIFF] Chat message with DIFF artifact created:", { id: chatMessage.id });

    return NextResponse.json(
      {
        success: true,
        message: chatMessage,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error(">>> [DIFF] Error fetching diff:", { error });

    // Handle ApiError specifically
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          error: apiError.message,
          service: apiError.service,
          details: apiError.details,
        },
        { status: apiError.status },
      );
    }

    return NextResponse.json({ error: "Failed to fetch diff" }, { status: 500 });
  }
}
