/**
 * Unit tests for fetchLatestWorkflowJson in workflow-editor service.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all dependencies before importing the module
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/config/env", () => ({ config: {} }));
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getTaskChannelName: vi.fn(),
  PUSHER_EVENTS: {},
}));
vi.mock("@/lib/utils", () => ({ getBaseUrl: vi.fn() }));
vi.mock("@/lib/utils/swarm", () => ({ transformSwarmUrlToRepo2Graph: vi.fn() }));
vi.mock("@/lib/auth/nextauth", () => ({ getGithubUsernameAndPAT: vi.fn() }));
vi.mock("@/lib/vercel/stakwork-token", () => ({ getStakworkTokenReference: vi.fn() }));
vi.mock("@/lib/helpers/chat-history", () => ({ fetchChatHistory: vi.fn() }));

import { fetchLatestWorkflowJson } from "@/services/workflow-editor";

const GRAPH_URL = "https://jarvis.example.com";
const GRAPH_KEY = "test-api-key";

describe("fetchLatestWorkflowJson", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      STAKWORK_JARVIS_URL: GRAPH_URL,
      STAKWORK_GRAPH_API_KEY: GRAPH_KEY,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns null when workflowId is null", async () => {
    const result = await fetchLatestWorkflowJson(null);
    expect(result).toBeNull();
  });

  it("returns null when env vars are missing", async () => {
    delete process.env.STAKWORK_JARVIS_URL;
    const result = await fetchLatestWorkflowJson(42);
    expect(result).toBeNull();
  });

  it("sends search_filters with both workflow_id and published=true filters", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchLatestWorkflowJson(123);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${GRAPH_URL}/api/graph/search/attributes`);

    const body = JSON.parse(options.body);
    expect(body.search_filters).toContainEqual({
      attribute: "workflow_id",
      value: 123,
      comparator: "=",
    });
    expect(body.search_filters).toContainEqual({
      attribute: "published",
      value: true,
      comparator: "=",
    });
  });

  it("returns null when the API response contains no nodes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [] }),
    }));

    const result = await fetchLatestWorkflowJson(99);
    expect(result).toBeNull();
  });

  it("returns the workflow_json of the highest-workflow_version_id node", async () => {
    const nodes = [
      { properties: { workflow_version_id: 1, workflow_json: '{"version":1}' } },
      { properties: { workflow_version_id: 3, workflow_json: '{"version":3}' } },
      { properties: { workflow_version_id: 2, workflow_json: '{"version":2}' } },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes }),
    }));

    const result = await fetchLatestWorkflowJson(7);
    expect(result).toBe('{"version":3}');
  });

  it("returns null when the API response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const result = await fetchLatestWorkflowJson(5);
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await fetchLatestWorkflowJson(5);
    expect(result).toBeNull();
  });

  it("serializes workflow_json if it is an object (not a string)", async () => {
    const nodes = [
      { properties: { workflow_version_id: 1, workflow_json: { steps: [] } } },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes }),
    }));

    const result = await fetchLatestWorkflowJson(10);
    expect(result).toBe(JSON.stringify({ steps: [] }));
  });
});
