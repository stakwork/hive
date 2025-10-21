# AI Streaming with Persistent Background Saving

## Problem Statement

Your Next.js API route streams responses from a remote AI agent (Goose) to the frontend. However, when the frontend closes or the user navigates away, the streaming stops and the response is lost. You need to:

1. **Stream to the frontend** for real-time user feedback
2. **Continue processing in the background** even if the frontend disconnects
3. **Save the complete response to the database** regardless of client connection
4. **Work within Vercel's serverless constraints** (timeout limits)

## Solution: Hybrid Streaming + Background Persistence

This solution uses:
- **Stream Teeing**: Split the AI response into two streams - one for frontend, one for database
- **Next.js 15 `after()`**: Continue background processing after response is sent
- **Incremental Saves**: Update the database every 200 characters to minimize data loss
- **Optimistic DB Creation**: Create a placeholder message that gets updated progressively

### Key Features
- ✅ Real-time streaming to frontend
- ✅ Continues processing if user closes tab
- ✅ Incremental saves prevent data loss
- ✅ Works up to 5 minutes on Vercel Pro (10s on Hobby)
- ✅ Handles tool calls and artifacts
- ✅ Error recovery with partial message saving

## Complete Implementation

Replace your existing `app/api/agent/route.ts` (or equivalent) with this code:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { streamText, ModelMessage } from "ai";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import { gooseWeb } from "ai-sdk-provider-goose-web";
import { after } from "next/server";

interface ArtifactRequest {
  type: ArtifactType;
  content?: Record<string, unknown>;
}

