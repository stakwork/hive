import { describe, it, expect, vi, beforeEach } from "vitest";

// Real-aieo branch requires USE_MOCKS to be falsy (otherwise getModel
// short-circuits to the local Anthropic mock).
vi.mock("@/config/env", () => ({
  config: { USE_MOCKS: false, MOCK_BASE: "http://localhost:3000" },
}));

const getModelAieo = vi.fn(() => ({ modelId: "stub" }));

vi.mock("aieo", () => ({
  getModel: (...args: unknown[]) => getModelAieo(...args),
  getProviderTool: vi.fn(),
  getApiKeyForProvider: vi.fn(() => "real-key"),
}));

import { getModel } from "@/lib/ai/provider";

function lastOpts() {
  return getModelAieo.mock.calls.at(-1)?.[1] as {
    headers?: Record<string, string>;
    baseUrl?: string;
  };
}

describe("getModel Bifrost passthrough header", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds a claude-code user-agent for Anthropic calls routed through Bifrost", () => {
    getModel("anthropic", "key", "slug", undefined, {
      baseUrl: "https://gw.example/anthropic/v1",
      headers: { "x-macaroon": "tok" },
    });

    const opts = lastOpts();
    expect(opts.baseUrl).toBe("https://gw.example/anthropic/v1");
    expect(opts.headers?.["user-agent"]).toBe("claude-code");
    // Existing Bifrost headers (cost-tracking macaroon) are preserved.
    expect(opts.headers?.["x-macaroon"]).toBe("tok");
  });

  it("does NOT add the user-agent when there is no Bifrost baseUrl", () => {
    getModel("anthropic", "key", "slug", undefined, {
      headers: { "x-macaroon": "tok" },
    });

    expect(lastOpts().headers?.["user-agent"]).toBeUndefined();
  });

  it("does NOT add the user-agent for non-Anthropic providers", () => {
    getModel("openai", "key", "slug", undefined, {
      baseUrl: "https://gw.example/openai/v1",
    });

    expect(lastOpts().headers?.["user-agent"]).toBeUndefined();
  });

  it("leaves direct (non-Bifrost) calls untouched", () => {
    getModel("anthropic", "key");
    const opts = lastOpts();
    expect(opts.baseUrl).toBeUndefined();
    expect(opts.headers).toBeUndefined();
  });
});
