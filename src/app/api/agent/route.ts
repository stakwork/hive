import { NextRequest, NextResponse } from "next/server";
import { validationError, notFoundError, serverError, forbiddenError, isApiError } from "@/types/errors";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { askTools } from "@/lib/ai/askTools";
import { streamText, ModelMessage, hasToolCall } from "ai";
import { getModel, getApiKeyForProvider } from "aieo";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { ChatRole, ChatStatus } from "@/lib/chat";
import { gooseWeb } from "ai-sdk-provider-goose-web";

type Provider = "anthropic" | "google" | "openai" | "claude_code";

export async function POST(request: NextRequest) {
  const model = gooseWeb("goose", {
    wsUrl: "ws://localhost:8888/ws",
  });

  const body = await request.json();
  const { message, history = [] } = body;

  // Build messages array from history
  const messages: ModelMessage[] = [{ role: "system", content: AGENT_SYSTEM_PROMPT }];

  // Add history if provided
  if (Array.isArray(history) && history.length > 0) {
    for (const msg of history) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({
          role: msg.role,
          content: msg.content || msg.message || "",
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

      const sendEvent = (data: any) => {
        const line = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(line));
      };

      try {
        // Send start event
        sendEvent({ type: "start" });
        sendEvent({ type: "start-step" });

        for await (const chunk of result.fullStream) {
          console.log("[GOOSE->UI]", chunk.type, chunk);

          switch (chunk.type) {
            case "text-start":
              sendEvent({
                type: "text-start",
                id: chunk.id,
              });
              break;

            case "text-delta":
              sendEvent({
                type: "text-delta",
                id: chunk.id,
                delta: chunk.text,
              });
              break;

            case "text-end":
              sendEvent({
                type: "text-end",
                id: chunk.id,
              });
              break;

            case "tool-call":
              console.log("TOOL CALL (STREAMING):", chunk.toolName);
              // Send tool-input-start
              sendEvent({
                type: "tool-input-start",
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
              });

              // Send tool-input-available with the parsed input
              sendEvent({
                type: "tool-input-available",
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: chunk.input,
              });
              break;

            case "tool-result":
              console.log("TOOL RESULT (STREAMING):", chunk.toolName);
              // Send tool-output-available
              sendEvent({
                type: "tool-output-available",
                toolCallId: chunk.toolCallId,
                output: chunk.output,
              });
              break;

            case "tool-error":
              console.log("TOOL ERROR:", chunk.toolName, chunk.error);
              // Tool errors don't have results, skip them for now
              // The AI SDK handles these internally
              break;

            case "error":
              console.log("ERROR:", chunk);
              sendEvent({
                type: "error",
                error: chunk.error,
              });
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

export async function PUT(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { message, taskId, workspaceSlug, history = [] } = body;

    if (!message) {
      throw validationError("Missing required parameter: message");
    }
    if (!workspaceSlug) {
      throw validationError("Missing required parameter: workspaceSlug");
    }
    if (!taskId) {
      throw validationError("Missing required parameter: taskId");
    }

    const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, userOrResponse.id);
    if (!workspaceAccess.hasAccess) {
      throw forbiddenError("Workspace not found or access denied");
    }

    // Verify task access
    const task = await db.task.findFirst({
      where: {
        id: taskId,
        workspaceId: workspaceAccess.workspace?.id,
        deleted: false,
      },
    });

    if (!task) {
      throw notFoundError("Task not found or access denied");
    }

    const swarm = await db.swarm.findFirst({
      where: { workspaceId: workspaceAccess.workspace?.id },
    });
    if (!swarm) {
      throw notFoundError("Swarm not found for this workspace");
    }
    if (!swarm.swarmUrl) {
      throw notFoundError("Swarm URL not configured");
    }

    const encryptionService: EncryptionService = EncryptionService.getInstance();
    const decryptedSwarmApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey || "");

    const swarmUrlObj = new URL(swarm.swarmUrl);
    let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
    if (swarm.swarmUrl.includes("localhost")) {
      baseSwarmUrl = `http://localhost:3355`;
    }

    const primaryRepo = await getPrimaryRepository(swarm.workspaceId);
    const repoUrl = primaryRepo?.repositoryUrl;
    if (!repoUrl) {
      throw notFoundError("Repository URL not configured for this swarm");
    }

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceAccess.workspace?.id },
      select: { slug: true },
    });

    if (!workspace) {
      throw notFoundError("Workspace not found");
    }

    const githubProfile = await getGithubUsernameAndPAT(userOrResponse.id, workspace.slug);
    const pat = githubProfile?.token;

    if (!pat) {
      throw notFoundError("GitHub PAT not found for this user");
    }

    // Save user message to database
    await db.chatMessage.create({
      data: {
        taskId,
        message,
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      },
    });

    const provider: Provider = "anthropic";
    const apiKey = getApiKeyForProvider(provider);
    const model = await getModel(provider, apiKey, workspaceSlug);
    console.log("🤖 Model:", model);
    const tools = askTools(baseSwarmUrl, decryptedSwarmApiKey, repoUrl, pat, apiKey);
    console.log("🤖 Tools:", baseSwarmUrl, decryptedSwarmApiKey, repoUrl, pat, apiKey);

    // Build messages array from history
    const messages: ModelMessage[] = [{ role: "system", content: AGENT_SYSTEM_PROMPT }];

    // Add history if provided
    if (Array.isArray(history) && history.length > 0) {
      for (const msg of history) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({
            role: msg.role,
            content: msg.content || msg.message || "",
          });
        }
      }
    }

    // Add current user message
    messages.push({ role: "user", content: message });

    console.log("🤖 Creating agent stream with:", {
      model: model?.modelId,
      toolsCount: Object.keys(tools).length,
      messagesCount: messages.length,
      taskId,
    });

    try {
      const result = streamText({
        model,
        tools,
        messages,
        stopWhen: hasToolCall("final_answer"),
        onStepFinish: (sf) => logStep(sf.content),
      });
      return result.toUIMessageStreamResponse();
    } catch (error) {
      console.error("Stream creation error:", error);
      throw serverError("Failed to create stream");
    }
  } catch (error) {
    console.error("Agent API error:", error);
    if (isApiError(error)) {
      return NextResponse.json(
        { error: error.message, kind: error.kind, details: error.details },
        { status: error.statusCode },
      );
    }
    return NextResponse.json({ error: "Failed to process agent request" }, { status: 500 });
  }
}

function logStep(contents: unknown) {
  if (!Array.isArray(contents)) return;
  for (const content of contents) {
    if (content.type === "tool-call") {
      console.log("TOOL CALL:", content.toolName, ":", content.input);
    }
    if (content.type === "tool-result") {
      console.log("TOOL RESULT:", content.toolName, ":", content.output);
    }
  }
}
