import { NextRequest, NextResponse } from "next/server";
import { validationError, notFoundError, serverError, forbiddenError, isApiError } from "@/types/errors";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { QUICK_ASK_SYSTEM_PROMPT } from "@/lib/constants/prompt";
import { askTools, listConcepts, createHasEndMarkerCondition } from "@/lib/ai/askTools";
import { streamText, ModelMessage } from "ai";
import { getModel, getApiKeyForProvider } from "aieo";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";

type Provider = "anthropic" | "google" | "openai" | "claude_code";

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { messages, workspaceSlug } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw validationError("Missing required parameter: messages (must be a non-empty array)");
    }
    if (!workspaceSlug) {
      throw validationError("Missing required parameter: workspaceSlug");
    }

    const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, userOrResponse.id);
    if (!workspaceAccess.hasAccess) {
      throw forbiddenError("Workspace not found or access denied");
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

    const provider: Provider = "anthropic";
    const apiKey = getApiKeyForProvider(provider);
    const model = await getModel(provider, apiKey, workspaceSlug);
    const tools = askTools(baseSwarmUrl, decryptedSwarmApiKey, repoUrl, pat, apiKey);

    const concepts = await listConcepts(baseSwarmUrl, decryptedSwarmApiKey);

    // Construct messages array with system prompt, pre-filled concepts, and conversation history
    const modelMessages: ModelMessage[] = [
      // System prompt
      { role: "system", content: QUICK_ASK_SYSTEM_PROMPT },
      // Pre-filled list_concepts tool call
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "list-1",
            toolName: "list_concepts",
            input: {},
          },
        ],
      },
      // Pre-filled list_concepts tool result
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "list-1",
            toolName: "list_concepts",
            output: {
              type: "json",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              value: concepts as any,
            },
          },
        ],
      },
      // Conversation history (convert from LearnMessage to ModelMessage format)
      ...messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
    ];

    console.log("🤖 Creating generateText with:", {
      model: model?.modelId,
      toolsCount: Object.keys(tools).length,
      messagesCount: modelMessages.length,
      conversationLength: messages.length,
    });

    try {
      const result = streamText({
        model,
        tools,
        messages: modelMessages,
        stopWhen: createHasEndMarkerCondition(),
        stopSequences: ["[END_OF_ANSWER]"],
        onStepFinish: (sf) => logStep(sf.content),
      });
      return result.toUIMessageStreamResponse();
    } catch {
      throw serverError("Failed to create stream");
    }
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json(
        { error: error.message, kind: error.kind, details: error.details },
        { status: error.statusCode },
      );
    }
    return NextResponse.json({ error: "Failed to process quick ask" }, { status: 500 });
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
