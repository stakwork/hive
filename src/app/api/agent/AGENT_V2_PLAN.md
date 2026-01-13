# Agent V2 Implementation Plan

## Overview

This document describes the complete rewrite of the agent streaming architecture. The new design enables:

1. **Direct frontend streaming**: Frontend connects directly to remote agent server for SSE
2. **Secure session management**: Hive backend handles authentication with remote server
3. **Webhook-based persistence**: Remote server sends final messages to Hive for database storage
4. **JWT-authenticated webhooks**: 10-minute expiry tokens scoped per chat turn

## Architecture Diagram

```
┌─────────────┐                                ┌─────────────┐                    ┌──────────────────┐
│   Hive      │  1. POST /api/agent            │   Hive      │                    │  Remote Agent    │
│  Frontend   │     { taskId, message }        │  Backend    │                    │  Server          │
│             │ ─────────────────────────────► │             │                    │  (agentUrl)      │
│             │                                │             │                    │                  │
│             │                                │  2. POST /session                │                  │
│             │                                │     Auth: Bearer {agentPassword} │                  │
│             │                                │     { sessionId, webhookUrl }    │                  │
│             │                                │  ───────────────────────────────►│                  │
│             │                                │  ◄─────── { token } ─────────────│                  │
│             │                                │                                  │                  │
│             │  3. { sessionId, streamToken,  │             │                    │                  │
│             │       streamUrl }              │             │                    │                  │
│             │ ◄───────────────────────────── │             │                    │                  │
│             │                                │             │                    │                  │
│             │  4. POST /stream/:sessionId    │             │                    │                  │
│             │     ?token=streamToken         │             │                    │                  │
│             │     { prompt }                 │             │                    │                  │
│             │  ─────────────────────────────────────────────────────────────►  │                  │
│             │  ◄───────────────────── SSE stream ─────────────────────────────  │                  │
│             │                                │             │                    │                  │
│             │                                │             │  5. POST /webhook  │                  │
│             │                                │             │     ?token=jwt     │                  │
│             │                                │             │ ◄──────────────────│                  │
│             │                                │             │  { final message } │                  │
└─────────────┘                                └─────────────┘                    └──────────────────┘
```

## Flow Description

### Step 1: Frontend sends message to Hive backend
```
POST /api/agent
{
  "taskId": "clxxx...",
  "message": "Help me fix this bug",
  "artifacts": []
}
```

### Step 2: Hive backend creates/refreshes session on remote server
```
POST {agentUrl}/session
Authorization: Bearer {agentPassword}
{
  "sessionId": "{taskId}",  // taskId IS the sessionId
  "webhookUrl": "https://hive.example.com/api/agent/webhook?token={jwt}"
}

Response: { "token": "stream-token-xxx" }
```

**Key points:**
- `sessionId` = `taskId` (simplifies everything, one session per task)
- Remote server creates session if new, refreshes token if exists
- `webhookUrl` includes fresh JWT with 10-minute expiry
- JWT is signed with per-task `agentWebhookSecret`

### Step 3: Hive backend returns connection info to frontend
```json
{
  "success": true,
  "sessionId": "clxxx...",
  "streamToken": "stream-token-xxx",
  "streamUrl": "https://agent.example.com/stream/clxxx..."
}
```

### Step 4: Frontend streams directly from remote server
```
POST {streamUrl}?token={streamToken}
{
  "prompt": "Help me fix this bug"
}

Response: SSE stream with AI SDK TextStreamPart events
```

**SSE Format (AI SDK native):**
```
event: message
data: {"type":"text-start","id":"text-1"}

event: message
data: {"type":"text-delta","id":"text-1","text":"I'll help"}

event: message
data: {"type":"text-delta","id":"text-1","text":" you fix"}

event: message
data: {"type":"text-end","id":"text-1"}

event: message
data: {"type":"finish","finishReason":"stop"}
```

### Step 5: Remote server sends final messages to webhook
```
POST /api/agent/webhook?token={jwt}
{
  "sessionId": "clxxx...",
  "type": "text",
  "id": "text-1",
  "text": "I'll help you fix this bug...",
  "timestamp": 1234567890
}
```

**Webhook payload types:**
```typescript
// Complete text message
{ sessionId, type: "text", id, text, timestamp }

// Tool call (for future TOOL_USE artifact)
{ sessionId, type: "tool-call", toolCallId, toolName, input, timestamp }

// Tool result (for future TOOL_USE artifact)
{ sessionId, type: "tool-result", toolCallId, toolName, output, timestamp }
```

---

## Database Schema Changes

### Add to Task model in `prisma/schema.prisma`:

```prisma
model Task {
  // ... existing fields ...
  
  // Agent webhook authentication (encrypted)
  agentWebhookSecret String? @map("agent_webhook_secret")
}
```

**Migration command:**
```bash
npx prisma migrate dev --name add_agent_webhook_secret
```

