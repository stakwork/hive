import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { generateCommitMessage } from "@/lib/ai/commit-msg";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const body = await request.json();
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json({ error: "Missing required field: taskId" }, { status: 400 });
    }

    // IDOR guard: generateCommitMessage reads the full chat history for
    // the task and returns an AI summary. Without a membership check any
    // signed-in user can exfiltrate any task's private conversation.
    // Resolve the task's workspace and verify the caller is an owner or
    // active member before invoking the AI summarizer.
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: {
        workspace: {
          select: {
            ownerId: true,
            members: {
              where: { userId, leftAt: null },
              select: { userId: true },
            },
          },
        },
      },
    });

    const isOwner = task?.workspace.ownerId === userId;
    const isMember = (task?.workspace.members.length ?? 0) > 0;
    if (!task || (!isOwner && !isMember)) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    console.log(">>> Generating commit message and branch name for task:", taskId);

    // Get the base URL from the request
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("host");
    const baseUrl = host ? `${protocol}://${host}` : undefined;

    // Generate commit message and branch name using AI from task conversation
    const { commit_message, branch_name } = await generateCommitMessage(taskId, baseUrl);

    console.log(">>> Generated commit message:", commit_message);
    console.log(">>> Generated branch name:", branch_name);

    return NextResponse.json(
      {
        success: true,
        data: {
          commit_message,
          branch_name,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error generating commit message:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate commit message" },
      { status: 500 },
    );
  }
}
