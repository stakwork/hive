import { describe, test, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { NextRequest } from "next/server";

// --- Mocks ---

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ userId: "user-1" })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    agentLog: {
      findUnique: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: vi.fn(),
}));

vi.mock("@/lib/utils/blob-fetch", () => ({
  fetchBlobContent: vi.fn(),
}));

vi.mock("@/lib/utils/agent-log-stats", () => ({
  parseAgentLogStats: vi.fn(),
}));

vi.mock("@/lib/utils/swarm", () => ({
  getJarvisUrl: vi.fn(() => "https://jarvis.example.com"),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: vi.fn(),
  addEdge: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/workspaces/[slug]/agent-logs/[logId]/eval/capture/route";
import { db } from "@/lib/db";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { fetchBlobContent } from "@/lib/utils/blob-fetch";
import { parseAgentLogStats } from "@/lib/utils/agent-log-stats";
import { addNode, addEdge } from "@/services/swarm/api/nodes";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>, slug = "test-ws", logId = "log-1") {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/agent-logs/${logId}/eval/capture`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makeParams(slug = "test-ws", logId = "log-1") {
  return { params: Promise.resolve({ slug, logId }) };
}

const SWARM_SUCCESS = {
  success: true,
  data: { swarmName: "test-swarm", swarmApiKey: "key-123" },
};

const BASE_CONFIG = {
  model: "claude-3-5-sonnet",
  temperature: 0.7,
  source: "repo_agent",
  systemOverride: "You are a coding agent.",
  toolsConfig: { ask_clarifying_questions: true },
  tools: { bash: "Run shell commands" },
  baseUrl: "https://api.anthropic.com",
  mcpServers: [],
};

const BASE_AGENT_LOG = {
  workspaceId: "ws-1",
  blobUrl: "https://store.private.blob.vercel-storage.com/test-log.json",
  agentName: "coding-agent",
  source: "github",
  metadata: null,
  config: BASE_CONFIG, // DB column is the canonical source of truth
};

const BASE_WORKSPACE = { slug: "test-ws" };

const SAMPLE_MESSAGES = [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there" },
  { role: "user", content: "Do this task" },
  { role: "assistant", content: "Done" },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/agent-logs/[logId]/eval/capture", () => {
  let origUseMocks: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Disable mock delegation so the live path runs in tests
    origUseMocks = process.env.USE_MOCKS;
    process.env.USE_MOCKS = "false";

    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(SWARM_SUCCESS);
    (db.agentLog.findUnique as Mock).mockResolvedValue(BASE_AGENT_LOG);
    (db.workspace.findUnique as Mock).mockResolvedValue(BASE_WORKSPACE);
    (fetchBlobContent as Mock).mockResolvedValue("{}");
    // blob-parsed config is undefined by default — DB column is the canonical source
    (parseAgentLogStats as Mock).mockReturnValue({
      conversation: SAMPLE_MESSAGES,
      config: undefined,
    });
    (addNode as Mock).mockImplementation((_cfg, node) => {
      const type = node.node_type;
      return Promise.resolve({ success: true, ref_id: `ref-${type}` });
    });
    (addEdge as Mock).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    process.env.USE_MOCKS = origUseMocks;
  });

  // ── Validation ──────────────────────────────────────────────────────────

  test("returns 400 when evalSetId is missing", async () => {
    const res = await POST(
      makeRequest({ requirement: "My req" }),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/evalSetId/i);
  });

  test("returns 400 when requirement is missing", async () => {
    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1" }),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/requirement/i);
  });

  test("returns 400 when both fields are missing", async () => {
    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(400);
  });

  // ── IDOR guard ──────────────────────────────────────────────────────────

  test("returns 404 when agent log does not exist", async () => {
    (db.agentLog.findUnique as Mock).mockResolvedValue(null);
    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Test" }),
      makeParams(),
    );
    expect(res.status).toBe(404);
    // Blob fetch must NOT have been called
    expect(fetchBlobContent).not.toHaveBeenCalled();
  });

  test("returns 403 when log belongs to a different workspace", async () => {
    (db.workspace.findUnique as Mock).mockResolvedValue({ slug: "other-workspace" });
    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Test" }),
      makeParams("test-ws", "log-1"),
    );
    expect(res.status).toBe(403);
    // Both blob fetch and Jarvis must NOT be called before IDOR check passes
    expect(fetchBlobContent).not.toHaveBeenCalled();
    expect(addNode).not.toHaveBeenCalled();
  });

  // ── prompt_snapshot builder ──────────────────────────────────────────────

  test("builds prompt_snapshot with full conversation when turnIndex is undefined", async () => {
    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Full session" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    const nodeData = triggerCall[1].node_data;
    const parsed = JSON.parse(nodeData.body);
    const snapshot = JSON.parse(parsed.prompt_snapshot);

    expect(snapshot.request_params.messages).toHaveLength(4);
    expect(snapshot.request_params.messages).toEqual(SAMPLE_MESSAGES);
    expect(snapshot.method).toBe("post");
  });

  test("slices conversation to turnIndex + 1 messages when turnIndex is provided", async () => {
    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Turn capture", turnIndex: 2 }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    const nodeData = triggerCall[1].node_data;
    const parsed = JSON.parse(nodeData.body);
    const snapshot = JSON.parse(parsed.prompt_snapshot);

    // slice(0, 3) → messages[0], [1], [2]
    expect(snapshot.request_params.messages).toHaveLength(3);
    expect(snapshot.request_params.messages).toEqual(SAMPLE_MESSAGES.slice(0, 3));
  });

  test("uses config.resolvedRequestUrl when present", async () => {
    (db.agentLog.findUnique as Mock).mockResolvedValue({
      ...BASE_AGENT_LOG,
      config: { ...BASE_CONFIG, resolvedRequestUrl: "https://api.anthropic.com/v1/messages" },
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "URL test" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    const nodeData = triggerCall[1].node_data;
    const parsed = JSON.parse(nodeData.body);
    const snapshot = JSON.parse(parsed.prompt_snapshot);

    expect(snapshot.url).toBe("https://api.anthropic.com/v1/messages");
  });

  test("falls back to empty string for url when resolvedRequestUrl is absent", async () => {
    // BASE_AGENT_LOG.config = BASE_CONFIG which has no resolvedRequestUrl — default mock is sufficient

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "No URL" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    const nodeData = triggerCall[1].node_data;
    const parsed = JSON.parse(nodeData.body);
    const snapshot = JSON.parse(parsed.prompt_snapshot);

    expect(snapshot.url).toBe("");
  });

  // ── change_type resolution ───────────────────────────────────────────────

  test("uses agentLog.source as change_type (DB column takes priority)", async () => {
    // agentLog.source = "github", config.source = "repo_agent"
    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "change_type test" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.change_type).toBe("github");
  });

  // ── source discriminator ─────────────────────────────────────────────────

  test('sets source to "repo_agent" when agentLog.source is "repo_agent"', async () => {
    (db.agentLog.findUnique as Mock).mockResolvedValue({
      ...BASE_AGENT_LOG,
      source: "repo_agent",
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "source repo_agent" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.source).toBe("repo_agent");
  });

  test('sets source to "provider_direct" when agentLog.source is null and resolvedRequestUrl matches Anthropic', async () => {
    (db.agentLog.findUnique as Mock).mockResolvedValue({
      ...BASE_AGENT_LOG,
      source: null,
      config: { ...BASE_CONFIG, resolvedRequestUrl: "https://api.anthropic.com/v1/messages" },
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "source provider_direct" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.source).toBe("provider_direct");
  });

  test('sets source to "jamie_agent" when agentLog.source is "canvas_chat"', async () => {
    (db.agentLog.findUnique as Mock).mockResolvedValue({
      ...BASE_AGENT_LOG,
      source: "canvas_chat",
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "source jamie_agent" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.source).toBe("jamie_agent");
  });

  test('falls back to "repo_agent" source when agentLog.source is unknown and no matching resolvedRequestUrl', async () => {
    (db.agentLog.findUnique as Mock).mockResolvedValue({
      ...BASE_AGENT_LOG,
      source: "github",
      // config: BASE_CONFIG (default) — no resolvedRequestUrl
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "source fallback" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.source).toBe("repo_agent");
  });

  test("falls back to config.source when agentLog.source is null", async () => {
    (db.agentLog.findUnique as Mock).mockResolvedValue({
      ...BASE_AGENT_LOG,
      source: null,
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "fallback test" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.change_type).toBe("repo_agent");
  });

  test("falls back to swarm_agent when both agentLog.source and config.source are null", async () => {
    (db.agentLog.findUnique as Mock).mockResolvedValue({
      ...BASE_AGENT_LOG,
      source: null,
      config: { model: "gpt-4", temperature: 0 }, // no source
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "fallback all" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.change_type).toBe("swarm_agent");
  });

  // ── scope points ─────────────────────────────────────────────────────────

  test("sets start_point and end_point to 'session:full' when no turnIndex", async () => {
    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "scope full" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.start_point).toBe("session:full");
    expect(triggerCall[1].node_data.end_point).toBe("session:full");
  });

  test("sets start_point and end_point to 'turn:{N}' when turnIndex provided", async () => {
    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "scope turn", turnIndex: 3 }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.start_point).toBe("turn:3");
    expect(triggerCall[1].node_data.end_point).toBe("turn:3");
  });

  // ── metadata.prompts forwarding ──────────────────────────────────────────

  test("forwards metadata.prompts as individually JSON-stringified strings", async () => {
    const prompts = [
      { name: "prompt-a", resolution: { value: "v1" } },
      { name: "prompt-b", resolution: { value: "v2" } },
    ];
    (db.agentLog.findUnique as Mock).mockResolvedValue({
      ...BASE_AGENT_LOG,
      metadata: { prompts },
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "prompts test" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.prompts).toEqual([
      JSON.stringify(prompts[0]),
      JSON.stringify(prompts[1]),
    ]);
  });

  test("omits prompts field when metadata.prompts is absent", async () => {
    (db.agentLog.findUnique as Mock).mockResolvedValue({
      ...BASE_AGENT_LOG,
      metadata: null,
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "no prompts" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.prompts).toBeUndefined();
  });

  // ── edges and success response ───────────────────────────────────────────

  test("wires HAS_REQUIREMENT and HAS_TRIGGER edges and returns success", async () => {
    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Edge test" }),
      makeParams(),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.evalSetRef).toBe("eval-set-1");
    expect(body.data.requirementRef).toBe("ref-EvalRequirement");
    expect(body.data.triggerRef).toBe("ref-EvalTrigger");

    const edgeCalls = (addEdge as Mock).mock.calls;
    const hasReq = edgeCalls.find(([, e]) => e.edge.edge_type === "HAS_REQUIREMENT");
    const hasTrigger = edgeCalls.find(([, e]) => e.edge.edge_type === "HAS_TRIGGER");
    expect(hasReq).toBeDefined();
    expect(hasTrigger).toBeDefined();
  });

  // ── full harness config in request_params ───────────────────────────────

  test("Test A: full harness fields appear in request_params", async () => {
    const fullConfig = {
      ...BASE_CONFIG,
      provider: "anthropic",
      schema: { type: "object" },
      providerConfig: { timeout: 30 },
      repos: ["repo-1"],
    };
    (db.agentLog.findUnique as Mock).mockResolvedValue({
      ...BASE_AGENT_LOG,
      config: fullConfig,
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Full harness fields" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    const nodeData = triggerCall[1].node_data;
    const parsed = JSON.parse(nodeData.body);
    const snapshot = JSON.parse(parsed.prompt_snapshot);
    const rp = snapshot.request_params;

    expect(rp.systemOverride).toBe("You are a coding agent.");
    expect(rp.toolsConfig).toEqual({ ask_clarifying_questions: true });
    expect(rp.tools).toEqual({ bash: "Run shell commands" });
    expect(rp.baseUrl).toBe("https://api.anthropic.com");
    expect(rp.mcpServers).toEqual([]);
    expect(rp.provider).toBe("anthropic");
    expect(rp.schema).toEqual({ type: "object" });
    expect(rp.providerConfig).toEqual({ timeout: 30 });
    expect(rp.repos).toEqual(["repo-1"]);
    expect(rp.source).toBe("repo_agent");
    expect(rp.messages).toEqual(SAMPLE_MESSAGES);
  });

  test("Test B: role:\"system\" message is preserved when turnIndex is set", async () => {
    const messagesWithSystem = [
      { role: "system", content: "System prompt" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "Do this task" },
    ];
    (parseAgentLogStats as Mock).mockReturnValue({
      conversation: messagesWithSystem,
      config: undefined,
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "System preserved", turnIndex: 2 }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    const nodeData = triggerCall[1].node_data;
    const parsed = JSON.parse(nodeData.body);
    const snapshot = JSON.parse(parsed.prompt_snapshot);

    // slice(0, 3) keeps index 0 (system), 1, 2
    expect(snapshot.request_params.messages).toHaveLength(3);
    expect(snapshot.request_params.messages[0].role).toBe("system");
  });

  test("Test C: PromptResolution map in metadata.prompts is normalised to flat array", async () => {
    (db.agentLog.findUnique as Mock).mockResolvedValue({
      ...BASE_AGENT_LOG,
      metadata: {
        prompts: {
          MY_PROMPT: { prompt_id: 1, prompt_version_id: 2, resolution: {} },
        },
      },
    });

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "PromptResolution map" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.prompts).toEqual([
      JSON.stringify({ name: "MY_PROMPT", prompt_id: 1, prompt_version_id: 2 }),
    ]);
  });

  // ── fallback: DB config null → blob-parsed config ───────────────────────

  test("falls back to blob-parsed config for request_params when DB config column is null", async () => {
    (db.agentLog.findUnique as Mock).mockResolvedValue({ ...BASE_AGENT_LOG, config: null });
    (parseAgentLogStats as Mock).mockReturnValue({
      conversation: SAMPLE_MESSAGES,
      config: BASE_CONFIG,
    });

    await POST(makeRequest({ evalSetId: "eval-set-1", requirement: "fallback" }), makeParams());

    const triggerCall = (addNode as Mock).mock.calls.find(([, n]) => n.node_type === "EvalTrigger");
    const snapshot = JSON.parse(JSON.parse(triggerCall![1].node_data.body).prompt_snapshot);
    expect(snapshot.request_params.model).toBe(BASE_CONFIG.model);
    expect(snapshot.request_params.systemOverride).toBe(BASE_CONFIG.systemOverride);
  });

  // ── USE_MOCKS delegation ─────────────────────────────────────────────────

  test("delegates to mock endpoint when USE_MOCKS=true", async () => {
    process.env.USE_MOCKS = "true";

    // Mock the fetch to simulate the mock endpoint responding
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: { evalSetRef: "eval-set-1", requirementRef: "mock-req-ref", triggerRef: "mock-trigger-ref" },
      }),
    } as Response);

    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Mock test" }),
      makeParams(),
    );

    const body = await res.json();
    expect(body.success).toBe(true);
    // Should NOT have touched Jarvis
    expect(addNode).not.toHaveBeenCalled();

    globalThis.fetch = origFetch;
  });
});

// ─── Mock endpoint ────────────────────────────────────────────────────────────

describe("POST /api/mock/agent-logs/[logId]/eval/capture", () => {
  test("returns success stub with echoed evalSetId", async () => {
    const { POST: mockPOST } = await import(
      "@/app/api/mock/agent-logs/[logId]/eval/capture/route"
    );

    const req = new NextRequest(
      "http://localhost/api/mock/agent-logs/log-42/eval/capture",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evalSetId: "my-eval-set", requirement: "Test req" }),
      },
    );

    const res = await mockPOST(req, {
      params: Promise.resolve({ logId: "log-42" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.evalSetRef).toBe("my-eval-set");
    expect(body.data.requirementRef).toContain("log-42");
    expect(body.data.triggerRef).toBeDefined();
  });

  test("falls back to mock-evalset-ref when no evalSetId provided", async () => {
    const { POST: mockPOST } = await import(
      "@/app/api/mock/agent-logs/[logId]/eval/capture/route"
    );

    const req = new NextRequest(
      "http://localhost/api/mock/agent-logs/log-1/eval/capture",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    const res = await mockPOST(req, {
      params: Promise.resolve({ logId: "log-1" }),
    });

    const body = await res.json();
    expect(body.data.evalSetRef).toBe("mock-evalset-ref");
  });
});
