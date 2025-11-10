import { NextRequest, NextResponse, after } from "next/server";
import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { streamText, ModelMessage } from "ai";
import { ChatRole, ChatStatus, ArtifactType } from "@prisma/client";
import { gooseWeb, validateGooseSession } from "ai-sdk-provider-goose-web";
import { retryWithDelay } from "@/lib/utils/retry";

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

  // Validate session immediately before creating model (with retry logic)
  const { sessionId: validatedSessionId, oldSessionInvalidated } = await retryWithDelay(() =>
    validateGooseSession({
      wsUrl,
      sessionId: isResumingSession ? (sessionId ?? undefined) : undefined,
      logger,
      authToken: agentPassword || "asdfasdf",
    }),
  );

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

  // Create placeholder assistant message in DB (optimistic creation)
  const assistantMessage = await db.chatMessage.create({
    data: {
      taskId,
      message: "",
      role: ChatRole.ASSISTANT,
      status: ChatStatus.SENDING,
      contextTags: JSON.stringify([]),
      sourceWebsocketID: validatedSessionId,
    },
  });

  console.log("📝 Created placeholder assistant message:", assistantMessage.id);

  const result = streamText({
    model,
    messages,
  });

  // Tee the fullStream into two independent streams
  const [frontendFullStream, dbFullStream] = result.fullStream.tee();

  // Schedule background processing using after()
  after(async () => {
    console.log("🔄 Background processing started for message:", assistantMessage.id);
    let accumulatedText = "";
    let lastSaveLength = 0;
    const SAVE_INTERVAL = 200; // Save every 200 characters

    try {
      // Type assertion needed because .tee() loses async iterable typing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const chunk of dbFullStream as any) {
        // Only process text-delta chunks for message content
        if (chunk.type === "text-delta") {
          accumulatedText += chunk.text;

          // Incremental save every 200 characters
          if (accumulatedText.length - lastSaveLength >= SAVE_INTERVAL) {
            await db.chatMessage.update({
              where: { id: assistantMessage.id },
              data: { message: accumulatedText },
            });
            lastSaveLength = accumulatedText.length;
            console.log(`💾 Incremental save: ${accumulatedText.length} chars`);
          }
        }
      }

      // Final save with SENT status
      await db.chatMessage.update({
        where: { id: assistantMessage.id },
        data: {
          message: accumulatedText,
          status: ChatStatus.SENT,
        },
      });

      console.log("✅ Background processing completed, saved:", accumulatedText.length, "chars");
    } catch (error) {
      console.error("❌ Background processing error:", error);

      // Save partial message with ERROR status
      await db.chatMessage.update({
        where: { id: assistantMessage.id },
        data: {
          message: accumulatedText || "[Error: Stream processing failed]",
          status: ChatStatus.ERROR,
        },
      });
    }
  });

  // Create frontend stream that properly maps Goose tool events to UI format
  const frontendStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let clientDisconnected = false;

      const sendEvent = (data: unknown) => {
        // Check if controller is still open (desiredSize is null when closed)
        if (controller.desiredSize === null || clientDisconnected) {
          clientDisconnected = true;
          return false; // Signal that we should stop
        }

        try {
          const line = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(line));
          return true;
        } catch {
          // Client disconnected mid-enqueue
          console.log("🔌 Client disconnected during streaming");
          clientDisconnected = true;
          return false;
        }
      };

      try {
        // Send start event
        if (!sendEvent({ type: "start" })) return;
        if (!sendEvent({ type: "start-step" })) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const chunk of frontendFullStream as any) {
          // Exit early if client disconnected
          if (clientDisconnected) {
            console.log("⏹️ Stopping frontend stream processing (client disconnected)");
            break;
          }
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

        // Send done marker (only if client still connected)
        if (!clientDisconnected) {
          sendEvent("[DONE]");
        }

        // Close controller if still open (wrap in try-catch for race conditions)
        try {
          if (controller.desiredSize !== null) {
            controller.close();
          } else {
            console.log("✅ Client disconnected gracefully - background processing continues");
          }
        } catch {
          // Client disconnected between check and close (race condition)
          console.log("✅ Client disconnected during cleanup - background processing continues");
        }
      } catch (error) {
        // Only log and error the controller if it's still open
        try {
          if (controller.desiredSize !== null) {
            console.error("Frontend stream error:", error);
            controller.error(error);
          } else {
            console.log("⚠️ Stream error after client disconnect (expected):", error);
          }
        } catch {
          // Controller already closed during error handling
          console.log("⚠️ Stream error after client disconnect:", error);
        }
      }
    },
  });

  return new Response(frontendStream, {
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
