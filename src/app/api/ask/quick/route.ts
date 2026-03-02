import { NextRequest, NextResponse, after } from "next/server";
import { validationError, notFoundError, serverError, forbiddenError, isApiError } from "@/types/errors";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getQuickAskPrefixMessages, getMultiWorkspacePrefixMessages } from "@/lib/constants/prompt";
import { askTools, listConcepts, createHasEndMarkerCondition } from "@/lib/ai/askTools";
import { askToolsMulti } from "@/lib/ai/askToolsMulti";
import { WorkspaceConfig } from "@/lib/ai/types";
import { streamText, ModelMessage, generateObject, ToolSet } from "ai";
import { getModel, getApiKeyForProvider, type Provider } from "@/lib/ai/provider";
import { z } from "zod";
import { getMiddlewareContext, requireAuth, checkIsSuperAdmin } from "@/lib/middleware/utils";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { sanitizeAndCompleteToolCalls } from "@/lib/ai/message-sanitizer";

/**
 * Provenance data types
 */
interface ProvenanceData {
  concepts: Array<{
    refId: string;
    name: string;
    description?: string;
    files: Array<{
      refId: string;
      name: string;
      path: string;
      codeEntities: Array<{
        refId: string;
        name: string;
        nodeType: string;
        file: string;
        start: number;
        end: number;
      }>;
    }>;
  }>;
}

/**
 * Extract concept IDs from step content (used during streaming)
 * Handles both plain tool names (learn_concept) and namespaced (workspace__learn_concept)
 */
function extractConceptIdsFromStep(contents: unknown): string[] {
  if (!Array.isArray(contents)) return [];

  const conceptIds: string[] = [];
  for (const content of contents) {
    if (content.type === "tool-call") {
      const toolName: string = content.toolName || "";
      if (toolName === "learn_concept" || toolName.endsWith("__learn_concept")) {
        const conceptId = content.input?.conceptId;
        if (conceptId) {
          conceptIds.push(conceptId);
        }
      }
    }
  }
  return conceptIds;
}

/**
 * Fetch provenance data from stakgraph
 */