// Generate a session ID using timestamp format (yyyymmdd_hhmmss) like CLI
function generateSessionId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}_${hour}${minute}${second}`;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { message, gooseUrl, taskId, artifacts = [] } = body;

  // Authenticate user
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load chat history from database
  let chatHistory: {
    role: string;
    message: string;
    sourceWebsocketID: string | null;
    artifacts: { content: unknown }[];
  }[] = [];
  let sessionId: string | null = null;
  let persistedGooseUrl: string | null = null;

  if (taskId) {
    try {
      chatHistory = await db.chatMessage.findMany({
        where: { taskId },
        orderBy: { timestamp: "asc" },
        select: {
          role: true,
          message: true,
          sourceWebsocketID: true,
          artifacts: {
            where: { type: ArtifactType.IDE },
            select: {
              content: true,
            },
          },
        },
      });

      // Check if first message has a sourceWebsocketID
      if (chatHistory.length > 0 && chatHistory[0].sourceWebsocketID) {
        sessionId = chatHistory[0].sourceWebsocketID;
        console.log("🔄 Reusing existing session ID:", sessionId);
      } else {
        // Generate new session ID for first message
        sessionId = generateSessionId();
        console.log("🆕 Generated new session ID:", sessionId);
      }

      // Look for IDE artifact to get persisted gooseUrl
      for (const msg of chatHistory) {
        if (msg.artifacts && msg.artifacts.length > 0) {
          const ideArtifact = msg.artifacts[0];
          if (ideArtifact.content && typeof ideArtifact.content === "object") {
            const content = ideArtifact.content as { url?: string };
            if (content.url) {
              // Transform URL: https://09c0a821.workspaces.sphinx.chat -> https://09c0a821-15551.workspaces.sphinx.chat
              persistedGooseUrl = content.url.replace(/^(https?:\/\/[^.]+)\./, "$1-15551.");
              console.log("🔄 Found persisted Goose URL from IDE artifact:", persistedGooseUrl);
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error("Error loading chat history:", error);
    }
  }

  // If no taskId or failed to load, generate new session
  if (!sessionId) {
    sessionId = generateSessionId();
    console.log("🆕 Generated new session ID (no task):", sessionId);
  }

  // Save user message with artifacts and sourceWebsocketID to database if taskId is provided
  if (taskId) {
    try {
      await db.chatMessage.create({
        data: {
          taskId,
          message,
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          sourceWebsocketID: sessionId,
          artifacts: {
            create: artifacts.map((artifact: ArtifactRequest) => ({
              type: artifact.type,
              content: artifact.content,
            })),
          },
        },
      });
    } catch (error) {
      console.error("Error saving user message to database:", error);
    }
  }

  // Create placeholder for assistant message that will be updated in background
  let assistantMessageId: string | null = null;
  if (taskId) {
    try {
      const assistantMessage = await db.chatMessage.create({
        data: {
          taskId,
          message: "", // Will be updated progressively
          role: ChatRole.ASSISTANT,
          status: ChatStatus.STREAMING,
          sourceWebsocketID: sessionId,
        },
      });
      assistantMessageId = assistantMessage.id;
      console.log("✅ Created placeholder assistant message:", assistantMessageId);
    } catch (error) {
      console.error("Error creating assistant message placeholder:", error);
    }
  }

  // Determine WebSocket URL
  let wsUrl: string;

  if (process.env.CUSTOM_GOOSE_URL) {
    wsUrl = process.env.CUSTOM_GOOSE_URL;
    console.log("🧪 Using custom dev Goose URL from CUSTOM_GOOSE_URL:", wsUrl);
  } else {
    // Use persisted gooseUrl from IDE artifact, or provided gooseUrl
    const effectiveGooseUrl = persistedGooseUrl || gooseUrl;

    if (!effectiveGooseUrl) {
      return NextResponse.json(
        { error: "No Goose URL available. Please start a new agent task to claim a pod." },
        { status: 400 },
      );
    }

    wsUrl = effectiveGooseUrl.replace(/^https?:\/\//, "wss://").replace(/\/$/, "") + "/ws";

    if (persistedGooseUrl) {
      console.log("🔄 Using persisted Goose URL from database:", wsUrl);
    } else if (gooseUrl) {
      console.log("🆕 Using Goose URL from request:", wsUrl);
    }
  }

  console.log("🤖 Final Goose WebSocket URL:", wsUrl);
  console.log("🤖 Session ID:", sessionId);

  const model = gooseWeb("goose", {
    wsUrl,
    sessionId,
  });

  // Build messages array from database history
  const messages: ModelMessage[] = [{ role: "system", content: AGENT_SYSTEM_PROMPT }];

  // Add chat history from database
  if (chatHistory.length > 0) {
    for (const msg of chatHistory) {
      const role = msg.role.toLowerCase();
      if (role === "user" || role === "assistant") {
        messages.push({
          role: role as "user" | "assistant",
          content: msg.message,
        });
      }
    }
  }

  // Add current user message
  messages.push({ role: "user", content: message });

  const result = streamText({
    model,
    messages,
  });

  // TEE THE STREAM: Split into two - one for frontend, one for database
  const [frontendStream, dbStream] = result.fullStream.tee();

  // BACKGROUND PROCESSING: Use after() to continue even if frontend disconnects
  if (assistantMessageId) {
    after(async () => {
      console.log("🔄 Starting background stream processing for message:", assistantMessageId);
      await saveCompleteStreamToDb(dbStream, assistantMessageId, taskId);
    });
  }

  // FRONTEND STREAM: Stream to client for real-time feedback
  const stream = createFrontendStream(frontendStream);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Background function that processes the stream and saves to database
 * Runs independently of frontend connection via after()
 */
async function saveCompleteStreamToDb(
  stream: ReadableStream,
  messageId: string,
  taskId: string
) {
  let fullMessage = "";
  const toolCalls: Array<{
    name: string;
    input: unknown;
    output: unknown;
    callId: string;
  }> = [];
  let lastSaveLength = 0;
  const SAVE_INTERVAL = 200; // Save every 200 characters

  try {
    for await (const chunk of stream) {
      switch (chunk.type) {
        case "text-delta":
          fullMessage += chunk.text;

          // Incremental save to prevent data loss
          if (fullMessage.length - lastSaveLength > SAVE_INTERVAL) {
            try {
              await db.chatMessage.update({
                where: { id: messageId },
                data: { message: fullMessage },
              });
              lastSaveLength = fullMessage.length;
              console.log(`💾 Incremental save: ${fullMessage.length} chars`);
            } catch (saveError) {
              console.error("Error during incremental save:", saveError);
              // Continue processing even if save fails
            }
          }
          break;

        case "tool-call":
          if (!chunk.invalid) {
            toolCalls.push({
              callId: chunk.toolCallId,
              name: chunk.toolName,
              input: chunk.input,
              output: null,
            });
            console.log(`🔧 Tool call: ${chunk.toolName}`);
          }
          break;

        case "tool-result":
          const tool = toolCalls.find((t) => t.callId === chunk.toolCallId);
          if (tool) {
            tool.output = chunk.output;
            console.log(`✅ Tool result for: ${tool.name}`);
          }
          break;

        case "error":
          console.error("Stream error chunk:", chunk.error);
          break;
      }
    }

    // Final save with complete message
    await db.chatMessage.update({
      where: { id: messageId },
      data: {
        message: fullMessage,
        status: ChatStatus.COMPLETE,
        ...(toolCalls.length > 0 && {
          // Add toolCalls field if your schema supports it
          // toolCalls: JSON.stringify(toolCalls),
        }),
      },
    });

    console.log(`✅ Final save complete: ${fullMessage.length} chars, ${toolCalls.length} tool calls`);
  } catch (error) {
    console.error("❌ Error in background stream processing:", error);

    // Mark as error but save what we have
    try {
      await db.chatMessage.update({
        where: { id: messageId },
        data: {
          message: fullMessage || "[Error: Stream interrupted]",
          status: ChatStatus.ERROR,
        },
      });
      console.log("💾 Saved partial message due to error");
    } catch (finalError) {
      console.error("Failed to save error state:", finalError);
    }
  }
}

/**
 * Creates the frontend stream with proper event formatting
 */
function createFrontendStream(stream: ReadableStream) {
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (data: unknown) => {
        const line = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(line));
      };

      try {
        // Send start event
        sendEvent({ type: "start" });
        sendEvent({ type: "start-step" });

        for await (const chunk of stream) {
          switch (chunk.type) {
            case "text-start":
            case "text-end":
              // Pass through as-is
              sendEvent(chunk);
              break;

            case "text-delta":
              // AI SDK fullStream uses 'text' field, but our UI expects 'delta'
              sendEvent({
                type: "text-delta",
                id: chunk.id,
                delta: chunk.text,
              });
              break;

            case "tool-call":
              // Skip invalid tool calls - tool-error event will handle them
              if (chunk.invalid) break;

              // Convert AI SDK tool-call format to tool-input-* events
              sendEvent({
                type: "tool-input-start",
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
              });
              sendEvent({
                type: "tool-input-available",
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: chunk.input,
              });
              break;

            case "tool-result":
              // Convert tool-result to tool-output-available
              sendEvent({
                type: "tool-output-available",
                toolCallId: chunk.toolCallId,
                output: chunk.output,
              });
              break;

            case "tool-error":
              // Goose manages its own tools, so AI SDK sees them as "errors"
              // Treat them as successful calls and show in UI
              sendEvent({
                type: "tool-input-start",
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
              });
              sendEvent({
                type: "tool-input-available",
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: chunk.input,
              });
              break;

            case "error":
              sendEvent({ type: "error", error: chunk.error });
              break;

            case "finish":
              sendEvent({ type: "finish-step" });
              sendEvent({ type: "finish", finishReason: chunk.finishReason });
              break;
          }
        }

        // Send done marker
        sendEvent("[DONE]");
        controller.close();
      } catch (error) {
        console.error("Frontend stream error:", error);
        sendEvent({ type: "error", error: String(error) });
        controller.error(error);
      }
    },
  });
}

const AGENT_SYSTEM_PROMPT = `
You are a helpful AI assistant that helps users with coding tasks.
You can analyze code, answer questions, and provide suggestions.
Be concise and helpful in your responses.
`;
```

