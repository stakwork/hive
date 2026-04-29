import { NextRequest, NextResponse, after } from "next/server";
import { validationError, serverError, forbiddenError, isApiError } from "@/types/errors";
import { getQuickAskPrefixMessages, getMultiWorkspacePrefixMessages } from "@/lib/constants/prompt";
import { askTools, listConcepts, createHasEndMarkerCondition } from "@/lib/ai/askTools";
import { askToolsMulti } from "@/lib/ai/askToolsMulti";
import { buildWorkspaceConfigs, fetchConceptsForWorkspaces } from "@/lib/ai/workspaceConfig";
import { buildConnectionTools } from "@/lib/ai/connectionTools";
import { buildCanvasTools } from "@/lib/ai/canvasTools";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { streamText, ModelMessage, generateObject, ToolSet } from "ai";
import { getModel, getApiKeyForProvider, type Provider } from "@/lib/ai/provider";
import { z } from "zod";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { sanitizeAndCompleteToolCalls } from "@/lib/ai/message-sanitizer";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import {
  handleApproval,
  handleRejection,
  type MessageLike,
} from "@/lib/proposals/handleApproval";
import type {
  ApprovalIntent,
  RejectionIntent,
} from "@/lib/proposals/types";

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
    const {
      messages,
      workspaceSlug,
      workspaceSlugs,
      orgId,
      // Canvas page hints — only meaningful with `orgId`. All
      // optional; the prompt builder injects them as a small "current
      // scope" section when present. The breadcrumb is a precomputed
      // human-readable trail (e.g. "Acme › Auth Refactor") so the
      // agent can refer to the scope by name in replies.
      currentCanvasRef,
      currentCanvasBreadcrumb,
      selectedNodeId,
      // When true, skip the post-stream `after()` enrichment block
      // (follow-up questions + provenance). Surfaces that don't render
      // either (e.g. the org-canvas SidebarChat) opt in to save tokens
      // and avoid an unnecessary stakgraph round-trip.
      skipEnrichments,
      // Agent-proposal flow (see `src/lib/proposals/`). Set on the
      // user's send when they click Approve / Reject in a
      // `<ProposalCard>`. The route runs the side effect synchronously
      // BEFORE the LLM call (and skips the LLM entirely when the intent
      // is fully self-contained). The `canvasChatMessages` field carries
      // the chat-side raw transcript so the handler can scan for the
      // matching propose tool call and run its idempotency check —
      // `messages` (AI SDK ModelMessage[]) doesn't preserve the
      // structured intent fields.
      approvalIntent,
      rejectionIntent,
      canvasChatMessages,
    } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw validationError("Missing required parameter: messages (must be a non-empty array)");
    }

    // Normalize to array (supports both single slug and array)
    const slugs: string[] = workspaceSlugs || (workspaceSlug ? [workspaceSlug] : []);

    if (slugs.length === 0) {
      throw validationError("Missing required parameter: workspaceSlug or workspaceSlugs");
    }
    if (slugs.length > 20) {
      throw validationError("Maximum 20 workspaces allowed per session");
    }

    // ============================================================
    // Agent-proposal Approve / Reject flow.
    //
    // When the user clicks ✓ or ✗ on a `<ProposalCard>`, the chat
    // sends a normal message that carries `approvalIntent` (or
    // `rejectionIntent`) alongside `canvasChatMessages` (the raw
    // chat transcript). We run the side effect synchronously here
    // and return a small synthetic SSE stream — no LLM call.
    //
    // Done before tool / prefix construction because we don't need
    // any of that for these requests, and skipping the work saves a
    // stakgraph round-trip + token spend per click.
    // ============================================================
    if (approvalIntent || rejectionIntent) {
      if (!orgId) {
        throw validationError(
          "approvalIntent / rejectionIntent require orgId (org canvas chat only).",
        );
      }
      const orgBelongsToCaller = await validateUserBelongsToOrg(
        orgId,
        userOrResponse.id,
        "id",
      );
      if (!orgBelongsToCaller) {
        throw forbiddenError("Access denied for the specified organization");
      }
      const transcript: MessageLike[] = Array.isArray(canvasChatMessages)
        ? canvasChatMessages
        : [];
      return await runProposalIntent({
        orgId,
        userId: userOrResponse.id,
        transcript,
        approvalIntent,
        rejectionIntent,
      });
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

      // Merge org-scoped tools when orgId is provided. Both connection and
      // canvas tools are exposed simultaneously; the prompt teaches the
      // agent to pick based on intent (document-an-integration vs
      // draw-a-diagram).
      if (orgId) {
        // Verify the authenticated caller actually belongs to the supplied org
        // before granting canvas/connection write tools for it.
        const orgBelongsToCaller = await validateUserBelongsToOrg(
          orgId,
          userOrResponse.id,
          "id",
        );
        if (!orgBelongsToCaller) {
          throw forbiddenError("Access denied for the specified organization");
        }
        tools = {
          ...tools,
          ...buildConnectionTools(orgId, userOrResponse.id),
          ...buildCanvasTools(orgId),
          ...buildInitiativeTools(orgId, userOrResponse.id),
        };
      }

      const conceptsByWorkspace = await fetchConceptsForWorkspaces(workspaceConfigs);

      features = [];
      for (const ws of workspaceConfigs) {
        features.push(...(conceptsByWorkspace[ws.slug] || []));
      }

      prefixMessages = getMultiWorkspacePrefixMessages(
        workspaceConfigs,
        conceptsByWorkspace,
        [],
        orgId,
        {
          currentCanvasRef:
            typeof currentCanvasRef === "string" ? currentCanvasRef : undefined,
          currentCanvasBreadcrumb:
            typeof currentCanvasBreadcrumb === "string"
              ? currentCanvasBreadcrumb
              : undefined,
          selectedNodeId:
            typeof selectedNodeId === "string" ? selectedNodeId : undefined,
        },
      );
      primarySwarmUrl = workspaceConfigs[0].swarmUrl;
      primarySwarmApiKey = workspaceConfigs[0].swarmApiKey;
    } else {
      const config = await buildWorkspaceConfigs(slugs, userOrResponse.id);
      const ws = config[0];

      tools = askTools(ws.swarmUrl, ws.swarmApiKey, ws.repoUrls, ws.pat, apiKey, {
        workspaceId: ws.workspaceId,
        workspaceSlug: ws.slug,
        userId: ws.userId,
      });

      const concepts = await listConcepts(ws.swarmUrl, ws.swarmApiKey);
      features = (concepts.features as Record<string, unknown>[]) || [];

      prefixMessages = getQuickAskPrefixMessages(features, ws.repoUrls, [], ws.description, ws.members);
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
        // Surfaces that don't render follow-ups or provenance opt out
        // of computing them. Saves a `generateObject` round-trip and
        // a `${swarmUrl}/gitree/provenance` POST per turn.
        if (skipEnrichments) return;
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

// ─── Agent-proposal: synthetic SSE stream for Approve / Reject ─────
//
// We don't call the LLM for these clicks — the side effect is fully
// determined by the conversation transcript + intent. We synthesize a
// tiny UI-message-stream-shaped response (text-start / text-delta /
// text-end) carrying the human-readable summary, plus a custom
// `X-Approval-Result` header carrying the structured outcome JSON.
// The chat send hook reads that header before processing the stream
// and stamps `approvalResult` onto the assistant message before
// autosave persists. Forks then see the resolved state in transcript
// because the message JSON includes the field.
async function runProposalIntent(args: {
  orgId: string;
  userId: string;
  transcript: MessageLike[];
  approvalIntent?: ApprovalIntent;
  rejectionIntent?: RejectionIntent;
}): Promise<Response> {
  const { orgId, userId, transcript, approvalIntent, rejectionIntent } = args;

  let summaryText: string;
  let approvalResultHeader: string | null = null;
  let alreadyApproved = false;

  if (approvalIntent) {
    const outcome = await handleApproval({
      orgId,
      userId,
      messages: transcript,
      intent: approvalIntent,
    });
    if (!outcome.ok) {
      // Surface validation errors as the assistant text. The card UI
      // distinguishes "approval failed" from "approved" by checking
      // for `approvalResult` on the message; without it, the card
      // stays in pending-in-flight + shows the assistant text as the
      // failure reason. The HTTP status stays 200 so the SSE stream
      // still flushes cleanly.
      summaryText = `I couldn't create that: ${outcome.error}`;
    } else {
      const r = outcome.result;
      alreadyApproved = outcome.alreadyApproved;
      approvalResultHeader = JSON.stringify(r);
      const where =
        r.landedOn === ""
          ? "the org root canvas"
          : r.landedOn.startsWith("ws:")
            ? "a workspace canvas"
            : r.landedOn.startsWith("initiative:")
              ? "an initiative canvas"
              : r.landedOn.startsWith("milestone:")
                ? "a milestone canvas"
                : "the canvas";
      summaryText = alreadyApproved
        ? `Already created — opening the existing ${r.kind} on ${where}.`
        : r.kind === "initiative"
          ? `Created the initiative on ${where}.`
          : `Created the feature on ${where}.`;
    }
  } else if (rejectionIntent) {
    const outcome = handleRejection({
      messages: transcript,
      intent: rejectionIntent,
    });
    summaryText = outcome.ok
      ? "Got it — I won't create that."
      : `Couldn't reject: ${outcome.error}`;
  } else {
    // Defensive — shouldn't happen given the caller guard.
    summaryText = "No proposal intent provided.";
  }

  // Build a minimal SSE stream of UIMessageChunk parts.
  const encoder = new TextEncoder();
  const partsTextId = `proposal-result-${Date.now().toString(36)}`;
  const parts: Array<Record<string, unknown>> = [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: partsTextId },
    { type: "text-delta", id: partsTextId, delta: summaryText },
    { type: "text-end", id: partsTextId },
    { type: "finish-step" },
    { type: "finish" },
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-vercel-ai-ui-message-stream": "v1",
  };
  if (approvalResultHeader) {
    headers["X-Approval-Result"] = approvalResultHeader;
    // Browsers expose only safelisted response headers to fetch
    // unless the server opts in via Access-Control-Expose-Headers.
    // The chat is same-origin so this isn't strictly required, but
    // setting it makes the contract explicit and safe under any
    // future origin-split.
    headers["Access-Control-Expose-Headers"] = "X-Approval-Result";
  }

  return new Response(stream, { headers });
}


