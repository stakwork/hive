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
 *    - Claims pod if needed (new task or pod was released)
 *    - Generates/retrieves webhook secret for the task
 *    - Creates JWT-signed webhook URL (10-min expiry)
 *    - Calls remote server to create/refresh session
 *    - Returns `{ streamUrl, streamToken, resume, podUrls? }` to frontend
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
 * - `podId`: ID of the claimed pod
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
import { isValidModel, getApiKeyForModel, type ModelName } from "@/lib/ai/models";
import { claimPodAndGetFrontend, updatePodRepositories, POD_PORTS } from "@/lib/pods";

const encryptionService = EncryptionService.getInstance();

// ============================================================================
// Types
// ============================================================================

interface ChatHistoryMessage {
  role: string;
  message: string;
  timestamp: string;
  artifacts?: Array<{
    type: ArtifactType;
    content: Record<string, unknown> | null;
  }>;
}

interface ArtifactRequest {
  type: ArtifactType;
  content?: Record<string, unknown>;
}

interface AgentCredentials {
  agentUrl: string;
  agentPassword: string | null;
}

interface PodClaimResult {
  podId: string;
  frontend: string;
  ide: string;
  credentials: AgentCredentials;
}

interface ServiceInfo {
  name: string;
  port: number;
  scripts?: Record<string, string>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Fetch chat history for a task
 */
async function fetchChatHistory(taskId: string): Promise<ChatHistoryMessage[]> {
  const chatHistory = await db.chatMessage.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    select: {
      message: true,
      role: true,
      createdAt: true,
      artifacts: {
        where: {
          type: ArtifactType.LONGFORM,
        },
        select: {
          type: true,
          content: true,
        },
      },
    },
  });

  return chatHistory.map((msg) => ({
    role: msg.role,
    message: msg.message,
    timestamp: msg.createdAt.toISOString(),
    artifacts:
      msg.artifacts.length > 0
        ? (msg.artifacts as ChatHistoryMessage["artifacts"])
        : undefined,
  }));
}

/**
 * Format chat history into a prompt context string
 */
function formatChatHistoryForPrompt(history: ChatHistoryMessage[]): string {
  const formattedMessages = history.map((msg) => {
    const role = msg.role === "USER" ? "User" : "Assistant";
    let messageText = `${role}: ${msg.message}`;

    if (msg.artifacts && msg.artifacts.length > 0) {
      const artifactTexts = msg.artifacts
        .map((artifact) => {
          if (!artifact.content) return null;
          const content = artifact.content;
          return content.text || content.content || JSON.stringify(content);
        })
        .filter(Boolean);

      if (artifactTexts.length > 0) {
        messageText += `\n\nArtifacts:\n${artifactTexts.join("\n---\n")}`;
      }
    }

    return messageText;
  });

  return `Here is the previous conversation history for context:\n\n${formattedMessages.join("\n\n")}\n\n---\n\nContinuing the conversation:`;
}

/**
 * Get chat history formatted for prompt if messages exist
 */
async function getChatHistoryContext(taskId: string): Promise<string | null> {
  const chatHistory = await fetchChatHistory(taskId);
  if (chatHistory.length > 0) {
    return formatChatHistoryForPrompt(chatHistory);
  }
  return null;
}

/**
 * Claim a pod for a task and store credentials
 * Returns pod URLs for frontend artifacts
 */
async function claimPodForTask(taskId: string, workspaceId: string): Promise<PodClaimResult> {
  // Load workspace with swarm configuration
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      swarm: true,
      repositories: true,
    },
  });

  if (!workspace?.swarm?.poolApiKey) {
    throw new Error("Workspace not configured for pods");
  }

  const services = workspace.swarm.services as ServiceInfo[] | null;
  const swarmId = workspace.swarm.id as string;

  // Claim pod from pool
  const { frontend, workspace: podWorkspace } = await claimPodAndGetFrontend(swarmId, taskId, services || undefined);

  const controlUrl = podWorkspace.portMappings[POD_PORTS.CONTROL];

  if (!controlUrl) {
    throw new Error("Pod control port not available");
  }

  // Update repositories on new pod (non-fatal if fails)
  if (workspace.repositories.length > 0) {
    try {
      await updatePodRepositories(
        controlUrl,
        podWorkspace.password,
        workspace.repositories.map((r) => ({ url: r.repositoryUrl })),
      );
      console.log("[Agent] Updated repositories on pod");
    } catch (repoError) {
      console.error("[Agent] Error updating repositories (non-fatal):", repoError);
    }
  }

  // Store pod credentials on task
  const encryptedPassword = encryptionService.encryptField("agentPassword", podWorkspace.password);
  await db.task.update({
    where: { id: taskId },
    data: {
      podId: podWorkspace.id,
      agentUrl: controlUrl,
      agentPassword: JSON.stringify(encryptedPassword),
    },
  });

  console.log("[Agent] Claimed pod:", podWorkspace.id, "for task:", taskId);

  return {
    podId: podWorkspace.id,
    frontend,
    ide: podWorkspace.url || podWorkspace.portMappings["8080"] || "",
    credentials: {
      agentUrl: controlUrl,
      agentPassword: podWorkspace.password,
    },
  };
}

