import { NextRequest, NextResponse, after } from "next/server";
import { validationError, notFoundError, serverError, forbiddenError, isApiError } from "@/types/errors";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getQuickAskPrefixMessages } from "@/lib/constants/prompt";
import { askTools, listConcepts, createHasEndMarkerCondition, clueToolMsgs } from "@/lib/ai/askTools";
import { streamText, ModelMessage, generateObject, UIMessage, convertToModelMessages } from "ai";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { z } from "zod";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { sanitizeAndCompleteToolCalls } from "@/lib/ai/message-sanitizer";

type Provider = "anthropic" | "google" | "openai" | "claude_code";

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
 */
function extractConceptIdsFromStep(contents: unknown): string[] {
  if (!Array.isArray(contents)) return [];

  const conceptIds: string[] = [];
  for (const content of contents) {
    if (content.type === "tool-call" && content.toolName === "learn_concept") {
      const conceptId = content.input?.conceptId;
      if (conceptId) {
        conceptIds.push(conceptId);
      }
    }
  }
  return conceptIds;
}

/**
 * Fetch provenance data from stakgraph
 * curl -X POST "http://localhost:3355/gitree/link-files"
 */
async function fetchProvenance(swarmUrl: string, apiKey: string, conceptIds: string[]): Promise<ProvenanceData> {
  console.log("========================> 🔍 fetchProvenance:", conceptIds);
  console.log("========================> 🔍 swarmUrl:", swarmUrl);
  console.log("========================> 🔍 apiKey:", apiKey);
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
    const lastMessageContent =
      typeof lastMessage?.content === "string"
        ? lastMessage.content
        : Array.isArray(lastMessage?.content)
          ? lastMessage.content.find((part: any) => part.type === "text")?.text || ""
          : "";

    const clueMsgs = await clueToolMsgs(baseSwarmUrl, decryptedSwarmApiKey, lastMessageContent);

    // console.log("features:", features);
    // Convert UIMessages from frontend to ModelMessages
    // The frontend sends UIMessage[] format, but the AI SDK needs ModelMessage[]
    let convertedMessages: ModelMessage[];
    try {
      // Log message format for debugging
      console.log("📨 [quick-ask] Input messages format:", {
        count: messages.length,
        sample: messages.slice(0, 2).map((m: any) => ({
          role: m.role,
          hasId: "id" in m,
          contentType: typeof m.content,
          isArray: Array.isArray(m.content),
          contentSample:
            typeof m.content === "string"
              ? m.content.slice(0, 50)
              : Array.isArray(m.content)
                ? m.content.slice(0, 2).map((c: any) => ({ type: c.type, hasText: !!c.text }))
                : "unknown",
        })),
      });

      // Try to convert UIMessages to ModelMessages
      convertedMessages = convertToModelMessages(messages as UIMessage[]);
    } catch (conversionError) {
      // If conversion fails, the messages might already be in ModelMessage format
      // or in an unexpected format - try to use them directly
      console.warn("⚠️ [quick-ask] Message conversion failed, using messages directly:", {
        error: conversionError instanceof Error ? conversionError.message : String(conversionError),
        messageRoles: messages.map((m: any) => m.role),
      });
      convertedMessages = messages as ModelMessage[];
    }

    // Construct messages array with system prompt, pre-filled concepts, and conversation history
    const rawMessages: ModelMessage[] = [
      ...getQuickAskPrefixMessages(features, repoUrl, clueMsgs),
      // Conversation history (converted to proper ModelMessage format)
      ...convertedMessages,
    ];

    // Sanitize messages: execute incomplete tool-calls to get missing results
    const modelMessages = await sanitizeAndCompleteToolCalls(rawMessages, baseSwarmUrl, decryptedSwarmApiKey);

    console.log("========= clueMsgs:");
    for (const msg of modelMessages) {
      console.log("========= msg:", JSON.stringify(msg, null, 2).slice(0, 400));
    }

    console.log("🤖 Creating generateText with:", {
      model: model?.modelId,
      toolsCount: Object.keys(tools).length,
      messagesCount: modelMessages.length,
      conversationLength: messages.length,
    });

    try {
      // Collect concept IDs during streaming for provenance
      const learnedConceptIds = new Set<string>();

      const result = streamText({
        model,
        tools,
        messages: modelMessages,
        stopWhen: createHasEndMarkerCondition(),
        stopSequences: ["[END_OF_ANSWER]"],
        onStepFinish: (sf) => {
          // Collect concept IDs for provenance
          const conceptIds = extractConceptIdsFromStep(sf.content);
          conceptIds.forEach((id) => learnedConceptIds.add(id));

          // Original processStep logic
          processStep(sf.content, workspaceSlug, features);
        },
      });

      after(async () => {
        // Generate follow-up questions
        try {
          const followUpSchema = z.object({
            questions: z
              .array(z.string())
              .length(3)
              .describe("3 short, specific follow-up questions (max 10 words each)"),
          });

          // Convert messages to simple text format for follow-up generation
          // This avoids confusing the model with tool-call/tool-result XML-like syntax
          const conversationSummary = messages
            .filter((m: ModelMessage) => m.role === "user" || m.role === "assistant")
            .map((m: ModelMessage) => {
              const role = m.role === "user" ? "User" : "Assistant";
              let text = "";
              if (typeof m.content === "string") {
                text = m.content;
              } else if (Array.isArray(m.content)) {
                // Extract only text content, skip tool calls/results
                text = m.content
                  .filter((part: any) => part.type === "text")
                  .map((part: any) => part.text)
                  .join("\n");
              }
              return text ? `${role}: ${text}` : null;
            })
            .filter(Boolean)
            .join("\n\n");

          const followUpModel = await getModel("anthropic", apiKey, workspaceSlug);

          const followUpResult = await generateObject({
            model: followUpModel,
            schema: followUpSchema,
            prompt: `Based on this conversation, generate 3 short follow-up questions:\n\n${conversationSummary}`,
            system:
              "You are a helpful code learning assistant. Your job is to generate 3 short follow-up questions based on the conversation. Questions should be specific, contextual, and help the user dig deeper or explore related topics. Don't ask very general questions! Try to guess what the user might ask next as part of the conversation, and output that! Avoid repeating questions that have already been asked. Keep each question under 10 words.",
            temperature: 0.3,
          });

          const channelName = getWorkspaceChannelName(workspaceSlug);
          const payload = {
            questions: followUpResult.object.questions,
            timestamp: Date.now(),
          };

          await pusherServer.trigger(channelName, PUSHER_EVENTS.FOLLOW_UP_QUESTIONS, payload);

          console.log("✅ Follow-up questions generated and sent:", followUpResult.object.questions);
        } catch (error) {
          console.error("❌ Error generating follow-up questions:", error);
          // Silent failure - don't break the chat flow
        }

        // Generate provenance
        try {
          const conceptIds = Array.from(learnedConceptIds);

          console.log("========================> 🔍 conceptIds:", conceptIds);
          if (conceptIds.length > 0) {
            console.log("🔍 Fetching provenance for concepts:", conceptIds);

            const provenance = await fetchProvenance(baseSwarmUrl, decryptedSwarmApiKey, conceptIds);

            const channelName = getWorkspaceChannelName(workspaceSlug);
            await pusherServer.trigger(channelName, PUSHER_EVENTS.PROVENANCE_DATA, {
              provenance,
              timestamp: Date.now(),
            });

            console.log("✅ Provenance data sent:", provenance.concepts.length, "concepts");
          } else {
            console.log("ℹ️ No concepts used in this response");
          }
        } catch (error) {
          console.error("❌ Error generating provenance:", error);
          // Silent failure - don't break the chat flow
        }
      });

      return result.toUIMessageStreamResponse();
    } catch (streamError) {
      // Log detailed error info for debugging
      console.error("❌ [quick-ask] Stream creation failed:", {
        error: streamError,
        errorMessage: streamError instanceof Error ? streamError.message : String(streamError),
        errorName: streamError instanceof Error ? streamError.name : "Unknown",
        // Log message structure for debugging tool call issues
        messageCount: modelMessages.length,
        messageRoles: modelMessages.map((m) => m.role),
        // Check for any remaining tool calls without results
        messageStructure: modelMessages.map((m, i) => {
          if (m.role === "assistant" && Array.isArray(m.content)) {
            const toolCalls = m.content.filter((c: any) => c.type === "tool-call");
            return {
              index: i,
              role: m.role,
              toolCalls: toolCalls.map((tc: any) => ({ id: tc.toolCallId, name: tc.toolName })),
            };
          }
          if (m.role === "tool" && Array.isArray(m.content)) {
            const toolResults = m.content.filter((c: any) => c.type === "tool-result");
            return {
              index: i,
              role: m.role,
              toolResults: toolResults.map((tr: any) => ({ id: tr.toolCallId, name: tr.toolName })),
            };
          }
          return { index: i, role: m.role };
        }),
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
      // console.log("TOOL RESULT:", content.toolName, ":", content.output);
      console.log("TOOL RESULT:", content.toolName);
    }
  }
}
