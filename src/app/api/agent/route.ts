/**
 * Agent V2 Session Broker
 *
 * This endpoint acts as a session broker between the frontend and a remote agent server.
 * Instead of proxying the stream through Hive, the frontend connects directly to the
 * remote server for streaming, while Hive handles authentication and message persistence.
 *
 * ## Architecture
 *
 * ```
 * ┌──────────┐  1. POST /api/agent    ┌──────────┐  2. POST /session     ┌──────────────┐
 * │ Frontend │ ────────────────────>  │   Hive   │ ──────────────────>   │ Agent Server │
 * │          │ <────────────────────  │ Backend  │ <──────────────────   │              │
 * │          │  { streamUrl, token }  │          │   { token }           │              │
 * │          │                        │          │                       │              │
 * │          │  3. POST /stream/:id   │          │                       │              │
 * │          │ ─────────────────────────────────────────────────────>    │              │
 * │          │ <═══════════════════════════════════════════════════════  │              │
 * │          │      (SSE stream)      │          │                       │              │
 * │          │                        │          │  4. POST /webhook     │              │
 * │          │                        │          │ <──────────────────   │              │
 * └──────────┘                        └──────────┘   (persist msgs)      └──────────────┘
 * ```
 *
 * ## Flow
 *
 * 1. **Frontend → Hive** (`POST /api/agent`):
 *    - Authenticates user session
 *    - Generates/retrieves webhook secret for the task
 *    - Creates JWT-signed webhook URL (10-min expiry)
 *    - Calls remote server to create/refresh session
 *    - Returns `{ streamUrl, streamToken, resume }` to frontend
 *
 * 2. **Hive → Agent Server** (`POST /session`):
 *    - Sends `{ sessionId, webhookUrl }` to create/refresh session
 *    - Receives `{ token }` for stream authentication
 *
 * 3. **Frontend → Agent Server** (`POST /stream/:sessionId`):
 *    - Direct SSE connection with `{ prompt, resume?: true }`
 *    - `resume: true` tells server to reload existing session context
 *
 * 4. **Agent Server → Hive** (`POST /api/agent/webhook`):
 *    - JWT-authenticated webhook for message persistence
 *    - Receives final text/tool events to store in database
 *
 * ## Environment Variables
 *
 * - `CUSTOM_GOOSE_URL`: Override agent URL for local development (bypasses auth requirement)
 * - `NEXTAUTH_URL`: Base URL for webhook callback
 *
 * ## Database Fields (Task model)
 *
 * - `agentUrl`: Remote agent server URL
 * - `agentPassword`: Encrypted auth token for agent server
 * - `agentWebhookSecret`: Encrypted per-task secret for JWT signing
 */

import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { ChatRole, ChatStatus, ArtifactType } from "@prisma/client";
import { createWebhookToken, generateWebhookSecret } from "@/lib/auth/agent-jwt";

const encryptionService = EncryptionService.getInstance();

interface ArtifactRequest {
  type: ArtifactType;
  content?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { message, taskId, artifacts = [] } = body;

  // 1. Authenticate user
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  // 2. Load task and check for existing messages
  const [task, messageCount] = await Promise.all([
    db.task.findUnique({
      where: { id: taskId },
      select: {
        agentUrl: true,
        agentPassword: true,
        agentWebhookSecret: true,
        mode: true,
      },
    }),
    db.chatMessage.count({
      where: { taskId },
    }),
  ]);

  // If there are existing messages, this is a resume
  const isResume = messageCount > 0;

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.mode !== "agent") {
    return NextResponse.json({ error: "Task is not in agent mode" }, { status: 400 });
  }

  // 3. Determine agent URL (support CUSTOM_GOOSE_URL for local dev)
  const agentUrl = process.env.CUSTOM_GOOSE_URL || task.agentUrl;

  if (!agentUrl) {
    return NextResponse.json({ error: "Agent URL not configured" }, { status: 400 });
  }

  // For custom URL, password is optional (local dev)
  const requiresAuth = !process.env.CUSTOM_GOOSE_URL;

  if (requiresAuth && !task.agentPassword) {
    return NextResponse.json({ error: "Agent password not configured" }, { status: 400 });
  }

  // 4. Decrypt agent password
  const agentPassword = task.agentPassword ? encryptionService.decryptField("agentPassword", task.agentPassword) : null;

  // 5. Handle webhook secret (generate if not exists)
  let webhookSecret: string;

  if (task.agentWebhookSecret) {
    webhookSecret = encryptionService.decryptField("agentWebhookSecret", task.agentWebhookSecret);
  } else {
    webhookSecret = generateWebhookSecret();
    const encryptedSecret = encryptionService.encryptField("agentWebhookSecret", webhookSecret);
    await db.task.update({
      where: { id: taskId },
      data: {
        agentWebhookSecret: JSON.stringify(encryptedSecret),
      },
    });
  }

  // 6. Create webhook JWT and URL
  const webhookToken = await createWebhookToken(taskId, webhookSecret);
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const webhookUrl = `${baseUrl}/api/agent/webhook?token=${webhookToken}`;

  // 7. Call remote server POST /session
  const sessionUrl = agentUrl.replace(/\/$/, "") + "/session";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (agentPassword) {
    headers["Authorization"] = `Bearer ${agentPassword}`;
  }

  let streamToken: string;

  try {
    console.log("[Agent]", isResume ? "Resuming" : "Creating", "session for taskId:", taskId);
    console.log("[Agent] agentUrl:", agentUrl, "sessionUrl:", sessionUrl);
    console.log("[Agent] task.agentUrl:", task.agentUrl, "CUSTOM_GOOSE_URL:", process.env.CUSTOM_GOOSE_URL);

    const sessionResponse = await fetch(sessionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId: taskId, // taskId IS the sessionId
        webhookUrl,
      }),
    });

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      console.error("[Agent] Session creation failed:", sessionResponse.status, errorText);
      return NextResponse.json({ error: "Failed to create agent session" }, { status: 502 });
    }

    const sessionData = await sessionResponse.json();
    streamToken = sessionData.token;

    if (!streamToken) {
      return NextResponse.json({ error: "No stream token returned from agent" }, { status: 502 });
    }
  } catch (error) {
    console.error("[Agent] Error connecting to remote server:", error);
    return NextResponse.json({ error: "Failed to connect to agent server" }, { status: 502 });
  }

  // 8. Save user message to database
  try {
    await db.chatMessage.create({
      data: {
        taskId,
        message,
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        artifacts: {
          create: artifacts.map((artifact: ArtifactRequest) => ({
            type: artifact.type,
            content: artifact.content,
          })),
        },
      },
    });
  } catch (error) {
    console.error("[Agent] Error saving user message:", error);
    // Non-fatal, continue anyway
  }

  // 9. Return connection info to frontend
  const streamUrl = agentUrl.replace(/\/$/, "") + `/stream/${taskId}`;

  return NextResponse.json({
    success: true,
    sessionId: taskId,
    streamToken,
    streamUrl,
    resume: isResume,
  });
}