/**
 * Validate if a session exists on the remote pod
 */
async function validateSessionOnPod(agentUrl: string, agentPassword: string | null, taskId: string): Promise<boolean> {
  try {
    const validateUrl = agentUrl.replace(/\/$/, "") + "/validate_session";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (agentPassword) {
      headers["Authorization"] = `Bearer ${agentPassword}`;
    }

    const response = await fetch(validateUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ session: taskId }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.exists === true;
    }
    return false;
  } catch (error) {
    console.error("[Agent] Error validating session:", error);
    return false;
  }
}

/**
 * Get or create webhook secret for a task
 */
async function getOrCreateWebhookSecret(taskId: string, existingSecret: string | null): Promise<string> {
  if (existingSecret) {
    return encryptionService.decryptField("agentWebhookSecret", existingSecret);
  }

  const webhookSecret = generateWebhookSecret();
  const encryptedSecret = encryptionService.encryptField("agentWebhookSecret", webhookSecret);
  await db.task.update({
    where: { id: taskId },
    data: {
      agentWebhookSecret: JSON.stringify(encryptedSecret),
    },
  });

  return webhookSecret;
}

/**
 * Create a session on the remote agent server
 */
async function createAgentSession(
  agentUrl: string,
  agentPassword: string | null,
  taskId: string,
  webhookUrl: string,
  effectiveModel: ModelName | undefined,
): Promise<string> {
  const sessionUrl = agentUrl.replace(/\/$/, "") + "/session";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (agentPassword) {
    headers["Authorization"] = `Bearer ${agentPassword}`;
  }

  // Determine API key based on model
  const apiKey = effectiveModel ? getApiKeyForModel(effectiveModel) : process.env.ANTHROPIC_API_KEY;

  const sessionPayload: Record<string, unknown> = {
    sessionId: taskId,
    webhookUrl,
    apiKey,
    searchApiKey: process.env.EXA_API_KEY,
  };

  if (effectiveModel) {
    sessionPayload.model = effectiveModel;
  }

  console.log("[Agent] Creating session at:", sessionUrl);
  if (effectiveModel) {
    console.log("[Agent] Using model:", effectiveModel);
  }

  const response = await fetch(sessionUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(sessionPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Agent] Session creation failed:", response.status, errorText);
    throw new Error("Failed to create agent session");
  }

  const sessionData = await response.json();
  if (!sessionData.token) {
    throw new Error("No stream token returned from agent");
  }

  return sessionData.token;
}

/**
 * Save user message to database
 */
async function saveUserMessage(taskId: string, message: string, artifacts: ArtifactRequest[]): Promise<void> {
  try {
    await db.chatMessage.create({
      data: {
        taskId,
        message,
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        artifacts: {
          create: artifacts.map((artifact) => ({
            type: artifact.type,
            content: artifact.content as object,
          })),
        },
      },
    });
  } catch (error) {
    console.error("[Agent] Error saving user message:", error);
    // Non-fatal, continue anyway
  }
}

