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

  // Create custom stream that properly maps Goose tool events to UI format
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let accumulatedText = "";
      let assistantMessageId: string | null = null;
      let lastSaveTimestamp = Date.now();
      const SAVE_INTERVAL = 3000; // Save every 3 seconds

      const sendEvent = (data: unknown) => {
        const line = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(line));
      };

      // Save progress to database incrementally
      const saveProgress = async (status: "STREAMING" | "SENT") => {
        if (!taskId || !accumulatedText) return;

        try {
          if (!assistantMessageId) {
            // Create initial assistant message
            const msg = await db.chatMessage.create({
              data: {
                taskId,
                message: accumulatedText,
                role: ChatRole.ASSISTANT,
                status: status === "STREAMING" ? ChatStatus.SENDING : ChatStatus.SENT,
                sourceWebsocketID: sessionId,
              },
            });
            assistantMessageId = msg.id;
            console.log("💾 Created assistant message:", assistantMessageId);
          } else {
            // Update existing message
            await db.chatMessage.update({
              where: { id: assistantMessageId },
              data: {
                message: accumulatedText,
                status: status === "STREAMING" ? ChatStatus.SENDING : ChatStatus.SENT,
              },
            });
            console.log(`💾 Updated assistant message (${status}):`, assistantMessageId);
          }
        } catch (error) {
          console.error("Error saving assistant response:", error);
        }
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
              // Accumulate text for incremental saves
              accumulatedText += chunk.text;

              // AI SDK fullStream uses 'text' field, but our UI expects 'delta'
              sendEvent({
                type: "text-delta",
                id: chunk.id,
                delta: chunk.text,
              });

              // Save periodically while streaming
              if (Date.now() - lastSaveTimestamp > SAVE_INTERVAL) {
                await saveProgress("STREAMING");
                lastSaveTimestamp = Date.now();
              }
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

        // Final save with SENT status
        await saveProgress("SENT");

        // Send done marker
        sendEvent("[DONE]");
        controller.close();
      } catch (error) {
        console.error("Stream error:", error);

        // Mark message as failed if we created one
        if (assistantMessageId) {
          try {
            await db.chatMessage.update({
              where: { id: assistantMessageId },
              data: { status: ChatStatus.ERROR },
            });
            console.log("❌ Marked assistant message as ERROR:", assistantMessageId);
          } catch (updateError) {
            console.error("Error updating message status to ERROR:", updateError);
          }
        }

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
