/**
 * AI Provider Wrapper
 *
 * Wraps the aieo library to enable mock mode.
 * All application code should import from this file instead of 'aieo' directly.
 */

import { config } from "@/config/env";

// Re-export types
export type { Provider } from "aieo";

/**
 * Get API key for provider with mock support
 */
export function getApiKeyForProvider(provider: string): string {
  // In mock mode, return mock key for Anthropic
  if (config.USE_MOCKS && provider === "anthropic") {
    return "mock-anthropic-key-12345";
  }

  // Otherwise, use the real aieo implementation
  const { getApiKeyForProvider: realGetApiKey } = require("aieo");
  return realGetApiKey(provider);
}

/**
 * Get model with mock support
 *
 * In mock mode, this configures the AI SDK to point to our mock endpoints.
 * The baseURL override makes all Anthropic API calls go to our local mock.
 */
export async function getModel(
  provider: string,
  apiKey: string,
  workspaceSlug?: string,
  modelType?: string
) {
  // In mock mode for Anthropic, override baseURL
  if (config.USE_MOCKS && provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");

    const mockProvider = createAnthropic({
      apiKey: "mock-anthropic-key-12345",
      baseURL: `/api/mock/anthropic/v1`,
    });

    // Return appropriate model based on modelType
    const modelId =
      modelType === "haiku"
        ? "claude-3-haiku-20240307"
        : "claude-3-5-sonnet-20241022";

    return mockProvider(modelId);
  }

  // Otherwise, use the real aieo implementation
  const { getModel: realGetModel } = require("aieo");
  return realGetModel(provider, apiKey, workspaceSlug, modelType);
}

/**
 * Get provider tool with mock support
 */
export function getProviderTool(
  provider: string,
  apiKey: string,
  toolName: string
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
  const { getProviderTool: realGetProviderTool } = require("aieo");
  return realGetProviderTool(provider, apiKey, toolName);
}
