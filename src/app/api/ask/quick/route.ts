import { NextRequest, NextResponse } from "next/server";
import { badRequest, notFound, serverError, forbidden } from "@/types/errors";
import { handleApiError } from "@/lib/api/errors";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { QUICK_ASK_SYSTEM_PROMPT } from "@/lib/constants/prompt";
import { askTools } from "@/lib/ai/askTools";
import { streamText, hasToolCall, ModelMessage } from "ai";
import { getModel, getApiKeyForProvider } from "aieo";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";

type Provider = "anthropic" | "google" | "openai" | "claude_code";

export async function GET(request: NextRequest) {
  try {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const question = searchParams.get("question");
    const workspaceSlug = searchParams.get("workspace");

    if (!question) {
      throw badRequest("Missing required parameter: question");
    }
    if (!workspaceSlug) {
      throw badRequest("Missing required parameter: workspace");
    }

    const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, userOrResponse.id);
    if (!workspaceAccess.hasAccess) {
      throw forbidden("Workspace not found or access denied");
    }

    const swarm = await db.swarm.findFirst({
      where: { workspaceId: workspaceAccess.workspace?.id },
    });
    if (!swarm) {
      throw notFound("Swarm not found for this workspace");
    }
    if (!swarm.swarmUrl) {
      throw notFound("Swarm URL not configured");
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
      throw notFound("Repository URL not configured for this swarm");
    }

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceAccess.workspace?.id },
      select: { slug: true },
    });

    if (!workspace) {
      throw notFound("Workspace not found");
    }

    const githubProfile = await getGithubUsernameAndPAT(userOrResponse.id, workspace.slug);
    const pat = githubProfile?.token;

    if (!pat) {
      throw notFound("GitHub PAT not found for this user");
    }

    const provider: Provider = "anthropic";
    const apiKey = getApiKeyForProvider(provider);
    const model = await getModel(provider, apiKey, workspaceSlug);
    const tools = askTools(baseSwarmUrl, decryptedSwarmApiKey, repoUrl, pat, apiKey);

    const messages: ModelMessage[] = [
      { role: "system", content: QUICK_ASK_SYSTEM_PROMPT },
      { role: "user", content: question },
    ];

    console.log("🤖 Creating generateText with:", {
      model: model?.modelId,
      toolsCount: Object.keys(tools).length,
      messagesCount: messages.length,
      question: question,
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
    } catch {
      throw serverError("Failed to create stream");
    }
  } catch (error) {
    return handleApiError(error);
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
