import { describe, it, expect, vi, beforeEach } from "vitest";
import { lookupAgentSessionByLogUrl } from "@/lib/utils/agent-session-lookup";

const config = {
  jarvisUrl: "https://test-swarm.sphinx.chat:8444",
  apiKey: "test-api-key",
};
const logUrl = "https://blob.example.com/logs/some-log.json";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("lookupAgentSessionByLogUrl", () => {
  it("returns ref_id when a matching AgentSession is found", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [{ ref_id: "abc-123" }] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await lookupAgentSessionByLogUrl(config, logUrl);

    expect(result).toBe("abc-123");

    const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain("type=AgentSession");
    expect(calledUrl).toContain(`log_url=${encodeURIComponent(logUrl)}`);
    expect(calledOptions?.headers?.["x-api-token"]).toBe("test-api-key");
  });

  it("returns null when no matching AgentSession is found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [] }),
    }));

    const result = await lookupAgentSessionByLogUrl(config, logUrl);

    expect(result).toBeNull();
  });

  it("returns null on non-OK HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
    }));

    const result = await lookupAgentSessionByLogUrl(config, logUrl);

    expect(result).toBeNull();
  });

  it("returns null when fetch throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const result = await lookupAgentSessionByLogUrl(config, logUrl);

    expect(result).toBeNull();
  });
});
