/**
 * Test helpers for mocking Anthropic API
 */

import { vi } from "vitest";
import { mockAnthropicState } from "@/lib/mock/anthropic-state";

export interface AnthropicMockOptions {
  apiKey?: string;
  mockResponse?: string | Record<string, unknown>;
  shouldStream?: boolean;
  shouldFail?: boolean;
}

/**
 * Setup Anthropic mocks for testing
 */
export async function setupAnthropicMocks(
  options: AnthropicMockOptions = {}
) {
  const {
    apiKey = "mock-anthropic-key-test",
    mockResponse,
    shouldFail = false,
  } = options;

  // Mock the aieo library
  const { getApiKeyForProvider, getModel } = await import("@/lib/ai/provider");

  vi.mocked(getApiKeyForProvider).mockReturnValue(apiKey);

  if (shouldFail) {
    vi.mocked(getModel).mockRejectedValue(
      new Error("Mock Anthropic API error")
    );
  } else if (mockResponse) {
    // Custom response provided
    const mockModel = {
      modelId: "claude-3-5-sonnet-20241022",
      doGenerate: vi.fn().mockResolvedValue({
        text:
          typeof mockResponse === "string"
            ? mockResponse
            : JSON.stringify(mockResponse),
        finishReason: "stop",
      }),
    };
    vi.mocked(getModel).mockResolvedValue(mockModel as never);
  }

  return {
    getApiKeyForProvider,
    getModel,
    mockState: mockAnthropicState,
  };
}

/**
 * Reset Anthropic mock state
 */
export function resetAnthropicMocks() {
  mockAnthropicState.reset();
  vi.clearAllMocks();
}
