import { streamObject } from "ai";
import { z } from "zod";

export function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } {
  // Handle different GitHub URL formats
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  // owner/repo

  let match: RegExpMatchArray | null = null;

  // Match https://github.com/owner/repo or https://github.com/owner/repo.git
  match = repoUrl.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  // Match git@github.com:owner/repo.git
  match = repoUrl.match(/^git@github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  // Match owner/repo format
  match = repoUrl.match(/^([^\/]+)\/([^\/]+)$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  throw new Error(`Invalid repository URL format: ${repoUrl}`);
}

type FeatureData = {
  id: string;
  title: string;
  brief: string | null;
  personas: string[];
  requirements: string | null;
  architecture: string | null;
  userStories: { title: string }[];
  workspace: {
    description: string | null;
  };
  phases?: {
    tasks?: {
      title: string;
      status: string;
      priority: string;
    }[];
  }[];
};

export type FeatureContext = {
  title: string;
  brief: string | null;
  workspaceDesc: string;
  personasText: string;
  userStoriesText: string;
  requirementsText: string;
  architectureText: string;
  tasksText: string | null;
};

export function buildFeatureContext(feature: FeatureData): FeatureContext {
  const workspaceDesc = feature.workspace.description
    ? `\n\nWorkspace Context: ${feature.workspace.description}`
    : '';

  const personasText = feature.personas && feature.personas.length > 0
    ? `\n\nTarget Personas:\n${feature.personas.map((p: string) => `- ${p}`).join('\n')}`
    : '';

  const userStoriesText = feature.userStories && feature.userStories.length > 0
    ? `\n\nUser Stories:\n${feature.userStories.map((s) => `- ${s.title}`).join('\n')}`
    : '';

  const requirementsText = feature.requirements || '';
  const architectureText = feature.architecture || '';

  // Include existing tasks from default phase (phase 0)
  const tasksText = feature.phases && feature.phases.length > 0
    ? feature.phases
        .flatMap((phase) => phase.tasks || [])
        .map((task) => `- ${task.title} (${task.status}, ${task.priority})`)
        .join('\n') || null
    : null;

  return {
    title: feature.title,
    brief: feature.brief,
    workspaceDesc,
    personasText,
    userStoriesText,
    requirementsText,
    architectureText,
    tasksText,
  };
}

export async function generateWithStreaming<T extends z.ZodTypeAny>(
  model: Parameters<typeof streamObject>[0]['model'],
  schema: T,
  prompt: string,
  systemPrompt: string,
  featureId: string,
  featureTitle: string,
  generationType: string
) {
  console.log(`🤖 Generating ${generationType} with:`, {
    model: (model as { modelId?: string })?.modelId,
    featureId,
    featureTitle,
  });

  const result = streamObject({
    model,
    schema,
    prompt,
    system: systemPrompt,
    temperature: 0.7,
  });

  return result.toTextStreamResponse();
}
