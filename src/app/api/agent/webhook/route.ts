import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { decodeWebhookToken, verifyWebhookToken } from "@/lib/auth/agent-jwt";
import { ChatRole, ChatStatus } from "@prisma/client";
import { generateAndSaveDiff } from "@/lib/pods/diff";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

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

interface FinishPayload {
  sessionId: string;
  type: "finish";
  finishReason: string;
  totalUsage: any;
  timestamp: number;
}

type WebhookPayload = TextPayload | ToolCallPayload | ToolResultPayload | FinishPayload;

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

  // 3. Load task with workspace/swarm relations (need poolApiKey, podId for diff generation)
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      agentWebhookSecret: true,
      podId: true,
      workspace: {
        select: {
          swarm: {
            select: {
              poolApiKey: true,
            },
          },
        },
      },
    },
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

      case "finish":
        console.log(`[Webhook] Finish event received for task ${taskId}`);

        // Generate diff and broadcast via Pusher
        if (task.podId && task.workspace?.swarm?.poolApiKey) {
          try {
            const poolApiKey = encryptionService.decryptField("poolApiKey", task.workspace.swarm.poolApiKey);

            const diffResult = await generateAndSaveDiff({
              taskId,
              podId: task.podId,
              poolApiKey,
            });

            if (diffResult.success && diffResult.message) {
              // Broadcast the new message via Pusher (using NEW_MESSAGE event)
              // The payload is just the message ID - frontend fetches full message
              await pusherServer.trigger(getTaskChannelName(taskId), PUSHER_EVENTS.NEW_MESSAGE, diffResult.message.id);
              console.log(`[Webhook] Diff message broadcasted for task ${taskId}`);
            } else if (diffResult.noDiffs) {
              console.log(`[Webhook] No diffs to broadcast for task ${taskId}`);
            } else if (diffResult.error) {
              console.error(`[Webhook] Diff generation failed for task ${taskId}:`, diffResult.error);
            }
          } catch (error) {
            // Log error but don't fail the webhook - finish event is still valid
            console.error(`[Webhook] Error generating diff for task ${taskId}:`, error);
          }
        } else {
          console.log(`[Webhook] Skipping diff generation - missing podId or poolApiKey for task ${taskId}`);
        }
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
