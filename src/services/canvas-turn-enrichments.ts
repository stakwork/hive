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
 */

import { ModelMessage, generateObject } from "ai";
import { z } from "zod";
import {
  getModel,
  getApiKeyForProvider,
  isGatewayReachable,
} from "@/lib/ai/provider";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { swarmFetch } from "@/lib/ai/concepts";

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

    const conversationSummary = messages
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

    const followUpApiKey = getApiKeyForProvider("anthropic");
    // Route the follow-up `generateObject` through Bifrost under the
    // SAME `agentName` as the main stream. Follow-ups are part of the
    // same user-facing turn — splitting them into a separate dim would
    // fragment the per-surface rollups operators actually want. Returns
    // `undefined` and falls back to the default key when BIFROST_ENABLED
    // doesn't cover the primary slug, or for public-viewer requests.
    const followUpBifrost = await getBifrostForLLM(
      {
        workspaceId: primaryWorkspaceId,
        workspaceSlug: primarySlug,
        userId: primaryUserId,
      },
      { agentName },
    );
    // Pre-flight the swarm Bifrost gateway; if it's unreachable (expired
    // cert / connection refused / timeout), drop the whole Bifrost bundle
    // and fall back to the default gateway — same resilience as the main
    // stream in `runCanvasAgent`. See `isGatewayReachable`.
    let activeFollowUpBifrost = followUpBifrost;
    if (
      followUpBifrost?.baseUrl &&
      !(await isGatewayReachable(followUpBifrost.baseUrl))
    ) {
      console.warn(
        "[emitFollowUpQuestions] Bifrost gateway unreachable; falling back to default gateway",
        { primarySlug, baseUrl: followUpBifrost.baseUrl, agentName },
      );
      activeFollowUpBifrost = undefined;
    }
    const followUpModel = getModel(
      "anthropic",
      activeFollowUpBifrost?.apiKey ?? followUpApiKey,
      primarySlug,
      undefined,
      activeFollowUpBifrost
        ? {
            baseUrl: activeFollowUpBifrost.baseUrl,
            headers: activeFollowUpBifrost.headers,
          }
        : undefined,
    );

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
