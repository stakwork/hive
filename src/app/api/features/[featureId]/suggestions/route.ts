import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";
import { generateObject } from "ai";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { z } from "zod";

export const runtime = "nodejs";

const SUGGESTIONS_SYSTEM_PROMPT =
  "Generate 2–3 very short (2–5 words) affirmative quick-reply chips for a product planning chat. " +
  "Responses must be purely confirmatory (e.g. 'Yes, go ahead', 'Looks good', 'LGTM!'). " +
  "Never answer questions, solve problems, or add new information.";

const suggestionsSchema = z.object({
  suggestions: z.array(z.string()).min(2).max(3),
});

/**
 * POST /api/features/[featureId]/suggestions
 * Generate 2–3 affirmative quick-reply chip suggestions based on recent conversation.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  try {
    const { featureId } = await params;

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });

    if (!feature) {
      return NextResponse.json({ suggestions: [] }, { status: 200 });
    }

    const access = await resolveWorkspaceAccess(request, {
      workspaceId: feature.workspaceId,
    });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return NextResponse.json({ suggestions: [] }, { status: 200 });

    const body = await request.json();
    const messages: Array<{ role: string; message: string }> = body.messages ?? [];

    if (messages.length === 0) {
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
      prompt: `Conversation:\n${conversationText}\n\nGenerate 2–3 short affirmative reply chips for the user.`,
    });

    return NextResponse.json({ suggestions: result.object.suggestions });
  } catch {
    // Fail silently — never surface errors to the client
    return NextResponse.json({ suggestions: [] });
  }
}
