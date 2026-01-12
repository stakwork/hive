import { NextRequest, NextResponse } from "next/server";
import { type ModelMessage } from "ai";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { extractTaskFromTranscript } from "@/lib/ai/extract-task";
import { db } from "@/lib/db";
import { createTaskWithStakworkWorkflow } from "@/services/task-workflow";
import { Priority } from "@prisma/client";

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { workspaceSlug, transcript } = body as {
      workspaceSlug: string;
      transcript: string | ModelMessage[];
    };

    if (!workspaceSlug || !transcript) {
      return NextResponse.json({ error: "Missing required fields: workspaceSlug, transcript" }, { status: 400 });
    }

    // Validate transcript is either a non-empty string or non-empty array
    const isValidString = typeof transcript === "string" && transcript.trim().length > 0;
    const isValidArray = Array.isArray(transcript) && transcript.length > 0;

    if (!isValidString && !isValidArray) {
      return NextResponse.json(
        { error: "Transcript must be a non-empty string or ModelMessage array" },
        { status: 400 },
      );
    }

    // Get workspace ID from slug
    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    console.log("🎤 Creating task from voice transcript:", {
      workspaceSlug,
      transcriptLength: typeof transcript === "string" ? transcript.length : `${transcript.length} messages`,
      isMessageArray: Array.isArray(transcript),
      userId: userOrResponse.id,
    });

    // Extract task specifications from transcript using AI
    const extractedTask = await extractTaskFromTranscript(transcript, workspaceSlug);

    // Create task and immediately trigger Stakwork workflow
    const result = await createTaskWithStakworkWorkflow({
      title: extractedTask.title,
      description: extractedTask.description,
      workspaceId: workspace.id,
      priority: Priority.HIGH, // HIGH priority for voice-created tasks
      sourceType: "USER",
      userId: userOrResponse.id,
      mode: "live", // Immediately trigger AI workflow
    });

    console.log("✅ Task created from voice:", {
      taskId: result.task.id,
      title: result.task.title,
      workflowStatus: result.task.workflowStatus,
    });

    return NextResponse.json(
      {
        success: true,
        taskId: result.task.id,
        workspaceId: result.task.workspaceId,
        title: result.task.title,
        description: result.task.description,
        workflowStatus: result.task.workflowStatus,
        stakworkProjectId: result.stakworkResult?.data?.project_id || null,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("❌ Error creating task from voice:", error);
    const message = error instanceof Error ? error.message : "Failed to create task from voice";
    const status = message.includes("denied")
      ? 403
      : message.includes("not found") || message.includes("required")
        ? 400
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
