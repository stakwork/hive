import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";
import { generateObject } from "ai";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { z } from "zod";

export const runtime = "nodejs";

const SUGGESTIONS_SYSTEM_PROMPT =
  "You decide whether to offer quick-reply chips a user might tap to respond to the assistant's most recent message in a product planning chat. Return between 0 and 4 chips — pick the number that fits the assistant's turn, not a fixed count.\n\n" +
  "RETURN AN EMPTY ARRAY when:\n" +
  "- The assistant directs the user to take an action OUTSIDE the chat (e.g. 'Hit the Generate Tasks button', 'click the button in the top right', 'go to the Tasks tab', 'open the canvas'). There's nothing useful to chip — the user should click the thing, not reply.\n" +
  "- The assistant has clearly wrapped up and isn't inviting a reply.\n" +
  "- A short verbal reply would feel out of place (e.g. the assistant is presenting a finished artifact and pointing to UI).\n\n" +
  "OTHERWISE, choose the count based on context:\n" +
  "- If the assistant offered specific options (e.g. 'A / B / C', a numbered list), return ONE chip per option, mirroring the assistant's own short labels. If there are 2 options, return 2 chips; 4 options, return 4 chips.\n" +
  "- If the assistant asked for confirmation or approval, return 2–3 affirmative replies (e.g. 'Looks good', 'Go ahead', 'Ship it').\n" +
  "- If the assistant asked an open question, return 2–4 distinct plausible next steps the user might take.\n\n" +
  "Rules:\n" +
  "- Hard limit: never more than 4 chips.\n" +
  "- Each chip 2–6 words, natural and conversational — written as if the user is typing it themselves.\n" +
  "- Chips must be distinct from each other.\n" +
  "- EVERY chip must be immediately sendable as-is. The user taps it; the message is sent; no further typing required.\n" +
  "- NEVER produce placeholder chips that require follow-up typing: e.g. 'need to adjust', 'I have feedback', 'make some changes', 'want to tweak it'. These are dead-ends — the user clicks, nothing useful happens.\n" +
  "- For option picks: mirror the assistant's label concisely — e.g. 'Option 1 works for me', 'Go with Option A', 'Pick the second one'.\n" +
  "- For confirmations: be decisive — e.g. 'Yes, looks good to me', 'Let\\'s proceed', 'Ship it'.\n" +
  "- For open questions: suggest a concrete stance or direction — e.g. 'Keep it simple', 'Add more detail', 'Focus on mobile first'.\n" +
  "- Never answer the assistant's question on the user's behalf, never solve the underlying problem, never add new information the assistant didn't already mention.\n" +
  "- Write from the user's voice, not the assistant's.";

// Note: do not use `.min(N)` for N > 1 here. Some providers (e.g. Gemini)
// reject JSON Schema arrays whose `minItems` is anything other than 0 or 1,
// which makes the whole call throw and we silently return []. Enforce shape
// in the prompt and clamp in code instead.
const suggestionsSchema = z.object({
  suggestions: z.array(z.string()).max(4),
});

/**
 * POST /api/features/[featureId]/suggestions
 * Generate 2–3 affirmative quick-reply chip suggestions based on recent conversation.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  const { featureId } = await params;
  try {
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });

    if (!feature) {
      console.warn("[suggestions] feature not found", { featureId });
      return NextResponse.json({ suggestions: [] }, { status: 200 });
    }

    const access = await resolveWorkspaceAccess(request, {
      workspaceId: feature.workspaceId,
    });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) {
      console.warn("[suggestions] workspace access denied", { featureId, workspaceId: feature.workspaceId });
      return NextResponse.json({ suggestions: [] }, { status: 200 });
    }

    const body = await request.json();
    const messages: Array<{ role: string; message: string }> = body.messages ?? [];

    if (messages.length === 0) {
      console.warn("[suggestions] no messages in request body", { featureId });
      return NextResponse.json({ suggestions: [] });
    }

    const apiKey = getApiKeyForProvider("anthropic");
    const model = getModel("anthropic", apiKey, undefined, "haiku");

    const conversationText = messages
      .slice(-5)
      .map((m) => `${m.role}: ${m.message}`)
      .join("\n");

    const result = await generateObject({
      model,
      schema: suggestionsSchema,
      system: SUGGESTIONS_SYSTEM_PROMPT,
      prompt:
        `Conversation:\n${conversationText}\n\n` +
        `Look at the assistant's most recent message and decide:\n` +
        `1) If the assistant has directed the user to a UI action ('Hit Generate Tasks', 'click X in the top right') or otherwise wrapped up, return an empty suggestions array.\n` +
        `2) Otherwise, return between 1 and 4 short quick-reply chips — pick the count that fits the assistant's turn. If the assistant offered specific options, return one chip per option (mirror the assistant's labels). If confirming, propose 2–3 affirmative replies. If open-ended, propose 2–4 distinct next steps. Cap at 4.\n` +
        `3) Never produce a chip whose text requires the user to still type something after clicking. If you cannot form a self-contained, actionable chip, omit it — return fewer chips or an empty array rather than a dead-end placeholder.`,
    });

    const suggestions = result.object.suggestions
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 4);

    console.info("[suggestions] generated", { featureId, count: suggestions.length, suggestions });
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("[suggestions] failed", {
      featureId,
      error: error instanceof Error ? { name: error.name, message: error.message } : error,
    });
    return NextResponse.json({ suggestions: [] });
  }
}