async function fetchProvenance(swarmUrl: string, apiKey: string, conceptIds: string[]): Promise<ProvenanceData> {
  const response = await fetch(`${swarmUrl}/gitree/provenance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": apiKey,
    },
    body: JSON.stringify({ conceptIds }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch provenance: ${response.status}`);
  }

  return response.json();
}

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { messages, workspaceSlug, workspaceSlugs } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw validationError("Missing required parameter: messages (must be a non-empty array)");
    }

    // Normalize to array (supports both single slug and array)
    const slugs: string[] = workspaceSlugs || (workspaceSlug ? [workspaceSlug] : []);

    if (slugs.length === 0) {
      throw validationError("Missing required parameter: workspaceSlug or workspaceSlugs");
    }
    if (slugs.length > 5) {
      throw validationError("Maximum 5 workspaces allowed per session");
    }

    const isMultiWorkspace = slugs.length > 1;
    const primarySlug = slugs[0];

    const provider: Provider = "anthropic";
    const apiKey = getApiKeyForProvider(provider);
    const model = getModel(provider, apiKey, primarySlug);

    // Normalize incoming messages to ModelMessage[] format
    const convertedMessages: ModelMessage[] = messages
      .map((m: any): ModelMessage | null => {
        let role = m.role;
        if (!role || !["user", "assistant", "system", "tool"].includes(role)) {
          role = "user";
        }
        let content = m.content;
        if (content === undefined || content === null) {
          if (role === "tool") return null;
          content = "";
        }
        return { role, content } as ModelMessage;
      })
      .filter((m): m is ModelMessage => m !== null);

    // ============================================================
    // Build the varying pieces: tools, prefixMessages, features,
    // and swarm credentials (for sanitization + provenance)
    // ============================================================
    let tools: ToolSet;
    let prefixMessages: ModelMessage[];
    let features: Record<string, unknown>[];
    let primarySwarmUrl: string;
    let primarySwarmApiKey: string;

    if (isMultiWorkspace) {
      const workspaceConfigs = await buildWorkspaceConfigs(slugs, userOrResponse.id);
      tools = askToolsMulti(workspaceConfigs, apiKey);

      const conceptsByWorkspace = await fetchConceptsForWorkspaces(workspaceConfigs);

      features = [];
      for (const ws of workspaceConfigs) {
        features.push(...(conceptsByWorkspace[ws.slug] || []));
      }

      prefixMessages = getMultiWorkspacePrefixMessages(workspaceConfigs, conceptsByWorkspace, []);
      primarySwarmUrl = workspaceConfigs[0].swarmUrl;
      primarySwarmApiKey = workspaceConfigs[0].swarmApiKey;
    } else {
      const config = await buildWorkspaceConfigs(slugs, userOrResponse.id);
      const ws = config[0];

      tools = askTools(ws.swarmUrl, ws.swarmApiKey, ws.repoUrls, ws.pat, apiKey);

      const concepts = await listConcepts(ws.swarmUrl, ws.swarmApiKey);
      features = (concepts.features as Record<string, unknown>[]) || [];

      prefixMessages = getQuickAskPrefixMessages(features, ws.repoUrls, []);
      primarySwarmUrl = ws.swarmUrl;
      primarySwarmApiKey = ws.swarmApiKey;
    }

    // ============================================================
    // Shared pipeline: build messages, stream, follow-ups, provenance
    // ============================================================
    const rawMessages: ModelMessage[] = [...prefixMessages, ...convertedMessages];
    const modelMessages = await sanitizeAndCompleteToolCalls(rawMessages, primarySwarmUrl, primarySwarmApiKey);

    console.log("🤖 Creating streamText with:", {
      model: (model as any)?.modelId,
      toolsCount: Object.keys(tools).length,
      messagesCount: modelMessages.length,
      workspaces: slugs,
    });

    try {
      const learnedConceptIds = new Set<string>();

      const result = streamText({
        model,
        tools,
        messages: modelMessages,
        stopWhen: createHasEndMarkerCondition(),
        stopSequences: ["[END_OF_ANSWER]"],
        onStepFinish: (sf) => {
          const conceptIds = extractConceptIdsFromStep(sf.content);
          conceptIds.forEach((id) => learnedConceptIds.add(id));
          processStep(sf.content, primarySlug, features);
        },
      });

      after(async () => {
        // Generate follow-up questions
        try {
          const followUpSchema = z.object({
            questions: z
              .array(z.string())
              .describe("Exactly 3 short, specific follow-up questions (max 10 words each)"),
          });

          const conversationSummary = messages
            .filter((m: ModelMessage) => m.role === "user" || m.role === "assistant")
            .map((m: ModelMessage) => {
              const role = m.role === "user" ? "User" : "Assistant";
              let text = "";
              if (typeof m.content === "string") {
                text = m.content;
              } else if (Array.isArray(m.content)) {
                text = m.content
                  .filter((part: any) => part.type === "text")
                  .map((part: any) => part.text)
                  .join("\n");
              }
              return text ? `${role}: ${text}` : null;
            })
            .filter(Boolean)
            .join("\n\n");

          const followUpModel = getModel("anthropic", apiKey, primarySlug);

          const followUpResult = await generateObject({
            model: followUpModel,
            schema: followUpSchema,
            prompt: `Based on this conversation, generate 3 short follow-up questions:\n\n${conversationSummary}`,
            system:
              "Generate 3 questions that the USER would naturally ask next as a follow-up in this conversation. Write them from the user's perspective, as if the user is typing them. They should be specific to the codebase and conversation context. NEVER generate clarifying questions directed at the user (like 'What kind of X are you interested in?'). Instead predict the user's next question (like 'How does the auth middleware work?' or 'Where are the API routes defined?'). Keep each under 10 words. Don't repeat questions already asked.",
            temperature: 0.3,
          });

          const channelName = getWorkspaceChannelName(primarySlug);
          await pusherServer.trigger(channelName, PUSHER_EVENTS.FOLLOW_UP_QUESTIONS, {
            questions: followUpResult.object.questions,
            timestamp: Date.now(),
          });

          console.log("✅ Follow-up questions sent:", followUpResult.object.questions);
        } catch (error) {
          console.error("❌ Error generating follow-up questions:", error);
        }

        // Generate provenance
        try {
          const conceptIds = Array.from(learnedConceptIds);
          if (conceptIds.length > 0) {
            const provenance = await fetchProvenance(primarySwarmUrl, primarySwarmApiKey, conceptIds);
            const channelName = getWorkspaceChannelName(primarySlug);
            await pusherServer.trigger(channelName, PUSHER_EVENTS.PROVENANCE_DATA, {
              provenance,
              timestamp: Date.now(),
            });
            console.log("✅ Provenance data sent:", provenance.concepts.length, "concepts");
          }
        } catch (error) {
          console.error("❌ Error generating provenance:", error);
        }
      });

      return result.toUIMessageStreamResponse();
    } catch (streamError) {
      console.error("❌ [quick-ask] Stream creation failed:", {
        error: streamError,
        errorMessage: streamError instanceof Error ? streamError.message : String(streamError),
        workspaces: slugs,
      });
      throw serverError("Failed to create stream");
    }
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json(
        { error: error.message, kind: error.kind, details: error.details },
        { status: error.statusCode },
      );
    }
    console.error("❌ [quick-ask] Unhandled error:", error);
    return NextResponse.json({ error: "Failed to process quick ask" }, { status: 500 });
  }
}

