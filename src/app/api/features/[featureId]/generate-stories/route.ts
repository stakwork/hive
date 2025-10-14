import { NextRequest, NextResponse } from "next/server";
import { streamObject } from "ai";
import { getModel, getApiKeyForProvider } from "aieo";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { z } from "zod";

type Provider = "anthropic" | "openai";

const storiesSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string().describe("Brief user journey flow (1-2 sentences) showing sequence of actions and outcome"),
    })
  ),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;
    const body = await request.json();
    const existingStories = body.existingStories || [];

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        title: true,
        brief: true,
        personas: true,
        workspace: {
          select: {
            id: true,
            ownerId: true,
            members: {
              where: { userId: userOrResponse.id },
              select: { role: true }
            }
          }
        }
      }
    });

    if (!feature) {
      return NextResponse.json(
        { error: "Feature not found" },
        { status: 404 }
      );
    }

    // Check workspace access
    const isOwner = feature.workspace.ownerId === userOrResponse.id;
    const isMember = feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Construct prompt with feature context
    const existingStoriesText = existingStories.length > 0
      ? `\n\nExisting user stories (DO NOT repeat these):\n${existingStories.map((s: string) => `- ${s}`).join('\n')}`
      : '';

    const personasText = feature.personas && feature.personas.length > 0
      ? `\n\nTarget Personas:\n${feature.personas.map((p: string) => `- ${p}`).join('\n')}`
      : '';

    const userPrompt = `Generate 3-5 brief user journey flows for this feature:

Title: ${feature.title}
${feature.brief ? `Brief: ${feature.brief}` : ''}${personasText}${existingStoriesText}

Create brief user journey flows (1-2 sentences each) showing how users interact with the feature.
Each journey should:
- Be 1-2 sentences maximum (prefer 1 sentence)
- Show a brief sequence: what they read/see, what they do, what outcome they achieve
- Include 2-4 actions connected with "then" or commas
- Example format: "[Persona] reviews [X], then does [Y] to achieve [Z]"

${feature.personas && feature.personas.length > 0 ? 'Use the exact persona names listed above. Distribute journeys across different personas to show varied interaction patterns.' : ''}
Generate NEW journey flows that complement the existing ones (if any) but do not duplicate them.`;

    // Use anthropic provider (Claude)
    const provider: Provider = "anthropic";
    const apiKey = getApiKeyForProvider(provider);

    if (!apiKey) {
      return NextResponse.json(
        { error: "AI provider not configured. Please set ANTHROPIC_API_KEY." },
        { status: 500 }
      );
    }

    const model = await getModel(provider, apiKey);

    console.log("🤖 Generating user journey flows with:", {
      model: model?.modelId,
      featureId,
      featureTitle: feature.title,
    });

    const result = streamObject({
      model,
      schema: storiesSchema,
      prompt: userPrompt,
      temperature: 0.7,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("Error generating stories:", error);
    return NextResponse.json(
      { error: "Failed to generate stories" },
      { status: 500 }
    );
  }
}
