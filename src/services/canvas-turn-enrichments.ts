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
 *   - `generateConversationTitle` / `maybeGenerateAndPersistTitle` —
 *     one-shot LLM title for org-canvas chats. Does NOT go through
 *     Bifrost (`workspaceId` is null on those rows). Best-effort; never
 *     throws. Gated by `settings.titleSource === "llm"` so it runs at
 *     most once per conversation.
 */

import { ModelMessage, generateObject } from "ai";
import { z } from "zod";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import {
  getWorkspaceChannelName,
  notifyCanvasConversationUpdated,
  PUSHER_EVENTS,
  pusherServer,
} from "@/lib/pusher";
import { swarmFetch } from "@/lib/ai/concepts";
import { TITLE_MAX_LENGTH } from "@/lib/ai/conversationHelpers";
import { db } from "@/lib/db";

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
    const followUpModel = getModel(
      "anthropic",
      followUpBifrost?.apiKey ?? followUpApiKey,
      primarySlug,
      undefined,
      followUpBifrost
        ? {
            baseUrl: followUpBifrost.baseUrl,
            headers: followUpBifrost.headers,
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

const TITLE_WORD_CAP = 6;

const conversationTitleSchema = z.object({
  title: z.string(),
});

/**
 * Trim, strip wrapping quotes, collapse whitespace, keep the first
 * {@link TITLE_WORD_CAP} words, and cap at {@link TITLE_MAX_LENGTH}.
 * Returns `null` when nothing usable remains.
 */
export function sanitizeGeneratedTitle(raw: string): string | null {
  let title = raw.trim().replace(/^["'`]+/, "").replace(/["'`]+$/, "");
  title = title.replace(/\s+/g, " ").trim();
  if (!title) return null;
  const words = title.split(" ").filter(Boolean).slice(0, TITLE_WORD_CAP);
  title = words.join(" ");
  if (!title) return null;
  return title.slice(0, TITLE_MAX_LENGTH);
}

/**
 * One-shot LLM title from this turn's user + assistant text.
 *
 * Org-canvas rows have `workspaceId: null` and already skip Bifrost
 * enrichments — this must not reintroduce `getBifrostForLLM`. Uses the
 * default Anthropic key. Never throws: logs and returns `null` on
 * failure or empty/unusable output.
 */
export async function generateConversationTitle(
  userText: string,
  assistantText: string,
): Promise<string | null> {
  try {
    const apiKey = getApiKeyForProvider("anthropic");
    const model = getModel("anthropic", apiKey);

    const result = await generateObject({
      model,
      schema: conversationTitleSchema,
      prompt: `User:\n${userText}\n\nAssistant:\n${assistantText}`,
      system:
        "Write a conversation title as a few words in simple English (about 2-6 words). Not a sentence, not a long phrase, and not a truncated copy of the user's message. No quotes, no trailing punctuation. Example: Auth token refresh",
      temperature: 0.2,
    });

    const sanitized = sanitizeGeneratedTitle(result.object.title ?? "");
    if (!sanitized) return null;
    console.log("✅ Conversation title generated:", sanitized);
    return sanitized;
  } catch (error) {
    console.error("❌ Error generating conversation title:", error);
    return null;
  }
}

/**
 * After a successful org-canvas assistant persist, generate a short
 * title and write it onto `SharedConversation.title` once.
 *
 * `rowId` MUST already have passed this request's org/user authorization
 * (the same `canvasConversationRowId` validated via
 * `persistCanvasUserMessage` / org membership). Do not pass a
 * client-supplied conversation id.
 *
 * Never throws. Skips error-only / empty assistant turns, and no-ops
 * once `settings.titleSource === "llm"`. Does not detect the
 * `generateTitle()` placeholder by string equality — a short first
 * user message can equal a valid LLM title. Retry-safe: if a prior
 * `after()` died before this write, `titleSource` is still unset and
 * a later successful non-error turn will generate.
 */
export async function maybeGenerateAndPersistTitle(args: {
  rowId: string;
  userText: string;
  assistantText: string;
  assistantIsError: boolean;
}): Promise<void> {
  const { rowId, userText, assistantText, assistantIsError } = args;
  try {
    if (assistantIsError) return;
    if (!assistantText.trim()) return;

    const row = await db.sharedConversation.findUnique({
      where: { id: rowId },
      select: { title: true, settings: true },
    });
    if (!row) return;

    const settings =
      row.settings &&
      typeof row.settings === "object" &&
      !Array.isArray(row.settings)
        ? (row.settings as Record<string, unknown>)
        : {};
    if (settings.titleSource === "llm") return;

    const title = await generateConversationTitle(userText, assistantText);
    if (!title) return;

    // jsonb `||` merge so a concurrent after() writing promptConcepts /
    // promptPrefix is not clobbered by a full settings replace. Title
    // is a scalar column so it can sit on the same UPDATE.
    const patch = JSON.stringify({ titleSource: "llm" });
    await db.$executeRaw`
      UPDATE shared_conversations
      SET title = ${title},
          settings = COALESCE(settings, '{}'::jsonb) || ${patch}::jsonb
      WHERE id = ${rowId}
    `;

    notifyCanvasConversationUpdated(rowId, "user-turn");
    console.log("✅ Conversation title persisted:", title);
  } catch (error) {
    console.error("❌ Error persisting conversation title:", error);
  }
}
