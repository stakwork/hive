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

/**
 * Get API key for provider with mock support
 */
export function getApiKeyForProvider(provider: Provider): string {
  // In mock mode, return mock key for Anthropic
  if (config.USE_MOCKS && provider === "anthropic") {
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
  // In mock mode for Anthropic, override baseURL
  if (config.USE_MOCKS && provider === "anthropic") {
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
  // In mock mode, return a mock tool
  if (config.USE_MOCKS && provider === "anthropic") {
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
