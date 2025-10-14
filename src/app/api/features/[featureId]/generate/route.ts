import { NextRequest, NextResponse } from "next/server";
import { streamObject } from "ai";
import { getModel, getApiKeyForProvider } from "aieo";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { z } from "zod";
import {
  GENERATE_STORIES_SYSTEM_PROMPT,
  GENERATE_REQUIREMENTS_PROMPT,
  GENERATE_ARCHITECTURE_PROMPT,
  GENERATE_PHASES_TICKETS_PROMPT,
} from "@/lib/constants/prompt";

type Provider = "anthropic" | "openai";
type ModelType = Awaited<ReturnType<typeof getModel>>;
type FeatureData = {
  id: string;
  title: string;
  brief: string | null;
  personas: string[];
  requirements: string | null;
  architecture: string | null;
  userStories: { title: string }[];
  workspace: {
    id: string;
    description: string | null;
    ownerId: string;
    members: { role: string }[];
  };
};

const storiesSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string().describe("Brief user journey flow (1-2 sentences) showing sequence of actions and outcome"),
    })
  ),
});

const contentSchema = z.object({
  content: z.string().describe("Complete final content incorporating all context"),
});

const phasesTicketsSchema = z.object({
  phases: z.array(
    z.object({
      name: z.string().describe("Phase name (e.g., 'Foundation', 'Core Features')"),
      description: z.string().optional().describe("Brief description of the phase"),
      tickets: z.array(
        z.object({
          title: z.string().describe("Ticket title"),
          description: z.string().optional().describe("Detailed ticket description"),
          priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM").describe("Ticket priority level"),
          tempId: z.string().describe("Temporary ID for dependency mapping (e.g., 'T1', 'T2')"),
          dependsOn: z.array(z.string()).optional().describe("Array of tempIds this ticket depends on (e.g., ['T1', 'T2'])"),
        })
      ),
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
    const { type, existingStories } = body;

    if (!type || !["userStories", "requirements", "architecture", "phasesTickets"].includes(type)) {
      return NextResponse.json(
        { error: "Invalid type parameter. Must be 'userStories', 'requirements', 'architecture', or 'phasesTickets'" },
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

    // Check workspace access
    const isOwner = feature.workspace.ownerId === userOrResponse.id;
    const isMember = feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

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

    // Generate based on type
    if (type === "userStories") {
      return await generateUserStories(model, feature, existingStories || [], featureId);
    } else if (type === "requirements") {
      return await generateRequirements(model, feature, featureId);
    } else if (type === "architecture") {
      return await generateArchitecture(model, feature, featureId);
    } else if (type === "phasesTickets") {
      return await generatePhasesAndTickets(model, feature, featureId);
    }

    return NextResponse.json(
      { error: "Generation type not implemented yet" },
      { status: 500 }
    );
  } catch (error) {
    console.error("Error generating content:", error);
    return NextResponse.json(
      { error: "Failed to generate content" },
      { status: 500 }
    );
  }
}

async function generateUserStories(model: ModelType, feature: FeatureData, existingStories: string[], featureId: string) {
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

  console.log("🤖 Generating user journey flows with:", {
    model: model?.modelId,
    featureId,
    featureTitle: feature.title,
  });

  const result = streamObject({
    model,
    schema: storiesSchema,
    prompt: userPrompt,
    system: GENERATE_STORIES_SYSTEM_PROMPT,
    temperature: 0.7,
  });

  return result.toTextStreamResponse();
}

async function generateRequirements(model: ModelType, feature: FeatureData, featureId: string) {
  const workspaceDesc = feature.workspace.description
    ? `\n\nWorkspace Context: ${feature.workspace.description}`
    : '';

  const personasText = feature.personas && feature.personas.length > 0
    ? `\n\nTarget Personas:\n${feature.personas.map((p: string) => `- ${p}`).join('\n')}`
    : '';

  const userStoriesText = feature.userStories && feature.userStories.length > 0
    ? `\n\nUser Stories:\n${feature.userStories.map((s) => `- ${s.title}`).join('\n')}`
    : '';

  const existingRequirements = feature.requirements
    ? `\n\nExisting Requirements:\n${feature.requirements}`
    : '';

  const userPrompt = `Generate COMPLETE requirements for this feature (incorporating all context below):

Title: ${feature.title}
${feature.brief ? `Brief: ${feature.brief}` : ''}${workspaceDesc}${personasText}${userStoriesText}${existingRequirements}

Return the FULL final requirements (200-400 words) covering functional, technical, and non-functional aspects.
${feature.requirements ? 'Incorporate and enhance the existing requirements above.' : ''}`;

  console.log("🤖 Generating requirements with:", {
    model: model?.modelId,
    featureId,
    featureTitle: feature.title,
  });

  const result = streamObject({
    model,
    schema: contentSchema,
    prompt: userPrompt,
    system: GENERATE_REQUIREMENTS_PROMPT,
    temperature: 0.7,
  });

  return result.toTextStreamResponse();
}

async function generateArchitecture(model: ModelType, feature: FeatureData, featureId: string) {
  const workspaceDesc = feature.workspace.description
    ? `\n\nWorkspace Context: ${feature.workspace.description}`
    : '';

  const personasText = feature.personas && feature.personas.length > 0
    ? `\n\nTarget Personas:\n${feature.personas.map((p: string) => `- ${p}`).join('\n')}`
    : '';

  const userStoriesText = feature.userStories && feature.userStories.length > 0
    ? `\n\nUser Stories:\n${feature.userStories.map((s) => `- ${s.title}`).join('\n')}`
    : '';

  const requirementsText = feature.requirements
    ? `\n\nRequirements:\n${feature.requirements}`
    : '';

  const existingArchitecture = feature.architecture
    ? `\n\nExisting Architecture:\n${feature.architecture}`
    : '';

  const userPrompt = `Generate COMPLETE architecture for this feature (incorporating all context below):

Title: ${feature.title}
${feature.brief ? `Brief: ${feature.brief}` : ''}${workspaceDesc}${personasText}${userStoriesText}${requirementsText}${existingArchitecture}

Return the FULL final architecture (200-400 words) covering system design, components, and technical approach.
${feature.architecture ? 'Incorporate and enhance the existing architecture above.' : ''}`;

  console.log("🤖 Generating architecture with:", {
    model: model?.modelId,
    featureId,
    featureTitle: feature.title,
  });

  const result = streamObject({
    model,
    schema: contentSchema,
    prompt: userPrompt,
    system: GENERATE_ARCHITECTURE_PROMPT,
    temperature: 0.7,
  });

  return result.toTextStreamResponse();
}

async function generatePhasesAndTickets(model: ModelType, feature: FeatureData, featureId: string) {
  const workspaceDesc = feature.workspace.description
    ? `\n\nWorkspace Context: ${feature.workspace.description}`
    : '';

  const personasText = feature.personas && feature.personas.length > 0
    ? `\n\nTarget Personas:\n${feature.personas.map((p: string) => `- ${p}`).join('\n')}`
    : '';

  const userStoriesText = feature.userStories && feature.userStories.length > 0
    ? `\n\nUser Stories:\n${feature.userStories.map((s) => `- ${s.title}`).join('\n')}`
    : '';

  const requirementsText = feature.requirements
    ? `\n\nRequirements:\n${feature.requirements}`
    : '';

  const architectureText = feature.architecture
    ? `\n\nArchitecture:\n${feature.architecture}`
    : '';

  const userPrompt = `Generate a complete project breakdown with phases and tickets for this feature (incorporating all context below):

Title: ${feature.title}
${feature.brief ? `Brief: ${feature.brief}` : ''}${workspaceDesc}${personasText}${userStoriesText}${requirementsText}${architectureText}

Break down the work into 1-5 logical phases (fewer for simpler features), with 2-8 actionable tickets per phase.
Use tempIds (T1, T2, T3...) for dependency mapping between tickets.
Return a structured breakdown developers can immediately start working from.`;

  console.log("🤖 Generating phases and tickets with:", {
    model: model?.modelId,
    featureId,
    featureTitle: feature.title,
  });

  const result = streamObject({
    model,
    schema: phasesTicketsSchema,
    prompt: userPrompt,
    system: GENERATE_PHASES_TICKETS_PROMPT,
    temperature: 0.7,
  });

  return result.toTextStreamResponse();
}
