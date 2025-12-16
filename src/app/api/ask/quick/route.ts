import { NextRequest, NextResponse, after } from "next/server";
import { validationError, notFoundError, serverError, forbiddenError, isApiError } from "@/types/errors";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getQuickAskPrefixMessages } from "@/lib/constants/prompt";
import { askTools, listConcepts, createHasEndMarkerCondition, clueToolMsgs } from "@/lib/ai/askTools";
import { streamText, ModelMessage } from "ai";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";

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

    const features = concepts.features as Record<string, unknown>[];

    // Extract text content from last message (handle both string and array content)
    const lastMessage = messages[messages.length - 1];
    const lastMessageContent = typeof lastMessage?.content === "string"
      ? lastMessage.content
      : Array.isArray(lastMessage?.content)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? lastMessage.content.find((part: any) => part.type === "text")?.text || ""
        : "";

    const clueMsgs = await clueToolMsgs(baseSwarmUrl, decryptedSwarmApiKey, lastMessageContent);

    // console.log("features:", features);
    // Construct messages array with system prompt, pre-filled concepts, and conversation history
    const modelMessages: ModelMessage[] = [
      ...getQuickAskPrefixMessages(features, repoUrl, clueMsgs),
      // Conversation history (pass through as-is to support tool calls/results)
      ...messages as ModelMessage[],
    ];

    console.log("========= clueMsgs:");
    for (const msg of modelMessages) {
      console.log("========= msg:", JSON.stringify(msg, null, 2).slice(0, 400))
    }

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
        onStepFinish: (sf) => processStep(sf.content, workspaceSlug, features),
      });


      after(async () => {
        // ask ai for follow-up questions
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

async function processStep(contents: unknown, workspaceSlug: string, features: Record<string, unknown>[]) {
  logStep(contents);
  if (!Array.isArray(contents)) return;
  let conceptRefId: string | undefined;
  for (const content of contents) {
    if (content.type === "tool-call") {
      if (content.toolName === "learn_concept") {
        const conceptId = content.input.conceptId;
        const feature = features.find((f) => f.id === conceptId);
        if (feature) {
          conceptRefId = feature.ref_id as string;
        }
      }
    }
  }
  if (!conceptRefId) return;
  console.log("learned conceptRefId:", conceptRefId);
  const channelName = getWorkspaceChannelName(workspaceSlug);
  const eventPayload = {
    nodeIds: [],
    workspaceId: workspaceSlug,
    depth: 2,
    title: "Researching...",
    timestamp: Date.now(),
    sourceNodeRefId: conceptRefId,
  };
  await pusherServer.trigger(
    channelName,
    PUSHER_EVENTS.HIGHLIGHT_NODES,
    eventPayload,
  );
}

function logStep(contents: unknown) {
  if (!Array.isArray(contents)) return;
  for (const content of contents) {
    if (content.type === "tool-call") {
      console.log("TOOL CALL:", content.toolName, ":", content.input);
    }
    if (content.type === "tool-result") {
      // console.log("TOOL RESULT:", content.toolName, ":", content.output);
      console.log("TOOL RESULT:", content.toolName);
    }
  }
}
