import { z } from "zod";
import { storiesSchema, contentSchema, phasesTicketsSchema } from "./schemas";
import {
  buildUserStoriesPrompt,
  buildRequirementsPrompt,
  buildArchitecturePrompt,
  buildPhasesTicketsPrompt,
} from "./prompt-builders";
import {
  GENERATE_STORIES_SYSTEM_PROMPT,
  GENERATE_REQUIREMENTS_PROMPT,
  GENERATE_ARCHITECTURE_PROMPT,
  GENERATE_PHASES_TICKETS_PROMPT,
  GENERATE_TICKETS_PROMPT,
} from "../constants/prompt";
import { FeatureContext } from "./utils";

export const GENERATION_TYPES = ["userStories", "requirements", "architecture", "phasesTickets", "tickets"] as const;
export type GenerationType = (typeof GENERATION_TYPES)[number];

type GenerationConfig = {
  schema: z.ZodTypeAny;
  systemPrompt: string;
  buildPrompt: (context: FeatureContext, existingStories?: string[]) => string;
};

export const GENERATION_CONFIG_MAP: Record<GenerationType, GenerationConfig> = {
  userStories: {
    schema: storiesSchema,
    systemPrompt: GENERATE_STORIES_SYSTEM_PROMPT,
    buildPrompt: (context, existingStories = []) => buildUserStoriesPrompt(context, existingStories),
  },
  requirements: {
    schema: contentSchema,
    systemPrompt: GENERATE_REQUIREMENTS_PROMPT,
    buildPrompt: (context) => buildRequirementsPrompt(context),
  },
  architecture: {
    schema: contentSchema,
    systemPrompt: GENERATE_ARCHITECTURE_PROMPT,
    buildPrompt: (context) => buildArchitecturePrompt(context),
  },
  phasesTickets: {
    schema: phasesTicketsSchema,
    systemPrompt: GENERATE_PHASES_TICKETS_PROMPT,
    buildPrompt: (context) => buildPhasesTicketsPrompt(context),
  },
  tickets: {
    schema: phasesTicketsSchema,
    systemPrompt: GENERATE_TICKETS_PROMPT,
    buildPrompt: (context) => buildPhasesTicketsPrompt(context),
  },
};
