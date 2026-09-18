import { getModelValue, PROVIDER_API_KEY_ENV_VARS, type LlmModelOption } from "@/lib/ai/models";

/**
 * A model is only actually selectable when its provider's API key is
 * configured in this running environment. Shared by GET /api/llm-models
 * and Protect config PUT so the allowlist never drifts from the picker.
 *
 * A model whose provider maps to no known env var (an `OTHER` row with
 * a custom `providerLabel` we don't recognize, or the bare `OTHER`
 * enum with no label) has nothing to gate on — keep it.
 */
export function isProviderKeyConfigured(model: LlmModelOption): boolean {
  const value = getModelValue(model);
  const prefix = value.split("/")[0].toUpperCase();
  const envVar = PROVIDER_API_KEY_ENV_VARS[prefix];
  if (!envVar) return true;
  return Boolean(process.env[envVar]);
}

export function publicUnexpiredLlmModelWhere() {
  return {
    isPublic: true,
    OR: [{ dateEnd: null }, { dateEnd: { gt: new Date() } }],
  };
}

export const LLM_MODEL_OPTION_SELECT = {
  id: true,
  name: true,
  provider: true,
  providerLabel: true,
  isPlanDefault: true,
  isTaskDefault: true,
} as const;