async function processStep(contents: unknown, workspaceSlug: string, features: Record<string, unknown>[]) {
  logStep(contents);
  if (!Array.isArray(contents)) return;
  let conceptRefId: string | undefined;
  for (const content of contents) {
    if (content.type === "tool-call") {
      const toolName: string = content.toolName || "";
      if (toolName === "learn_concept" || toolName.endsWith("__learn_concept")) {
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
  await pusherServer.trigger(channelName, PUSHER_EVENTS.HIGHLIGHT_NODES, eventPayload);
  console.log("highlighted node:", conceptRefId);
}

function logStep(contents: unknown) {
  if (!Array.isArray(contents)) return;
  for (const content of contents) {
    if (content.type === "tool-call") {
      console.log("TOOL CALL:", content.toolName, ":", content.input);
    }
    if (content.type === "tool-result") {
      console.log("TOOL RESULT:", content.toolName);
    }
  }
}

/**
 * Build WorkspaceConfig[] by validating access, fetching swarm credentials,
 * repositories, and GitHub PAT for each workspace.
 * Works for both single and multi-workspace — always takes an array of slugs.
 */
async function buildWorkspaceConfigs(
  slugs: string[],
  userId: string
): Promise<WorkspaceConfig[]> {
  const encryptionService = EncryptionService.getInstance();
  const configs: WorkspaceConfig[] = [];
  const isSuperAdmin = await checkIsSuperAdmin(userId);

  for (const slug of slugs) {
    const access = await validateWorkspaceAccess(slug, userId, true, { isSuperAdmin });
    if (!access.hasAccess || !access.workspace) {
      throw forbiddenError(`Access denied for workspace: ${slug}`);
    }

    const swarm = await db.swarm.findFirst({
      where: { workspaceId: access.workspace.id },
    });
    if (!swarm?.swarmUrl) {
      throw notFoundError(`Swarm not configured for workspace: ${slug}`);
    }

    const repositories = await db.repository.findMany({
      where: { workspaceId: access.workspace.id },
      orderBy: { createdAt: "asc" },
    });
    if (repositories.length === 0) {
      throw notFoundError(`No repositories for workspace: ${slug}`);
    }

    const githubProfile = await getGithubUsernameAndPAT(userId, slug);
    if (!githubProfile?.token) {
      throw notFoundError(`GitHub PAT not found for workspace: ${slug}`);
    }

    const swarmUrlObj = new URL(swarm.swarmUrl);
    let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
    if (swarm.swarmUrl.includes("localhost")) {
      baseSwarmUrl = "http://localhost:3355";
    }

    configs.push({
      slug,
      swarmUrl: baseSwarmUrl,
      swarmApiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey || ""),
      repoUrls: repositories.map((r) => r.repositoryUrl),
      pat: githubProfile.token,
    });
  }

  return configs;
}

/**
 * Fetch concepts for all workspaces in parallel.
 */
async function fetchConceptsForWorkspaces(
  configs: WorkspaceConfig[]
): Promise<Record<string, Record<string, unknown>[]>> {
  const conceptsByWorkspace: Record<string, Record<string, unknown>[]> = {};

  await Promise.all(
    configs.map(async (ws) => {
      try {
        const concepts = await listConcepts(ws.swarmUrl, ws.swarmApiKey);
        conceptsByWorkspace[ws.slug] = (concepts.features as Record<string, unknown>[]) || [];
      } catch (e) {
        console.error(`Failed to fetch concepts for ${ws.slug}:`, e);
        conceptsByWorkspace[ws.slug] = [];
      }
    })
  );

  return conceptsByWorkspace;
}
