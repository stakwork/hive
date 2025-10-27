import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { streamText, ModelMessage } from "ai";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import { gooseWeb, validateGooseSession } from "ai-sdk-provider-goose-web";

const encryptionService = EncryptionService.getInstance();

interface ArtifactRequest {
  type: ArtifactType;
  content?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { message, taskId, artifacts = [] } = body;
  // gooseUrl removed from destructuring

  // Authenticate user
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  // Fetch task from database to get agent credentials
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      agentUrl: true,
      agentPassword: true,
      mode: true,
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.mode !== "agent") {
    return NextResponse.json({ error: "Task is not in agent mode" }, { status: 400 });
  }

  // If CUSTOM_GOOSE_URL is set, credentials are optional (for local development)
  const usingCustomGooseUrl = !!process.env.CUSTOM_GOOSE_URL;

  // Only require credentials if not using custom Goose URL
  if (!usingCustomGooseUrl && (!task.agentUrl || !task.agentPassword)) {
    return NextResponse.json({ error: "Agent credentials not found for task" }, { status: 400 });
  }

  // Decrypt the pod password if available
  const agentPassword = task.agentPassword
    ? encryptionService.decryptField("agentPassword", task.agentPassword)
    : undefined;

  // Use credentials from database (or will use CUSTOM_GOOSE_URL later)
  const gooseUrl = task.agentUrl || null;

  // Load chat history from database
  let chatHistory: {
    role: string;
    message: string;
    sourceWebsocketID: string | null;
    artifacts: { content: unknown }[];
  }[] = [];
  let sessionId: string | null = null;

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
  } catch (error) {
    console.error("Error loading chat history:", error);
  }

  // Save user message with artifacts and sourceWebsocketID to database if taskId is provided
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

  // If CUSTOM_GOOSE_URL is set, use it as-is (it should be the full ws:// URL)
  // export CUSTOM_GOOSE_URL=ws://0.0.0.0:8888/ws
  let wsUrl: string;

  if (process.env.CUSTOM_GOOSE_URL) {
    wsUrl = process.env.CUSTOM_GOOSE_URL;
    console.log("🧪 Using custom dev Goose URL from CUSTOM_GOOSE_URL:", wsUrl);
  } else {
    // Use gooseUrl from task credentials (stored in database)
    if (!gooseUrl) {
      return NextResponse.json(
        { error: "No Goose URL available. Agent credentials not properly configured." },
        { status: 400 },
      );
    }

    wsUrl = gooseUrl.replace(/^https?:\/\//, "wss://").replace(/\/$/, "") + "/ws";
    console.log("🔐 Using Goose URL from task credentials:", wsUrl);
  }

  console.log("🤖 Final Goose WebSocket URL:", wsUrl);

  const isResumingSession = chatHistory.length > 0 && !!sessionId;
  if (isResumingSession) {
    console.log("🔄 Resuming conversation with session ID:", sessionId);
  } else {
    console.log("🆕 Starting new conversation - provider will create session via REST API");
  }

  // Prepare logger if custom Goose URL is set
  const logger = process.env.CUSTOM_GOOSE_URL
    ? {
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
      }
    : undefined;

  // Validate session immediately before creating model
  const { sessionId: validatedSessionId, oldSessionInvalidated } = await validateGooseSession({
    wsUrl,
    sessionId: isResumingSession ? (sessionId ?? undefined) : undefined,
    logger,
    authToken: agentPassword || "asdfasdf",
  });

  // Create model with validated session ID
  const model = gooseWeb("goose", {
    wsUrl,
    sessionId: validatedSessionId,
    authToken: agentPassword || "asdfasdf",
    assumeSessionValid: true,
    ...(logger ? { logger } : {}),
  });

  console.log("✅ Session validated:", {
    sessionId: validatedSessionId,
    oldSessionInvalidated,
  });

  // Update database with session ID
  if (oldSessionInvalidated) {
    console.log("⚠️ Old session was invalidated - updating ALL messages to new session");
  }

  try {
    // If old session was invalidated, update ALL messages to the new session
    // Otherwise, only update messages that don't have a session ID yet
    const whereCondition = oldSessionInvalidated ? { taskId } : { taskId, sourceWebsocketID: null };

    await db.chatMessage.updateMany({
      where: whereCondition,
      data: {
        sourceWebsocketID: validatedSessionId,
      },
    });

    console.log("✅ Saved session ID to database:", validatedSessionId);
  } catch (error) {
    console.error("Error saving session ID:", error);
  }

  // Build messages array
  // Logic:
  // - If starting new (no chat history), send system prompt + current message
  // - If old session was invalidated, treat as new session and send full history
  // - If resuming valid session, Goose already has history, just send current message
  const messages: ModelMessage[] = [];

  if (!isResumingSession || oldSessionInvalidated) {
    // New session or invalidated session - include system prompt
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

    if (oldSessionInvalidated) {
      console.log("⚠️ Old session invalidated - sending full conversation history");
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
