/**
 * AI Provider Wrapper
 *
 * Wraps the aieo library to enable mock mode.
 * All application code should import from this file instead of 'aieo' directly.
 */

import { config } from "@/config/env";

// Re-export types
export type { Provider } from "aieo";
export type { WebSearchHandle, WebSearchResult } from "aieo";
export { WEB_SEARCH_TOOL_NAME, linkifyCitations, stripCitations } from "aieo";

import {
  type Provider,
  type ProviderTool,
  type CreateWebSearchOptions,
  type WebSearchHandle,
  type WebSearchResult,
  createWebSearch as createWebSearchAieo,
  stripCitations,
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
 * Optional per-call overrides that route the resulting model through
 * an alternate endpoint (e.g. Bifrost). When `baseUrl` is set, the
 * provider client uses it instead of the SDK default; when `headers`
 * is set, every outbound request carries those extra headers (today:
 * `x-macaroon` for cost-per-agent observability on `logs.db`).
 *
 * Both fields are produced by `getBifrostForLLM` in
 * `@/services/bifrost`. Pass them through verbatim; this layer does
 * no normalization.
 *
 * Mock mode wins: when `USE_MOCKS=true` and `USE_REAL_LLM` is unset,
 * we still point at the local mock regardless of overrides, so test
 * runs never accidentally hit a real endpoint.
 */
export interface GetModelOverrides {
  baseUrl?: string;
  headers?: Record<string, string>;
}

/**
 * Get model with mock support.
 *
 * In mock mode, this configures the AI SDK to point to our mock endpoints.
 * The baseURL override makes all Anthropic API calls go to our local mock.
 *
 * In production, an optional `overrides` arg threads Bifrost routing
 * (baseUrl + headers) through to the aieo provider. When omitted,
 * behavior is identical to the pre-Bifrost path.
 */
export function getModel(
  provider: Provider,
  apiKey: string,
  _workspaceSlug?: string,
  modelType?: string,
  overrides?: GetModelOverrides,
): LanguageModel {
  // In mock mode for Anthropic, override baseURL (unless the real-LLM
  // escape hatch is set — see USE_REAL_LLM at top of file). Bifrost
  // overrides are intentionally ignored here: mocked runs must never
  // reach a real gateway, even when the orchestrator returned creds.
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

  // Otherwise, use the real aieo implementation. When Bifrost
  // overrides are present, they replace the provider's default
  // baseUrl and add per-request headers (e.g. `x-macaroon`). aieo
  // 0.1.33+ accepts `headers` on GetModelOptions.
  return getModelAieo(provider, {
    apiKey,
    modelName: modelType,
    ...(overrides?.baseUrl ? { baseUrl: overrides.baseUrl } : {}),
    ...(overrides?.headers && Object.keys(overrides.headers).length > 0
      ? { headers: overrides.headers }
      : {}),
  });
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

/**
 * Build the run's `web_search` tool with mock support.
 *
 * Delegates to aieo, which keeps Anthropic on its native server-executed
 * tool and hands every other provider an Exa-backed shim of the same
 * name and result shape. Callers register `handle.tool` under
 * `WEB_SEARCH_TOOL_NAME`, feed `handle.capture` from `onStepFinish`, and
 * read `handle.results` for the flat citation list — identical on both
 * paths, so nothing downstream branches on the provider.
 *
 * `citations` defaults to false: the model gets no citation
 * instructions and `formatOutput` strips any `<cite>` markup it emits
 * anyway. Interactive chat wants that — its text is STREAMED, so a cite
 * tag would reach the UI as raw markup before anything could rewrite it.
 * Only non-streaming surfaces that render source links (the research
 * worker, whose output lands in a doc via a tool call) should turn it on.
 */
export function createWebSearch(
  opts: Omit<CreateWebSearchOptions, "apiKey"> & { apiKey: string },
): WebSearchHandle {
  // Mock mode returns a handle shaped like the real one so the agent
  // loop is exercised end-to-end without reaching Anthropic or Exa.
  // Mirrors getProviderTool's mock branch (see USE_REAL_LLM above).
  if (config.USE_MOCKS && !USE_REAL_LLM && opts.provider === "anthropic") {
    const results: WebSearchResult[] = [];
    return {
      tool: {
        description: "Mock web_search tool",
        parameters: {},
        execute: async (params: unknown) => {
          console.log("[Mock] web_search tool called with:", params);
          return { result: "Mock tool result", mocked: true };
        },
      },
      backend: "anthropic",
      native: true,
      results,
      capture: () => {},
      promptSnippet: "",
      formatOutput: (markdown: string) => ({
        content: stripCitations(markdown),
        converted: 0,
        skipped: 0,
      }),
    };
  }

  return createWebSearchAieo(opts);
}
