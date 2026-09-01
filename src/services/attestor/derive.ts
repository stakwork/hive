import { generateObject } from "ai";
import { z } from "zod";
import { getModel, getApiKeyForProvider, type Provider } from "@/lib/ai/provider";
import type { Criterion } from "./types";

export interface DeriveCriteriaFeature {
  title: string;
  brief?: string | null;
  requirements?: string | null;
  architecture?: string | null;
  personas?: string[] | null;
  userStories?: { title: string }[] | null;
  workspaceSlug?: string;
}

const criteriaSchema = z.object({
  criteria: z
    .array(z.string().describe("A short, browser-observable pass condition"))
    .min(3)
    .max(8),
});

const SYSTEM_PROMPT = `You are a QA engineer deriving browser-observable acceptance criteria for a software feature.

Turn the feature description into a concise checklist of 3-8 acceptance criteria. Each criterion is a single short check describing an OBSERVABLE PASS CONDITION in the running app — something a person or a browser agent can confirm by looking at the UI (e.g. "After saving, a success toast appears", "The new item shows up at the top of the list").

Rules:
- Describe ONLY the pass condition. Do NOT include login steps, navigation instructions, URLs, or setup — those are provided separately.
- Each criterion must be independently checkable and specific.
- Prefer concrete, visible outcomes over vague statements.
- Return between 3 and 8 criteria.`;

function buildPrompt(feature: DeriveCriteriaFeature): string {
  const parts: string[] = [`Title: ${feature.title}`];
  if (feature.brief) parts.push(`Brief:\n${feature.brief}`);
  if (feature.requirements) parts.push(`Requirements:\n${feature.requirements}`);
  if (feature.architecture) parts.push(`Architecture:\n${feature.architecture}`);
  if (feature.personas && feature.personas.length > 0) {
    parts.push(`Personas:\n${feature.personas.join("\n")}`);
  }
  if (feature.userStories && feature.userStories.length > 0) {
    parts.push(`User stories:\n${feature.userStories.map((s) => `- ${s.title}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

export async function deriveCriteria(feature: DeriveCriteriaFeature): Promise<Criterion[]> {
  const provider: Provider = "anthropic";
  const apiKey = getApiKeyForProvider(provider);
  const model = getModel(provider, apiKey, feature.workspaceSlug);

  const result = await generateObject({
    model,
    schema: criteriaSchema,
    prompt: buildPrompt(feature),
    system: SYSTEM_PROMPT,
    temperature: 0.4,
  });

  const texts = (result.object as { criteria: string[] }).criteria;
  return texts.map((text, index) => ({ id: `c${index + 1}`, text }));
}
