import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { db } from "@/lib/db";
import { authOptions } from "@/lib/auth/nextauth";
import { checkIsSuperAdmin } from "@/lib/middleware/utils";
import { generateObject } from "ai";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { z } from "zod";

export const runtime = "nodejs";

const SUGGESTIONS_SYSTEM_PROMPT =
  "You generate quick-reply chips for a product manager using Plan Mode — a conversational assistant that helps the PM shape a feature plan (requirements, architecture, task breakdown). The user is a PM, NOT an engineer.\n\n" +
  "OVERRIDE RULE — check this FIRST, before anything else:\n" +
  "If the assistant's most recent message mentions any UI element the user is supposed to interact with — e.g. 'hit Generate Tasks', 'click the button in the top right', 'go to the Tasks tab', 'open the canvas', 'press the X button', 'use the toolbar' — RETURN AN EMPTY ARRAY. No chips. The button is the next step, not a chat reply. This is true EVEN IF the assistant also asks a follow-up question like 'Want any tweaks first?' — the presence of the UI directive wins. Do not rationalize chips around it.\n\n" +
  "Otherwise:\n" +
  "The assistant has just finished a step and is pausing for the PM's input — usually either confirming what was just captured ('Did I get that right?') or offering to move forward ('Ready to move to architecture?'). Your job is to surface 1–4 one-tap replies that push the conversation along without the PM having to type.\n\n" +
  "Almost every good chip is a short affirmative or a 'next step' nudge. Aim for this vibe:\n" +
  "- 'Yes, looks good to me'\n" +
  "- 'That\\'s exactly it'\n" +
  "- 'Sounds right'\n" +
  "- 'Let\\'s discuss architecture'\n" +
  "- 'Go to the next step'\n" +
  "- 'Move on'\n\n" +
  "HARD BANS — never produce a chip about any of these:\n" +
  "- Code, implementation details, or 'showing the fix'. The PM is not looking at code.\n" +
  "- Time, timelines, deadlines, estimates, scheduling. Plan Mode never discusses time.\n" +
  "- Walking through implementation or 'how it works under the hood'.\n" +
  "- Asking the assistant to redo or restate something it just produced ('Draft the requirements' right after it drafted them).\n" +
  "- Skipping past the phase the assistant named as next (don't jump to implementation when architecture is next).\n" +
  "- Vague placeholders that need follow-up typing: 'Let\\'s tweak a couple things', 'I have feedback', 'Need to adjust', 'Make some changes'. The PM taps these and is stuck — they still have to type what they actually mean. DEAD-END. Never produce these.\n\n" +
  "Format rules:\n" +
  "- 1–4 chips total. Fewer is fine. Return [] if nothing genuinely useful fits.\n" +
  "- Each chip 2–6 words, conversational, in the PM's voice.\n" +
  "- Chips must be distinct.\n" +
  "- If the assistant offered explicit options (A / B / C), return one chip per option mirroring its short labels.\n" +
  "- Otherwise default to simple affirmatives and next-step nudges. When in doubt, return fewer chips rather than reaching for filler.";

// Note: do not use `.min(N)` for N > 1 here. Some providers (e.g. Gemini)
// reject JSON Schema arrays whose `minItems` is anything other than 0 or 1,
// which makes the whole call throw and we silently return []. Enforce shape
// in the prompt and clamp in code instead.
const suggestionsSchema = z.object({
  suggestions: z.array(z.string()).max(4),
});

/**
 * Resolve user identity from session cookie (web UI) or Bearer token (Sphinx app).
 * Route is marked webhook in middleware config so we authenticate manually here.
 */
async function getUserId(request: NextRequest): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (session?.user && (session.user as { id?: string }).id) {
    return (session.user as { id: string }).id;
  }
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET! });
  if (token?.id && typeof token.id === "string") return token.id;
  return null;
}

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
      select: {
        workspaceId: true,
        workspace: { select: { ownerId: true, isPublicViewable: true } },
      },
    });

    if (!feature) {
      console.warn("[suggestions] feature not found", { featureId });
      return NextResponse.json({ suggestions: [] }, { status: 200 });
    }

    const { workspaceId, workspace } = feature;
    const userId = await getUserId(request);

    let hasAccess = false;

    if (userId) {
      if (workspace.ownerId === userId) {
        hasAccess = true;
      } else {
        const member = await db.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId } },
          select: { id: true },
        });
        if (member) {
          hasAccess = true;
        } else if (await checkIsSuperAdmin(userId)) {
          hasAccess = true;
        }
      }
    }

    if (!hasAccess) {
      if (workspace.isPublicViewable) {
        hasAccess = true;
      } else {
        console.warn("[suggestions] workspace access denied", { featureId, workspaceId });
        return NextResponse.json({ suggestions: [] }, { status: 200 });
      }
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
        `Look at the assistant's most recent message.\n` +
        `STEP 1: Does it mention ANY UI element to click/press/open (button, tab, panel, top-right area, toolbar, etc.)? If yes, return []. Do not generate chips. The button is the next step. This holds even if the assistant also asks a follow-up question.\n` +
        `STEP 2: Otherwise, produce 1–4 short affirmative / next-step chips the PM can tap. Remember the hard bans: no code, no timeline, no implementation, no vague 'tweak / adjust / feedback' placeholders, no redoing what was just done.`,
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
