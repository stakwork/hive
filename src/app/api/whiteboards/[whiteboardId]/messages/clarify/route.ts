import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { createDiagramStakworkRun } from "@/services/stakwork-run";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const user = userOrResponse;

    const { whiteboardId } = await params;
    const body = await request.json();

    if (!body.answers || typeof body.answers !== "string") {
      return NextResponse.json({ error: "Answers are required" }, { status: 400 });
    }

    // Fetch whiteboard with workspace access check and feature data
    const whiteboard = await db.whiteboard.findUnique({
      where: { id: whiteboardId },
      include: {
        workspace: {
          select: {
            id: true,
            ownerId: true,
            members: {
              where: { userId: user.id },
              select: { role: true },
            },
          },
        },
        feature: {
          select: {
            id: true,
            architecture: true,
            workspaceId: true,
          },
        },
      },
    });

    if (!whiteboard) {
      return NextResponse.json({ error: "Whiteboard not found" }, { status: 404 });
    }

    // Check workspace access
    const isOwner = whiteboard.workspace.ownerId === user.id;
    const isMember = whiteboard.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Guard against concurrent diagram generation
    const activeGeneration = await db.stakworkRun.findFirst({
      where: {
        OR: [
          ...(whiteboard.featureId ? [{ featureId: whiteboard.featureId }] : []),
          { webhookUrl: { contains: `whiteboard_id=${whiteboardId}` } },
        ],
        type: "DIAGRAM_GENERATION",
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      select: { id: true },
    });

    if (activeGeneration) {
      return NextResponse.json(
        { error: "Diagram generation in progress", generating: true },
        { status: 409 }
      );
    }

    // Find the last ASSISTANT message with pending clarifying questions
    const pendingClarification = await db.whiteboardMessage.findFirst({
      where: {
        whiteboardId,
        role: "ASSISTANT",
      },
      orderBy: { createdAt: "desc" },
    });

    const metadata = pendingClarification?.metadata as Record<string, unknown> | null;
    if (!pendingClarification || metadata?.tool_use !== "ask_clarifying_questions") {
      return NextResponse.json(
        { error: "No pending clarifying questions found" },
        { status: 400 }
      );
    }

    // Find the last USER message before the clarifying questions message (original prompt)
    const originalPromptMessage = await db.whiteboardMessage.findFirst({
      where: {
        whiteboardId,
        role: "USER",
        createdAt: { lt: pendingClarification.createdAt },
      },
      orderBy: { createdAt: "desc" },
    });

    const originalPrompt = originalPromptMessage?.content ?? "";

    // Persist USER message with the formatted answers
    const message = await db.whiteboardMessage.create({
      data: {
        whiteboardId,
        role: "USER",
        content: body.answers,
        status: "SENT",
        userId: user.id,
      },
    });

    // Build enriched architectureText: original prompt + answers
    const enrichedPrompt = originalPrompt
      ? `${originalPrompt}\n\nAnswers to clarifying questions:\n${body.answers}`
      : body.answers;

    const architectureText =
      whiteboard.featureId && whiteboard.feature?.architecture
        ? `Architecture:\n${whiteboard.feature.architecture}\n\nUser request:\n${enrichedPrompt}`
        : enrichedPrompt;

    const layout = body.layout || "layered";

    const run = await createDiagramStakworkRun({
      workspaceId: whiteboard.featureId
        ? whiteboard.feature!.workspaceId
        : whiteboard.workspace.id,
      featureId: whiteboard.featureId ?? undefined,
      whiteboardId,
      architectureText,
      layout,
      userId: user.id,
      currentMessageId: message.id,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          message,
          runId: run.id,
        },
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error submitting clarifying answers:", error);
    return NextResponse.json(
      { error: "Failed to submit answers" },
      { status: 500 }
    );
  }
}
