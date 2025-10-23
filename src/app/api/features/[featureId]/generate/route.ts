import { NextRequest, NextResponse } from "next/server";
import { getModel, getApiKeyForProvider } from "aieo";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { buildFeatureContext, generateWithStreaming, type FeatureData } from "@/lib/ai/utils";
import { GENERATION_TYPES, GENERATION_CONFIG_MAP, GenerationType } from "@/lib/ai/generation-config";
import { EncryptionService } from "@/lib/encryption";

type Provider = "anthropic" | "openai";

export async function POST(request: NextRequest, { params }: { params: Promise<{ featureId: string }> }) {
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
        { status: 400 },
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
            order: "asc",
          },
        },
        workspace: {
          select: {
            id: true,
            description: true,
            ownerId: true,
            members: {
              where: { userId: userOrResponse.id },
              select: { role: true },
            },
            repositories: {
              select: {
                id: true,
                name: true,
                repositoryUrl: true,
              },
              take: 1,
            },
            sourceControlOrg: {
              select: {
                id: true,
                tokens: {
                  where: { userId: userOrResponse.id },
                  select: {
                    token: true,
                  },
                  take: 1,
                },
              },
            },
            swarm: {
              select: {
                swarmUrl: true,
                swarmApiKey: true,
              },
            },
          },
        },
      },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    const isOwner = feature.workspace.ownerId === userOrResponse.id;
    const isMember = feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Special handling for architecture type - call swarm agent
    if (type === "architecture") {
      return await handleArchitectureGeneration(featureId, feature, userOrResponse.id);
    }

    const provider: Provider = "anthropic";
    const apiKey = getApiKeyForProvider(provider);

    if (!apiKey) {
      return NextResponse.json({ error: "AI provider not configured. Please set ANTHROPIC_API_KEY." }, { status: 500 });
    }

    const model = await getModel(provider, apiKey);
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
      type,
    );
  } catch (error) {
    console.error("Error generating content:", error);
    return NextResponse.json({ error: "Failed to generate content" }, { status: 500 });
  }
}

type FeatureWithSwarmData = FeatureData & {
  workspace: FeatureData["workspace"] & {
    id: string;
    ownerId: string;
    members: Array<{ role: string }>;
    repositories: Array<{ id: string; name: string; repositoryUrl: string }>;
    sourceControlOrg: {
      id: string;
      tokens: Array<{ token: string }>;
    } | null;
    swarm: {
      swarmUrl: string | null;
      swarmApiKey: string | null;
    } | null;
  };
};

async function handleArchitectureGeneration(featureId: string, feature: FeatureWithSwarmData, userId: string) {
  // Validate we have swarm configuration
  if (!feature.workspace.swarm || !feature.workspace.swarm.swarmUrl) {
    return NextResponse.json({ error: "Swarm not configured for this workspace" }, { status: 400 });
  }

  // Validate we have a repository
  if (!feature.workspace.repositories || feature.workspace.repositories.length === 0) {
    return NextResponse.json({ error: "No repository configured for this workspace" }, { status: 400 });
  }

  const repository = feature.workspace.repositories[0];

  const swarmIsLocalhost = feature.workspace.swarm.swarmUrl.includes("localhost");

  // Get GitHub PAT
  const sourceControlOrg = feature.workspace.sourceControlOrg;
  if (!swarmIsLocalhost && (!sourceControlOrg || !sourceControlOrg.tokens || sourceControlOrg.tokens.length === 0)) {
    return NextResponse.json({ error: "GitHub authentication not configured" }, { status: 400 });
  }

  const encryptionService = EncryptionService.getInstance();
  let decryptedToken = null;
  if (!swarmIsLocalhost && sourceControlOrg && sourceControlOrg.tokens && sourceControlOrg.tokens.length > 0) {
    decryptedToken = encryptionService.decryptField("source_control_token", sourceControlOrg.tokens[0].token);
  }

  // Decrypt swarm API key
  const decryptedSwarmApiKey = encryptionService.decryptField("swarmApiKey", feature.workspace.swarm.swarmApiKey || "");

  // Build swarm URL (port 3355)
  const swarmUrlObj = new URL(feature.workspace.swarm.swarmUrl);
  let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
  if (feature.workspace.swarm.swarmUrl.includes("localhost")) {
    baseSwarmUrl = `http://localhost:3355`;
  }

  // Build prompt using existing prompt builder
  const featureContext = buildFeatureContext(feature);
  const config = GENERATION_CONFIG_MAP["architecture"];
  const prompt = config.buildPrompt(featureContext, []);

  // Call swarm /repo/agent endpoint
  const swarmResponse = await fetch(`${baseSwarmUrl}/repo/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": decryptedSwarmApiKey,
    },
    body: JSON.stringify({
      repo_url: repository.repositoryUrl,
      username: userId,
      pat: decryptedToken,
      prompt: prompt,
    }),
  });

  if (!swarmResponse.ok) {
    const errorText = await swarmResponse.text();
    console.error("Swarm API error:", errorText);
    return NextResponse.json({ error: `Swarm API error: ${swarmResponse.status}` }, { status: 500 });
  }

  const swarmData = await swarmResponse.json();
  const requestId = swarmData.request_id;

  if (!requestId) {
    return NextResponse.json({ error: "No request_id returned from swarm" }, { status: 500 });
  }

  // Store request_id in database
  await db.feature.update({
    where: { id: featureId },
    data: { architectureRequestId: requestId },
  });

  // Return request_id to frontend
  return NextResponse.json({ request_id: requestId, status: "pending" });
}
