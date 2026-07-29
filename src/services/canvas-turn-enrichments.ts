/**
 * Post-turn enrichments for the canvas / chat agent, emitted over the
 * workspace Pusher channel AFTER the main stream finishes.
 *
 * Extracted from `src/app/api/ask/quick/route.ts`. Both run in `after()`
 * off the response's critical path and are skipped wholesale when a
 * surface opts out (`skipEnrichments`) — e.g. the non-streaming
 * agent-as-tool path, which renders neither. Each is independently
 * callable and best-effort: failures are logged, never surfaced (the
 * stream already finished).
 *
 *   - `emitFollowUpQuestions` — a `generateObject` round-trip predicting
 *     the user's next 3 questions → `FOLLOW_UP_QUESTIONS`.
 *   - `emitProvenance` — fetch stakgraph provenance for the concepts
 *     learned this turn → `PROVENANCE_DATA`.
 *   - `emitConversationTitle` — a `generateObject` round-trip replacing
 *     the seeded title on a brand-new conversation → DB write.
 */

import { ModelMessage, generateObject } from "ai";
import { z } from "zod";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { swarmFetch } from "@/lib/ai/concepts";
import { db } from "@/lib/db";

/** Flatten a turn's messages into `User: … / Assistant: …` prompt text. */
function flattenConversation(messages: ModelMessage[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
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
}

/**
 * Resolve a model for an enrichment call, routed through Bifrost under the
 * SAME `agentName` as the main stream so per-surface rollups don't fragment.
 * Falls back to the default key when `getBifrostForLLM` returns undefined.
 */
async function enrichmentModel(args: {
  primarySlug: string;
  primaryWorkspaceId: string;
  primaryUserId: string;
  agentName: "canvas-agent" | "chat-agent";
  modelType?: string;
}) {
  const { primarySlug, primaryWorkspaceId, primaryUserId, agentName, modelType } =
    args;
  const apiKey = getApiKeyForProvider("anthropic");
  const bifrost = await getBifrostForLLM(
    {
      workspaceId: primaryWorkspaceId,
      workspaceSlug: primarySlug,
      userId: primaryUserId,
    },
    { agentName },
  );
  return getModel(
    "anthropic",
    bifrost?.apiKey ?? apiKey,
    primarySlug,
    modelType,
    bifrost ? { baseUrl: bifrost.baseUrl, headers: bifrost.headers } : undefined,
  );
}

/**
 * Provenance data shape returned by `${swarmUrl}/gitree/provenance`.
 */
export interface ProvenanceData {
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
 * Fetch provenance data from stakgraph.
 */
async function fetchProvenance(
  swarmUrl: string,
  apiKey: string,
  conceptIds: string[],
): Promise<ProvenanceData> {
  const response = await swarmFetch(`${swarmUrl}/gitree/provenance`, {
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

/**
 * Generate 3 predicted follow-up questions for the turn and broadcast
 * them on the workspace channel. Best-effort; logs and swallows errors.
 *
 * `agentName` mirrors the main stream's Bifrost dim so follow-ups roll
 * up under the same per-surface metric ("canvas-agent" for the org
 * multi-workspace canvas, "chat-agent" otherwise).
 */
export async function emitFollowUpQuestions(args: {
  messages: ModelMessage[];
  primarySlug: string;
  primaryWorkspaceId: string;
  primaryUserId: string;
  agentName: "canvas-agent" | "chat-agent";
}): Promise<void> {
  const { messages, primarySlug, primaryWorkspaceId, primaryUserId, agentName } =
    args;
  try {
    const followUpSchema = z.object({
      questions: z
        .array(z.string())
        .describe("Exactly 3 short, specific follow-up questions (max 10 words each)"),
    });

    const conversationSummary = flattenConversation(messages);

    const followUpModel = await enrichmentModel({
      primarySlug,
      primaryWorkspaceId,
      primaryUserId,
      agentName,
    });

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
}

/**
 * Fetch stakgraph provenance for the concepts learned this turn and
 * broadcast it on the workspace channel. No-op when no concepts were
 * learned. Best-effort; logs and swallows errors.
 */
export async function emitProvenance(args: {
  conceptIds: string[];
  primarySlug: string;
  primarySwarmUrl: string;
  primarySwarmApiKey: string;
}): Promise<void> {
  const { conceptIds, primarySlug, primarySwarmUrl, primarySwarmApiKey } = args;
  try {
    if (conceptIds.length === 0) return;
    const provenance = await fetchProvenance(
      primarySwarmUrl,
      primarySwarmApiKey,
      conceptIds,
    );
    const channelName = getWorkspaceChannelName(primarySlug);
    await pusherServer.trigger(channelName, PUSHER_EVENTS.PROVENANCE_DATA, {
      provenance,
      timestamp: Date.now(),
    });
    console.log("✅ Provenance data sent:", provenance.concepts.length, "concepts");
  } catch (error) {
    console.error("❌ Error generating provenance:", error);
  }
}

const titleSchema = z.object({
  title: z
    .string()
    .describe("Clear, concise conversation title (3-8 words) describing the topic"),
});

/**
 * Replace a new conversation's seeded title with a model-written one.
 *
 * `generateTitle` seeds the row at create time from a raw slice of the first
 * user message, so a pasted stack trace becomes the title. Gated on
 * `isNewConversation` so it can't race a manual rename. Best-effort.
 */
export async function emitConversationTitle(args: {
  conversationId: string | null;
  isNewConversation: boolean;
  messages: ModelMessage[];
  primarySlug: string;
  primaryWorkspaceId: string;
  primaryUserId: string;
  agentName: "canvas-agent" | "chat-agent";
}): Promise<void> {
  const {
    conversationId,
    isNewConversation,
    messages,
    primarySlug,
    primaryWorkspaceId,
    primaryUserId,
    agentName,
  } = args;
  try {
    if (!conversationId || !isNewConversation) return;

    const model = await enrichmentModel({
      primarySlug,
      primaryWorkspaceId,
      primaryUserId,
      agentName,
      modelType: "haiku",
    });

    const result = await generateObject({
      model,
      schema: titleSchema,
      prompt: `Title this conversation:\n\n${flattenConversation(messages)}`,
      system:
        "Write a short title for this conversation, from the perspective of someone scanning a chat history list. Capture what the conversation is actually about — not the literal opening words. 3-8 words, no trailing punctuation, no quotes, no 'Conversation about' preamble. If the conversation is only a greeting or has no substantive topic yet, return an empty string rather than describing the greeting.",
      temperature: 0.3,
    });

    const title = result.object.title.trim();
    if (!title) return;

    await db.sharedConversation.update({
      where: { id: conversationId },
      data: { title },
    });

    console.log("✅ Conversation title set:", title);
  } catch (error) {
    console.error("❌ Error generating conversation title:", error);
  }
}

/**
 * Run every post-turn enrichment, in one place, with the gating rules.
 *
 * `skipEnrichments` means "this surface renders neither follow-ups nor
 * provenance"; the title is a DB write, not a rendered enrichment, so it
 * runs regardless.
 */
export async function runTurnEnrichments(args: {
  skipEnrichments: boolean;
  conversationId: string | null;
  isNewConversation: boolean;
  messages: ModelMessage[];
  conceptIds: string[];
  primarySlug: string;
  primaryWorkspaceId: string;
  primaryUserId: string;
  primarySwarmUrl: string;
  primarySwarmApiKey: string;
  agentName: "canvas-agent" | "chat-agent";
}): Promise<void> {
  const {
    skipEnrichments,
    conversationId,
    isNewConversation,
    messages,
    conceptIds,
    primarySlug,
    primaryWorkspaceId,
    primaryUserId,
    primarySwarmUrl,
    primarySwarmApiKey,
    agentName,
  } = args;

  await emitConversationTitle({
    conversationId,
    isNewConversation,
    messages,
    primarySlug,
    primaryWorkspaceId,
    primaryUserId,
    agentName,
  });

  // Saves a `generateObject` round-trip and a provenance POST per turn.
  if (skipEnrichments) return;

  await emitFollowUpQuestions({
    messages,
    primarySlug,
    primaryWorkspaceId,
    primaryUserId,
    agentName,
  });
  await emitProvenance({
    conceptIds,
    primarySlug,
    primarySwarmUrl,
    primarySwarmApiKey,
  });
}
