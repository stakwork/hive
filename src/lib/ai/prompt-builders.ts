import { FeatureContext } from "./utils";

export function buildUserStoriesPrompt(context: FeatureContext, existingStories: string[]): string {
  const existingStoriesText =
    existingStories.length > 0
      ? `\n\nExisting user stories (DO NOT repeat these):\n${existingStories.map((s: string) => `- ${s}`).join("\n")}`
      : "";

  return `Generate 3-5 brief user journey flows for this feature:

Title: ${context.title}
${context.brief ? `Brief: ${context.brief}` : ""}${context.personasText}${existingStoriesText}

Create brief user journey flows (1-2 sentences each) showing how users interact with the feature.
Each journey should:
- Be 1-2 sentences maximum (prefer 1 sentence)
- Show a brief sequence: what they read/see, what they do, what outcome they achieve
- Include 2-4 actions connected with "then" or commas
- Example format: "[Persona] reviews [X], then does [Y] to achieve [Z]"

${context.personasText ? "Use the exact persona names listed above. Distribute journeys across different personas to show varied interaction patterns." : ""}
Generate NEW journey flows that complement the existing ones (if any) but do not duplicate them.`;
}

export function buildRequirementsPrompt(context: FeatureContext): string {
  const existingRequirements = context.requirementsText
    ? `\n\nExisting Requirements:\n${context.requirementsText}`
    : "";

  return `Generate COMPLETE requirements for this feature (incorporating all context below):

Title: ${context.title}
${context.brief ? `Brief: ${context.brief}` : ""}${context.workspaceDesc}${context.personasText}${context.userStoriesText}${existingRequirements}

Return the final requirements (50-100 words) covering functional aspects. Do NOT include technical details. Please be direct and succinct.
${context.requirementsText ? "Incorporate and enhance the existing requirements above." : ""}`;
}

export function buildArchitecturePrompt(context: FeatureContext): string {
  const existingArchitecture = context.architectureText
    ? `\n\nExisting Architecture:\n${context.architectureText}`
    : "";

  return `Generate COMPLETE architecture for this feature (incorporating all context below):

Title: ${context.title}
${context.brief ? `Brief: ${context.brief}` : ""}${context.workspaceDesc}${context.personasText}${context.userStoriesText}${context.requirementsText ? `\n\nRequirements:\n${context.requirementsText}` : ""}${existingArchitecture}

Return the FULL final architecture (200-400 words) covering system design, components, and technical approach.
${context.architectureText ? "Incorporate and enhance the existing architecture above." : ""}`;
}

export function buildPhasesTasksPrompt(context: FeatureContext): string {
  return `Generate a complete project breakdown with phases and tasks for this feature (incorporating all context below):

Title: ${context.title}
${context.brief ? `Brief: ${context.brief}` : ""}${context.workspaceDesc}${context.personasText}${context.userStoriesText}${context.requirementsText ? `\n\nRequirements:\n${context.requirementsText}` : ""}${context.architectureText ? `\n\nArchitecture:\n${context.architectureText}` : ""}

Break down the work into 1-5 logical phases (fewer for simpler features), with 2-8 actionable tasks per phase.
Use tempIds (T1, T2, T3...) for dependency mapping between tasks.
Return a structured breakdown developers can immediately start working from.`;
}

// Backwards compatibility alias
export const buildPhasesTicketsPrompt = buildPhasesTasksPrompt;
