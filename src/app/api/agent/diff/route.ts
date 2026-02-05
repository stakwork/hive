import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { type ApiError } from "@/types";
import { ActionResult } from "@/lib/chat";
import { ChatRole, ChatStatus } from "@prisma/client";
import { generateAndSaveDiff } from "@/lib/pods/diff";

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
    const { workspaceId, taskId } = body;
    console.log(">>> [DIFF] Request params:", { workspaceId, taskId, userId });

    // Validate required fields
    if (!workspaceId) {
      console.log(">>> [DIFF] Missing workspaceId");
      return NextResponse.json({ error: "Missing required field: workspaceId" }, { status: 400 });
    }

    if (!taskId) {
      console.log(">>> [DIFF] Missing taskId");
      return NextResponse.json({ error: "Missing required field: taskId" }, { status: 400 });
    }

    // Fetch podId from task record
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { podId: true },
    });

    if (!task?.podId) {
      console.log(">>> [DIFF] No podId found for task:", taskId);
      return NextResponse.json({ error: "No pod assigned to this task" }, { status: 400 });
    }

    const podId = task.podId;
    console.log(">>> [DIFF] Found podId from task:", podId);

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
      console.log(">>> [DIFF] Workspace not found:", workspaceId);
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    console.log(">>> [DIFF] Workspace found:", { id: workspace.id, hasSwarm: !!workspace.swarm });

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
        message: "Changes have been applied",
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
    console.log(">>> [DIFF] Access check:", { isOwner, isMember });

    if (!isOwner && !isMember) {
      console.log(">>> [DIFF] Access denied");
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check if workspace has a swarm
    if (!workspace.swarm) {
      console.log(">>> [DIFF] No swarm found for workspace");
      return NextResponse.json({ error: "No swarm found for this workspace" }, { status: 404 });
    }

    console.log(">>> [DIFF] Generating diff using shared helper");

    // Use the shared helper to generate and save the diff
    const result = await generateAndSaveDiff({
      taskId,
      podId,
    });

    if (!result.success) {
      console.error(">>> [DIFF] Diff generation failed:", result.error);
      return NextResponse.json({ error: result.error || "Failed to fetch diff" }, { status: 500 });
    }

    if (result.noDiffs) {
      console.log(">>> [DIFF] No diffs to display");
      return NextResponse.json(
        {
          success: true,
          noDiffs: true,
        },
        { status: 200 },
      );
    }

    console.log(">>> [DIFF] Chat message with DIFF artifact created:", result.message?.id);

    return NextResponse.json(
      {
        success: true,
        message: result.message,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error(">>> [DIFF] Error fetching diff:", error);

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
