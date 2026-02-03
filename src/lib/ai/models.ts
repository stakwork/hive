/**
 * Model Configuration for Goose Agent
 *
 * Defines valid model names and their associated API key environment variables.
 */

// Valid model names that can be passed from frontend
export type ModelName = "sonnet" | "opus" | "kimi" | "gemini" | "gpt";

export const VALID_MODELS: ModelName[] = ["sonnet", "opus", "kimi", "gemini", "gpt"];

// Map model names to their API key environment variables
export const API_KEY_ENV_VARS: Record<ModelName, string> = {
  sonnet: "ANTHROPIC_API_KEY",
  opus: "ANTHROPIC_API_KEY",
  gpt: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
  kimi: "OPENROUTER_API_KEY",
};

export function isValidModel(model: unknown): model is ModelName {
  return typeof model === "string" && VALID_MODELS.includes(model as ModelName);
}

export function getApiKeyForModel(model: ModelName): string | undefined {
  const envVar = API_KEY_ENV_VARS[model];
  return process.env[envVar];
}