**Notes:**
- `agentWebhookSecret`: 32-byte hex string used to sign webhook JWTs
- Encrypted using `EncryptionService` before storage
- Generated once per task on first agent message
- No need for `agentSessionId` since `taskId` IS the `sessionId`

---

## Files to Create

### 1. `src/lib/auth/agent-jwt.ts`

JWT utilities for webhook authentication.

```typescript
import { SignJWT, jwtVerify } from 'jose';

const WEBHOOK_TOKEN_EXPIRY = '10m';

interface WebhookTokenPayload {
  taskId: string;
}

/**
 * Create a JWT for webhook authentication
 * @param taskId - The task ID (also used as session ID)
 * @param secret - The per-task webhook secret
 * @returns Signed JWT string
 */
export async function createWebhookToken(taskId: string, secret: string): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  
  return new SignJWT({ taskId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(WEBHOOK_TOKEN_EXPIRY)
    .sign(secretKey);
}

/**
 * Verify a webhook JWT and extract payload
 * @param token - The JWT to verify
 * @param secret - The per-task webhook secret
 * @returns Payload if valid, null if invalid/expired
 */
export async function verifyWebhookToken(
  token: string, 
  secret: string
): Promise<WebhookTokenPayload | null> {
  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey);
    return { taskId: payload.taskId as string };
  } catch {
    return null;
  }
}

/**
 * Generate a random webhook secret
 * @returns 32-byte hex string
 */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### 2. `src/app/api/agent/webhook/route.ts`

Webhook endpoint for receiving final messages from remote server.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { verifyWebhookToken } from "@/lib/agent/jwt";
import { ChatRole, ChatStatus } from "@prisma/client";
import { decodeJwt } from 'jose';

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
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  // 2. Decode JWT to get taskId (unverified, just to load the secret)
  let taskId: string;
  try {
    const decoded = decodeJwt(token);
    taskId = decoded.taskId as string;
    if (!taskId) {
      return NextResponse.json({ error: "Invalid token payload" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid token format" }, { status: 400 });
  }

  // 3. Load task and get webhook secret
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { agentWebhookSecret: true },
  });

  if (!task || !task.agentWebhookSecret) {
    return NextResponse.json({ error: "Task not found or not configured" }, { status: 404 });
  }

  // 4. Decrypt secret and verify JWT
  const webhookSecret = encryptionService.decryptField(
    "agentWebhookSecret",
    task.agentWebhookSecret
  );

  const verified = await verifyWebhookToken(token, webhookSecret);
  if (!verified) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

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
        // TODO: Store as TOOL_USE artifact in future PR
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
```

---

## Files to Modify