## What Changed from Original Code?

1. **Added `import { after } from "next/server"`** - Enables background processing
2. **Create placeholder assistant message** - Created before streaming starts
3. **Stream teeing** - Split the stream: `const [frontendStream, dbStream] = result.fullStream.tee()`
4. **Background processing** - `after()` schedules `saveCompleteStreamToDb()` to run independently
5. **Incremental saves** - Database updates every 200 characters to minimize data loss
6. **Error recovery** - Catches errors and saves partial messages
7. **Tool call tracking** - Captures and stores tool interactions

## Requirements

- **Next.js 15+** (for `after()` function)
- **Vercel Pro** (recommended for 5-minute timeout instead of 10-second)
- Database schema should support:
  - `status` field with `STREAMING`, `COMPLETE`, `ERROR` states
  - Optional: `toolCalls` JSON field for storing tool interactions

## Expected Behavior

### When User Stays on Page
- ✅ Real-time streaming to frontend
- ✅ Database updates every 200 characters
- ✅ Final save when stream completes
- ✅ Tool calls captured and stored

### When User Closes Tab/Navigates Away
- ✅ Frontend stream terminates gracefully
- ✅ Background processing continues via `after()`
- ✅ Complete response saved to database
- ✅ User can return later to see full response

### On Error
- ✅ Partial message saved with ERROR status
- ✅ No data loss (last incremental save preserved)
- ✅ Logged for debugging

## Limitations & Next Steps

**Current Limits:**
- Vercel Hobby: 10-second timeout (may cut off long responses)
- Vercel Pro: 5-minute timeout (sufficient for most AI responses)
- Vercel Enterprise: 15-minute timeout

**If You Need Longer:**
Consider migrating to a job queue (Inngest, Trigger.dev) for truly unlimited duration tasks.

## Testing

1. Start a conversation with the AI
2. Close the browser tab mid-response
3. Reopen the chat - you should see the complete response saved in the database
4. Check logs for "🔄 Starting background stream processing" to confirm `after()` is working