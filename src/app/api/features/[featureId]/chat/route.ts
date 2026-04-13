import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import type { ContextTag, Artifact } from "@/lib/chat";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

interface AttachmentRequest {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * GET /api/features/[featureId]/chat
 * Load existing chat messages for a feature
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  try {
    const { featureId } = await params;

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    const userOrResponse = await requireAuthOrApiToken(request, feature.workspaceId);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const messages = await db.chatMessage.findMany({
      where: { featureId },
      include: {
        artifacts: true,
        attachments: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const clientMessages = messages.map((msg) => ({
      ...msg,
      createdBy: msg.createdBy || undefined,
      contextTags: JSON.parse(msg.contextTags as string) as ContextTag[],
      artifacts: msg.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
    }));

    return NextResponse.json({ success: true, data: clientMessages }, { status: 200 });
  } catch (error) {
    console.error("Error fetching feature chat messages:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

/**
 * POST /api/features/[featureId]/chat
 * Send a message in a feature-level conversation, triggers Stakwork workflow
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  try {
    const { featureId } = await params;

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    const userOrResponse = await requireAuthOrApiToken(request, feature.workspaceId);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { message, contextTags = [], sourceWebsocketID, webhook, replyId, history: bodyHistory, isPrototype, attachments = [] as AttachmentRequest[], model } = body;

    if (!message && attachments.length === 0) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const { chatMessage, stakworkData } = await sendFeatureChatMessage({
      featureId,
      userId: userOrResponse.id,
      message,
      contextTags,
      sourceWebsocketID,
      webhook,
      replyId,
      history: bodyHistory,
      isPrototype,
      attachments,
      model,
    });

    const clientMessage = {
      ...chatMessage,
      createdBy: chatMessage.createdBy || undefined,
      contextTags: JSON.parse(chatMessage.contextTags as string) as ContextTag[],
      artifacts: chatMessage.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
    };

    return NextResponse.json(
      {
        success: true,
        message: clientMessage,
        workflow: stakworkData?.data,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating feature chat message:", error);
    const msg = error instanceof Error ? error.message : "Failed to create message";
    const status = msg.includes("already running") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