### 1. `src/app/api/agent/route.ts` (Complete Rewrite)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { ChatRole, ChatStatus, ArtifactType } from "@prisma/client";
import { createWebhookToken, generateWebhookSecret } from "@/lib/agent/jwt";

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

  // 2. Load task
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      agentUrl: true,
      agentPassword: true,
      agentWebhookSecret: true,
      mode: true,
    },
  });

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
  const agentPassword = task.agentPassword
    ? encryptionService.decryptField("agentPassword", task.agentPassword)
    : null;

  // 5. Handle webhook secret (generate if not exists)
  let webhookSecret: string;
  
  if (task.agentWebhookSecret) {
    webhookSecret = encryptionService.decryptField(
      "agentWebhookSecret",
      task.agentWebhookSecret
    );
  } else {
    webhookSecret = generateWebhookSecret();
    await db.task.update({
      where: { id: taskId },
      data: {
        agentWebhookSecret: encryptionService.encryptField(
          "agentWebhookSecret",
          webhookSecret
        ),
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
    const sessionResponse = await fetch(sessionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId: taskId,  // taskId IS the sessionId
        webhookUrl,
      }),
    });

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      console.error("[Agent] Session creation failed:", sessionResponse.status, errorText);
      return NextResponse.json(
        { error: "Failed to create agent session" },
        { status: 502 }
      );
    }

    const sessionData = await sessionResponse.json();
    streamToken = sessionData.token;
    
    if (!streamToken) {
      return NextResponse.json(
        { error: "No stream token returned from agent" },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("[Agent] Error connecting to remote server:", error);
    return NextResponse.json(
      { error: "Failed to connect to agent server" },
      { status: 502 }
    );
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
  });
}
```

### 2. `src/app/w/[slug]/task/[...taskParams]/page.tsx`

Update `sendMessage()` for agent mode (replace lines ~637-728):

```typescript
// Agent mode: new direct streaming flow
if (taskMode === "agent") {
  // Mark user message as sent in UI
  setMessages((msgs) =>
    msgs.map((msg) => (msg.id === newMessage.id ? { ...msg, status: ChatStatus.SENT } : msg))
  );

  // Prepare artifacts for backend
  const backendArtifacts = artifacts.map((artifact) => ({
    type: artifact.type,
    content: artifact.content,
  }));

  // 1. Call backend to create/refresh session
  const sessionResponse = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId: options?.taskId || currentTaskId,
      message: messageText,
      artifacts: backendArtifacts,
    }),
  });

  if (!sessionResponse.ok) {
    throw new Error(`Failed to create session: ${sessionResponse.statusText}`);
  }

  const { streamToken, streamUrl } = await sessionResponse.json();

  // 2. Connect directly to remote server for streaming
  const streamResponse = await fetch(
    `${streamUrl}?token=${encodeURIComponent(streamToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: messageText }),
    }
  );

  if (!streamResponse.ok) {
    throw new Error(`Stream failed: ${streamResponse.statusText}`);
  }

  // 3. Process stream using existing processor (now AI SDK native format)
  const assistantMessageId = generateUniqueId();

  await processStream(
    streamResponse,
    assistantMessageId,
    (updatedMessage) => {
      // Turn off loading as soon as we get the first content
      if (!hasReceivedContentRef.current) {
        hasReceivedContentRef.current = true;
        setIsLoading(false);
      }

      // Update messages array
      setMessages((prev) => {
        const existingIndex = prev.findIndex((m) => m.id === assistantMessageId);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = updatedMessage as unknown as ChatMessage;
          return updated;
        }
        return [...prev, updatedMessage as unknown as ChatMessage];
      });
    },
    { role: "assistant" as const, timestamp: new Date() }
  );

  // 4. Optional: Check for diffs after agent completes
  if (effectiveWorkspaceId && (options?.taskId || currentTaskId)) {
    try {
      const diffResponse = await fetch("/api/agent/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: effectiveWorkspaceId,
          taskId: options?.taskId || currentTaskId,
        }),
      });

      if (diffResponse.ok) {
        const diffResult = await diffResponse.json();
        if (diffResult.success && diffResult.message && !diffResult.noDiffs) {
          setMessages((msgs) => [...msgs, diffResult.message]);
        }
      }
    } catch (error) {
      console.error("Error fetching diff:", error);
    }
  }

  // Messages are persisted via webhook - no need to save here
  return;
}
```

---

## Files to Remove/Clean Up

### Remove from `src/app/api/agent/route.ts`:
- All `ai-sdk-provider-goose-web` imports
- `validateGooseSession` function usage
- WebSocket URL construction (`wsUrl`)
- `after()` background processing
- `sourceWebsocketID` tracking
- `AGENT_SYSTEM_PROMPT` constant (handled by remote server)
- Stream teeing logic
- Frontend stream transformation

### Remove from `package.json`:
- `ai-sdk-provider-goose-web` dependency

---

## Environment Variables

### Existing (no changes):
- `NEXTAUTH_URL` - Used to construct webhook URL
- `DATABASE_URL` - Database connection

### For Local Development:
- `CUSTOM_GOOSE_URL` - Override agent URL for local testing (e.g., `http://localhost:15552`)

When `CUSTOM_GOOSE_URL` is set:
- Uses this URL instead of `task.agentUrl`
- Authentication header is optional (for local dev without auth)

---

## Security Considerations

### Webhook JWT Security:
1. **Per-task secret**: Each task has its own `agentWebhookSecret`
2. **Short expiry**: 10-minute token lifetime limits replay attacks
3. **Fresh token per turn**: New JWT generated for each chat message
4. **Signature verification**: HMAC-SHA256 signature prevents tampering

### Authentication Flow:
1. **User auth**: Hive backend validates user session before creating agent session
2. **Agent auth**: Hive backend authenticates to remote server with `agentPassword`
3. **Stream auth**: Frontend uses `streamToken` from remote server (opaque token)
4. **Webhook auth**: Remote server uses JWT from `webhookUrl`

---

## Future Work (Separate PRs)

### 1. TOOL_USE Artifact
Add new artifact type for tool calls:

```prisma
enum ArtifactType {
  // ... existing types
  TOOL_USE
}
```

Schema:
```typescript
{
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
}
```

Update webhook to persist tool calls/results as TOOL_USE artifacts.

### 2. Cleanup
- Remove `ai-sdk-provider-goose-web` from package.json
- Remove `sourceWebsocketID` field from ChatMessage (or deprecate)
- Add tests for JWT utilities and webhook endpoint

---

## Testing Checklist

### Manual Testing:
1. [ ] Create new task in agent mode
2. [ ] Send first message - should create session
3. [ ] Verify streaming works in UI
4. [ ] Verify message persisted via webhook
5. [ ] Send second message - should reuse session with fresh token
6. [ ] Verify multi-turn conversation works
7. [ ] Test with `CUSTOM_GOOSE_URL` for local development

### Error Cases:
1. [ ] Invalid/missing task ID
2. [ ] Task without agent URL configured
3. [ ] Remote server unreachable
4. [ ] Invalid stream token
5. [ ] Expired webhook JWT

---

## Migration Notes

This is a **breaking change** for existing agent tasks. However, since we're deprecating the old agent mode entirely:

1. Existing tasks with old agent sessions will get new sessions on next message
2. Conversation history is preserved in database
3. Remote server maintains its own session history

No data migration required - the schema change only adds a new nullable field.
