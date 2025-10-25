import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { streamText, ModelMessage } from "ai";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import { gooseWeb } from "ai-sdk-provider-goose-web";

interface ArtifactRequest {
  type: ArtifactType;
  content?: Record<string, unknown>;
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

      // Check if first message has a sourceWebsocketID to reuse
      if (chatHistory.length > 0 && chatHistory[0].sourceWebsocketID) {
        sessionId = chatHistory[0].sourceWebsocketID;
        console.log("🔄 Found existing session ID from database:", sessionId);
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

  // Save user message with artifacts and sourceWebsocketID to database if taskId is provided
  if (taskId) {
    try {
      await db.chatMessage.create({
        data: {
          taskId,
          message,
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          // Set sourceWebsocketID if we have one from previous messages (null for new conversations)
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
      console.error("Error saving message to database:", error);
    }
  }

  // If CUSTOM_GOOSE_URL is set, use it as-is (it should be the full ws:// URL)
  // export CUSTOM_GOOSE_URL=ws://0.0.0.0:8888/ws
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

  const isResumingSession = chatHistory.length > 0 && !!sessionId;
  if (isResumingSession) {
    console.log("🔄 Resuming conversation with session ID:", sessionId);
  } else {
    console.log("🆕 Starting new conversation - provider will create session via REST API");
  }

  const opts: { [k: string]: unknown } = {
    wsUrl,
    // Only pass sessionId if we're reusing an existing session from chat history
    ...(isResumingSession ? { sessionId } : {}),
    // Callback to save session ID when it's created
    sessionIdCallback: (createdSessionId: string, oldSessionInvalidated?: boolean) => {
      console.log("🔍 Session created by provider:", createdSessionId);

      if (oldSessionInvalidated) {
        console.log("⚠️ Old session was invalidated - updating ALL messages to new session");
      }

      if (taskId) {
        // If old session was invalidated, update ALL messages to the new session
        // Otherwise, only update messages that don't have a session ID yet
        const whereCondition = oldSessionInvalidated
          ? { taskId }
          : { taskId, sourceWebsocketID: null };

        db.chatMessage
          .updateMany({
            where: whereCondition,
            data: {
              sourceWebsocketID: createdSessionId,
            },
          })
          .then(() => {
            console.log("✅ Saved session ID to database:", createdSessionId);
          })
          .catch((error) => {
            console.error("Error saving session ID:", error);
          });
      }
    },
  };
  if (process.env.CUSTOM_GOOSE_URL) {
    opts.logger = {
      debug: () => {},
      // debug: (message: string, ...args: unknown[]) => {
      //   console.log(`🔍 [Goose Debug] ${message}`, ...args);
      // },
      info: (message: string, ...args: unknown[]) => {
        console.log(`ℹ️ [Goose Info] ${message}`, ...args);
      },
      warn: (message: string, ...args: unknown[]) => {
        console.warn(`⚠️ [Goose Warn] ${message}`, ...args);
      },
      error: (message: string, ...args: unknown[]) => {
        console.error(`❌ [Goose Error] ${message}`, ...args);
      },
    };
  }
  const model = gooseWeb("goose", opts);

  // Build messages array
  // If resuming a session, Goose already has the history - just send current message
  // If new session, send system prompt + chat history + current message
  const messages: ModelMessage[] = [];

  if (!isResumingSession) {
    // New session - include system prompt
    messages.push({ role: "system", content: AGENT_SYSTEM_PROMPT });

    // Add chat history to provide context for the new session
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
  }

  // Always add the current user message
  messages.push({ role: "user", content: message });

  const result = streamText({
    model,
    messages,
  });

  // Create custom stream that properly maps Goose tool events to UI format
  const stream = new ReadableStream({
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

        for await (const chunk of result.fullStream) {
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
        console.error("Stream error:", error);
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

const AGENT_SYSTEM_PROMPT = `
You are a helpful AI assistant that helps users with coding tasks.
You can analyze code, answer questions, and provide suggestions.
Be concise and helpful in your responses.
`;
