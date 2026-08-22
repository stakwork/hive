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
 * Bifrost gateway reachability probe.
 *
 * Bifrost-routed LLM calls go through ONE gateway — the primary
 * workspace's swarm proxy (`baseUrl`, e.g.
 * `https://swarm38.sphinx.chat:8181`). When that swarm is unreachable
 * (expired/self-signed TLS cert, connection refused, DNS, timeout) the
 * call dies even when the default gateway is healthy.
 *
 * So before committing to the swarm route, callers pre-flight it: any
 * resolved HTTP response (even a 404/401) means the TLS handshake + TCP
 * connect succeeded → the gateway is reachable, keep the Bifrost route.
 * A *rejection* (CERT_HAS_EXPIRED, ECONNREFUSED, timeout, fetch failed)
 * means we can't talk to it → drop the entire Bifrost bundle (baseUrl +
 * VK + macaroon) and fall back to the plain default gateway.
 *
 * We probe rather than catch a mid-stream `streamText` error because by
 * the time that surfaces, the HTTP response is already returned to the
 * client and the stream can't be restarted.
 */
export const GATEWAY_PROBE_TIMEOUT_MS = 3000;
export async function isGatewayReachable(
  baseUrl: string,
  timeoutMs: number = GATEWAY_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    await fetch(baseUrl, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Any resolved response (any status) means the connection — and
    // therefore the certificate — is fine. We don't care about the body.
    return true;
  } catch {
    return false;
  }
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
