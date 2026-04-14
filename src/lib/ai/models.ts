/**
 * Model Configuration for Goose Agent
 *
 * Defines valid model names and their associated API key environment variables.
 */

// Valid model names that can be passed from frontend
export type ModelName = "sonnet" | "opus" | "haiku" | "kimi" | "gemini" | "gpt";

export const VALID_MODELS: ModelName[] = ["sonnet", "opus", "haiku", "kimi", "gemini", "gpt"];

// Map model names to their API key environment variables
export const API_KEY_ENV_VARS: Record<ModelName, string> = {
  sonnet: "ANTHROPIC_API_KEY",
  opus: "ANTHROPIC_API_KEY",
  haiku: "ANTHROPIC_API_KEY",
  gpt: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
  kimi: "OPENROUTER_API_KEY",
};

export function isValidModel(model: unknown): model is ModelName {
  return typeof model === "string" && VALID_MODELS.includes(model as ModelName);
}

// Map LlmProvider enum values to their API key environment variables
export const PROVIDER_API_KEY_ENV_VARS: Record<string, string | null> = {
  ANTHROPIC: "ANTHROPIC_API_KEY",
  OPENAI: "OPENAI_API_KEY",
  GOOGLE: "GOOGLE_API_KEY",
  AWS_BEDROCK: "AWS_BEDROCK_API_KEY",
  OPENROUTER: "OPENROUTER_API_KEY",
  OTHER: null,
};

export interface LlmModelOption {
  id: string;
  name: string;
  provider: string;
  providerLabel: string | null;
  isPlanDefault: boolean;
  isTaskDefault: boolean;
}

/**
 * Build the model value string sent to Stakwork.
 * For OTHER providers with a providerLabel, uses the label as prefix.
 * For standard providers, uses the enum lowercase.
 */
export function getModelValue(m: LlmModelOption): string {
  if (m.provider === "OTHER" && m.providerLabel) {
    return `${m.providerLabel.toLowerCase().replace(/\s+/g, "")}/${m.name}`;
  }
  return `${m.provider.toLowerCase()}/${m.name}`;
}

/**
 * Look up the admin-configured default model for plan or task mode.
 * Returns the model value string (e.g. "anthropic/claude-sonnet-4-6") or null.
 */
export async function getDefaultModel(type: "plan" | "task"): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const where = type === "plan" ? { isPlanDefault: true } : { isTaskDefault: true };
  const model = await db.llmModel.findFirst({
    where: {
      ...where,
      OR: [{ dateEnd: null }, { dateEnd: { gt: new Date() } }],
    },
    select: { id: true, name: true, provider: true, providerLabel: true, isPlanDefault: true, isTaskDefault: true },
  });
  if (!model) return null;
  return getModelValue(model);
}

export function getApiKeyForModel(model: ModelName | string): string | undefined {
  if (model.includes("/")) {
    const provider = model.split("/")[0].toUpperCase();
    const envVar = PROVIDER_API_KEY_ENV_VARS[provider];
    return envVar ? process.env[envVar] : undefined;
  }
  const envVar = API_KEY_ENV_VARS[model as ModelName];
  return envVar ? process.env[envVar] : undefined;
}