// ============================================================================
// Main Handler
// ============================================================================

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { message, taskId, artifacts = [], model } = body;

  // Validate model parameter if provided
  const requestModel: ModelName | undefined = isValidModel(model) ? model : undefined;

  // 1. Authenticate user
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  // 2. Load task and message count
  const [task, messageCount] = await Promise.all([
    db.task.findUnique({
      where: { id: taskId },
      select: {
        podId: true,
        workspaceId: true,
        agentUrl: true,
        agentPassword: true,
        agentWebhookSecret: true,
        mode: true,
        model: true,
      },
    }),
    db.chatMessage.count({
      where: { taskId },
    }),
  ]);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.mode !== "agent") {
    return NextResponse.json({ error: "Task is not in agent mode" }, { status: 400 });
  }

  // Determine effective model: request > task > default
  const taskModel: ModelName | undefined = isValidModel(task.model) ? task.model : undefined;
  const effectiveModel: ModelName | undefined = requestModel || taskModel;

  // 3. Ensure pod is available (claim if needed)
  let agentCredentials: AgentCredentials;
  let podUrls: { podId: string; frontend: string; ide: string } | null = null;
  let chatHistoryForPrompt: string | null = null;

  const isUsingCustomUrl = !!process.env.CUSTOM_GOOSE_URL;

  if (!task.podId && !isUsingCustomUrl) {
    // No pod assigned - need to claim one
    console.log("[Agent] No pod assigned to task, claiming new pod...");

    try {
      const claimResult = await claimPodForTask(taskId, task.workspaceId);
      agentCredentials = claimResult.credentials;
      podUrls = {
        podId: claimResult.podId,
        frontend: claimResult.frontend,
        ide: claimResult.ide,
      };

      // For freshly claimed pod with existing messages, include chat history
      if (messageCount > 0) {
        console.log("[Agent] Existing messages found, including chat history for context");
        chatHistoryForPrompt = await getChatHistoryContext(taskId);
      }
    } catch (claimError) {
      console.error("[Agent] Failed to claim pod:", claimError);
      return NextResponse.json({ error: "No pods available" }, { status: 503 });
    }
  } else if (!task.podId && isUsingCustomUrl) {
    // Local dev mode - set mock pod info
    const mockPodId = "local-dev";
    const mockFrontend = process.env.MOCK_BROWSER_URL || "http://localhost:3000";

    // Store mock podId on task
    await db.task.update({
      where: { id: taskId },
      data: {
        podId: mockPodId,
        agentUrl: process.env.CUSTOM_GOOSE_URL,
      },
    });

    agentCredentials = {
      agentUrl: process.env.CUSTOM_GOOSE_URL!,
      agentPassword: null,
    };

    podUrls = {
      podId: mockPodId,
      frontend: mockFrontend,
      ide: mockFrontend, // Use same URL for IDE in dev
    };

    console.log("[Agent] Using local dev mode with mock pod:", mockPodId);
  } else {
    // Pod exists (real or mock)
    const agentUrl = isUsingCustomUrl ? process.env.CUSTOM_GOOSE_URL! : task.agentUrl;

    if (!agentUrl) {
      return NextResponse.json({ error: "Agent URL not configured" }, { status: 400 });
    }

    // Password required unless using custom URL
    if (!isUsingCustomUrl && !task.agentPassword) {
      return NextResponse.json({ error: "Agent password not configured" }, { status: 400 });
    }

    const agentPassword = task.agentPassword
      ? encryptionService.decryptField("agentPassword", task.agentPassword)
      : null;

    agentCredentials = { agentUrl, agentPassword };

    // 4. Validate session on existing pod (if resuming)
    if (messageCount > 0) {
      const sessionExists = await validateSessionOnPod(agentUrl, agentPassword, taskId);
      console.log("[Agent] Session validation result:", sessionExists ? "exists" : "not found");

      if (!sessionExists) {
        console.log("[Agent] Session not found on pod, including chat history for context");
        chatHistoryForPrompt = await getChatHistoryContext(taskId);
      }
    }
  }

  // 5. Get or create webhook secret
  const webhookSecret = await getOrCreateWebhookSecret(taskId, task.agentWebhookSecret);

  // 6. Create webhook URL
  const webhookToken = await createWebhookToken(taskId, webhookSecret);
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const webhookUrl = `${baseUrl}/api/agent/webhook?token=${webhookToken}`;

  // 7. Create session on remote agent
  let streamToken: string;
  try {
    streamToken = await createAgentSession(
      agentCredentials.agentUrl,
      agentCredentials.agentPassword,
      taskId,
      webhookUrl,
      effectiveModel,
    );
  } catch (error) {
    console.error("[Agent] Error creating session:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create agent session" },
      { status: 502 },
    );
  }

  // 8. Save user message (include pod artifacts if pod was just claimed)
  const allArtifacts: ArtifactRequest[] = [...artifacts];
  if (podUrls) {
    allArtifacts.push(
      { type: ArtifactType.BROWSER, content: { url: podUrls.frontend } },
      { type: ArtifactType.IDE, content: { url: podUrls.ide } },
    );
  }
  await saveUserMessage(taskId, message, allArtifacts);

  // 9. Return connection info
  const streamUrl = agentCredentials.agentUrl.replace(/\/$/, "") + `/stream/${taskId}`;
  const isResume = messageCount > 0 && !chatHistoryForPrompt;

  return NextResponse.json({
    success: true,
    sessionId: taskId,
    streamToken,
    streamUrl,
    resume: isResume,
    ...(chatHistoryForPrompt && { historyContext: chatHistoryForPrompt }),
    ...(podUrls && { podUrls }),
  });
}
