/**
 * AI Provider Wrapper
 *
 * Wraps the aieo library to enable mock mode.
 * All application code should import from this file instead of 'aieo' directly.
 */

import { config } from "@/config/env";

// Re-export types
export type { Provider } from "aieo";

import {
  type Provider,
  type ProviderTool,
  getModel as getModelAieo,
  getProviderTool as getProviderToolAieo,
  getApiKeyForProvider as getApiKeyForProviderAieo
} from "aieo";
import type { LanguageModel } from "ai";

// Opt-in escape hatch: when USE_REAL_LLM=true, bypass the Anthropic
// mock even if USE_MOCKS=true. Lets us run the real model locally
// (to exercise the canvas tools end-to-end) while keeping every
// other mock — GitHub OAuth, Stakwork, swarm, pool manager, etc. —
// intact. All other `USE_MOCKS` branches are unchanged.
const USE_REAL_LLM = process.env.USE_REAL_LLM === "true";

/**
 * Get API key for provider with mock support
 */
export function getApiKeyForProvider(provider: Provider): string {
  // In mock mode, return mock key for Anthropic
  if (config.USE_MOCKS && !USE_REAL_LLM && provider === "anthropic") {
    return "mock-anthropic-key-12345";
  }

  // Otherwise, use the real aieo implementation
  return getApiKeyForProviderAieo(provider);
}

/**
 * Get model with mock support
 *
 * In mock mode, this configures the AI SDK to point to our mock endpoints.
 * The baseURL override makes all Anthropic API calls go to our local mock.
 */
export function getModel(
  provider: Provider,
  apiKey: string,
  _workspaceSlug?: string,
  modelType?: string
): LanguageModel {
  // In mock mode for Anthropic, override baseURL (unless the real-LLM
  // escape hatch is set — see USE_REAL_LLM at top of file).
  if (config.USE_MOCKS && !USE_REAL_LLM && provider === "anthropic") {
    // Dynamic import not needed for sync function; use require pattern
    const { createAnthropic } = require("@ai-sdk/anthropic");

    const mockProvider = createAnthropic({
      apiKey: "mock-anthropic-key-12345",
      baseURL: `${config.MOCK_BASE}/api/mock/anthropic/v1`,
    });

    // Return appropriate model based on modelType
    const modelId =
      modelType === "haiku"
        ? "claude-3-haiku-20240307"
        : "claude-3-5-sonnet-20241022";

    return mockProvider(modelId) as LanguageModel;
  }

  // Otherwise, use the real aieo implementation
  return getModelAieo(provider, { apiKey, modelName: modelType });
}

/**
 * Get provider tool with mock support
 */
export function getProviderTool(
  provider: Provider,
  apiKey: string,
  toolName: ProviderTool
) {
  // In mock mode, return a mock tool — UNLESS the real-LLM escape
  // hatch is set, in which case we hand back the real provider tool
  // so the model receives a well-formed `input_schema`. The mock
  // shape (`parameters: {}`) is missing fields Anthropic requires
  // and would 400 the whole stream.
  if (config.USE_MOCKS && !USE_REAL_LLM && provider === "anthropic") {
    return {
      description: `Mock ${toolName} tool`,
      parameters: {},
      execute: async (params: unknown) => {
        console.log(`[Mock] ${toolName} tool called with:`, params);
        return { result: "Mock tool result", mocked: true };
      },
    };
  }

  // Otherwise, use the real aieo implementation
  return getProviderToolAieo(provider, apiKey, toolName as ProviderTool) as any;
}
