import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { decodeWebhookToken, verifyWebhookToken } from "@/lib/auth/agent-jwt";
import { ChatRole, ChatStatus } from "@prisma/client";

const encryptionService = EncryptionService.getInstance();

// Webhook payload types from remote server
interface TextPayload {
  sessionId: string;
  type: "text";
  id: string;
  text: string;
  timestamp: number;
}

interface ToolCallPayload {
  sessionId: string;
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
  timestamp: number;
}

interface ToolResultPayload {
  sessionId: string;
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
  timestamp: number;
}

type WebhookPayload = TextPayload | ToolCallPayload | ToolResultPayload;

export async function POST(request: NextRequest) {
  // 1. Extract token from query params
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    console.log("[Webhook] Missing token in request");
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  // 2. Decode JWT to get taskId (unverified, just to load the secret)
  const decoded = decodeWebhookToken(token);
  if (!decoded) {
    console.log("[Webhook] Failed to decode token");
    return NextResponse.json({ error: "Invalid token format" }, { status: 400 });
  }

  const { taskId } = decoded;
  console.log("[Webhook] Processing request for taskId:", taskId);

  // 3. Load task and get webhook secret
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { agentWebhookSecret: true },
  });

  if (!task || !task.agentWebhookSecret) {
    console.log("[Webhook] Task not found or no webhook secret:", { taskId, hasTask: !!task });
    return NextResponse.json({ error: "Task not found or not configured" }, { status: 404 });
  }

  // 4. Decrypt secret and verify JWT
  let webhookSecret: string;
  try {
    webhookSecret = encryptionService.decryptField("agentWebhookSecret", task.agentWebhookSecret);
  } catch (error) {
    console.error("[Webhook] Failed to decrypt webhook secret:", error);
    return NextResponse.json({ error: "Failed to decrypt webhook secret" }, { status: 500 });
  }

  const verified = await verifyWebhookToken(token, webhookSecret);
  if (!verified) {
    console.log("[Webhook] Token verification failed for taskId:", taskId);
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  console.log("[Webhook] Token verified successfully for taskId:", taskId);

  // 5. Parse and validate body
  const body: WebhookPayload = await request.json();

  // Validate sessionId matches taskId
  if (body.sessionId !== taskId) {
    return NextResponse.json({ error: "Session ID mismatch" }, { status: 400 });
  }

  // 6. Persist based on type
  try {
    switch (body.type) {
      case "text":
        await db.chatMessage.create({
          data: {
            taskId,
            message: body.text,
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
          },
        });
        break;

      case "tool-call":
      case "tool-result":
        // TODO: Store as TOOL_USE artifact in future PR (FIXME: not implemented)
        // For now, just log
        console.log(`[Webhook] Tool event received for task ${taskId}:`, {
          type: body.type,
          toolName: body.type === "tool-call" ? body.toolName : undefined,
          toolCallId: body.toolCallId,
        });
        break;

      default:
        console.log(`[Webhook] Unknown event type for task ${taskId}:`, body);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Webhook] Error persisting message:", error);
    return NextResponse.json({ error: "Failed to persist message" }, { status: 500 });
  }
}
