import { NextRequest, NextResponse } from "next/server";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { buildFeatureContext, generateWithStreaming } from "@/lib/ai/utils";
import { GENERATION_TYPES, GENERATION_CONFIG_MAP, GenerationType } from "@/lib/ai/generation-config";

type Provider = "anthropic" | "openai";

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
    const { type, existingStories } = body;

    if (!type || !GENERATION_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type parameter. Must be one of: ${GENERATION_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        title: true,
        brief: true,
        personas: true,
        requirements: true,
        architecture: true,
        userStories: {
          select: {
            title: true,
          },
          orderBy: {
            order: 'asc',
          }
        },
        workspace: {
          select: {
            id: true,
            description: true,
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

    const isOwner = feature.workspace.ownerId === userOrResponse.id;
    const isMember = feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const provider: Provider = "anthropic";
    const apiKey = getApiKeyForProvider(provider);

    if (!apiKey) {
      return NextResponse.json(
        { error: "AI provider not configured. Please set ANTHROPIC_API_KEY." },
        { status: 500 }
      );
    }

    const model = getModel(provider, apiKey);
    const featureContext = buildFeatureContext(feature);
    const config = GENERATION_CONFIG_MAP[type as GenerationType];

    const prompt = config.buildPrompt(featureContext, existingStories || []);

    return await generateWithStreaming(
      model,
      config.schema,
      prompt,
      config.systemPrompt,
      featureId,
      feature.title,
      type
    );
  } catch (error) {
    console.error("Error generating content:", error);
    return NextResponse.json(
      { error: "Failed to generate content" },
      { status: 500 }
    );
  }
}
