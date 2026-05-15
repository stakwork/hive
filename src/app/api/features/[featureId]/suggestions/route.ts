import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";
import { generateObject } from "ai";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { z } from "zod";

export const runtime = "nodejs";

const SUGGESTIONS_SYSTEM_PROMPT =
  "Generate exactly 3 very short (2–5 words) affirmative quick-reply chips for a product planning chat. " +
  "Responses must be purely confirmatory (e.g. 'Yes, go ahead', 'Looks good', 'LGTM!'). " +
  "Never answer questions, solve problems, or add new information. " +
  "Return an array with 3 distinct items.";

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
      prompt: `Conversation:\n${conversationText}\n\nGenerate exactly 3 short affirmative reply chips for the user.`,
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
