import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { generateCommitMessage } from "@/lib/ai/commit-msg";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json({ error: "Missing required field: taskId" }, { status: 400 });
    }

    logger.debug(">>> Generating commit message and branch name for task:", "branch/route", { taskId });

    // Generate commit message and branch name using AI from task conversation
    const { commit_message, branch_name } = await generateCommitMessage(taskId);

    logger.debug(">>> Generated commit message:", "branch/route", { commit_message });
    logger.debug(">>> Generated branch name:", "branch/route", { branch_name });

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
    logger.error("Error generating commit message:", "branch/route", { error });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate commit message" },
      { status: 500 },
    );
  }
}
