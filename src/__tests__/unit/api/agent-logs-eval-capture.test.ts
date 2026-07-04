import { describe, test, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { NextRequest } from "next/server";

// --- Mocks ---

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ userId: "user-1" })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: vi.fn(),
}));

// The route now delegates IDOR + transcript resolution to resolveCaptureSource.
vi.mock("@/lib/eval-capture/resolve-capture-source", () => ({
  resolveCaptureSource: vi.fn(),
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
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { resolveCaptureSource } from "@/lib/eval-capture/resolve-capture-source";
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

const SAMPLE_MESSAGES = [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there" },
  { role: "user", content: "Do this task" },
  { role: "assistant", content: "Done" },
];

/** Default resolveCaptureSource result for the AgentLog branch */
function makeAgentLogCapture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: "agent_log" as const,
    workspaceId: "ws-1",
    blobUrl: "https://store.private.blob.vercel-storage.com/test-log.json",
    agent: overrides.agent ?? null,
    source: overrides.source ?? "github",
    metadata: overrides.metadata ?? null,
    config: overrides.config ?? BASE_CONFIG,
    conversation: (overrides.conversation as typeof SAMPLE_MESSAGES) ?? SAMPLE_MESSAGES,
    effectiveConfig: (overrides.effectiveConfig as Record<string, unknown> | undefined) ?? BASE_CONFIG,
    ...overrides,
  };
}

/** Default resolveCaptureSource result for the Conversation branch */
function makeConversationCapture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: "conversation" as const,
    workspaceId: "ws-1",
    conversationId: "conv-abc",
    source: (overrides.source as string | null) ?? "org-canvas",
    conversation: (overrides.conversation as typeof SAMPLE_MESSAGES) ?? SAMPLE_MESSAGES,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/agent-logs/[logId]/eval/capture", () => {
  let origUseMocks: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    origUseMocks = process.env.USE_MOCKS;
    process.env.USE_MOCKS = "false";

    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(SWARM_SUCCESS);
    // Default: AgentLog found and owned
    (resolveCaptureSource as Mock).mockResolvedValue(makeAgentLogCapture());
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

  test("returns 404 when resolveCaptureSource returns null (record not found)", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(null);
    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Test" }),
      makeParams(),
    );
    expect(res.status).toBe(404);
    // Jarvis must NOT have been called
    expect(addNode).not.toHaveBeenCalled();
  });

  test("returns 403 when resolveCaptureSource returns { denied: true }", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue({ denied: true });
    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Test" }),
      makeParams("test-ws", "log-1"),
    );
    expect(res.status).toBe(403);
    expect(addNode).not.toHaveBeenCalled();
  });

  // ── prompt_snapshot builder (AgentLog branch) ────────────────────────────

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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({
        effectiveConfig: { ...BASE_CONFIG, resolvedRequestUrl: "https://api.anthropic.com/v1/messages" },
      }),
    );

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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ source: "github" }),
    );

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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ source: "repo_agent" }),
    );

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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({
        source: null,
        effectiveConfig: { ...BASE_CONFIG, resolvedRequestUrl: "https://api.anthropic.com/v1/messages" },
      }),
    );

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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ source: "canvas_chat" }),
    );

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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ source: "github" }),
    );

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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ source: null }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "fallback test" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    // effectiveConfig.source = "repo_agent"
    expect(triggerCall[1].node_data.change_type).toBe("repo_agent");
  });

  test("falls back to swarm_agent when both agentLog.source and config.source are null", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({
        source: null,
        effectiveConfig: { model: "gpt-4", temperature: 0 }, // no source
      }),
    );

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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ metadata: { prompts } }),
    );

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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ metadata: null }),
    );

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

  // ── agent auto-detection from AgentLog.agent ────────────────────────────

  test("parses canonical agent from agentLog.agent cuid-suffixed value", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ agent: "coding-agent-cmr3lw4o5abc" }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Agent parse test" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.agent).toBe("coding-agent");
  });

  test("parses wfe-agent from agentLog.agent", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ agent: "wfe-agent-cmr3abc123xyz" }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "WFE agent test" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.agent).toBe("wfe-agent");
  });

  test("falls back to resolveHiveAgentName when agentLog.agent is not parseable", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({
        agent: "unknown-bot-xyz",
        source: "canvas_chat", // jamie_agent source → canvas-agent default
      }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Fallback agent test" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.agent).toBe("canvas-agent");
  });

  test("falls back to source-bucket default when agentLog.agent is null", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ agent: null, source: "repo_agent" }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Null agent test" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.agent).toBe("repo-agent");
  });

  // ── Optional agent override ───────────────────────────────────────────────

  test("uses explicit agent override when it is a valid catalog name (AgentLog branch)", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ agent: "coding-agent-cmr3abc", source: "repo_agent" }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Agent override", agent: "plan-agent" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.agent).toBe("plan-agent");
  });

  test("ignores agent override when it is not in CAPTURE_AGENT_NAMES (uses auto-derived)", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ agent: "coding-agent-cmr3abc", source: "repo_agent" }),
    );

    await POST(
      makeRequest({
        evalSetId: "eval-set-1",
        requirement: "Invalid override",
        agent: "totally-unknown-bot",
      }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    // Falls back to parsed agent from agentLog.agent
    expect(triggerCall[1].node_data.agent).toBe("coding-agent");
  });

  // ── Conversation branch ────────────────────────────────────────────────────

  test("succeeds for conversation branch with canvas_chat defaults to canvas-agent", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(makeConversationCapture());

    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Canvas capture" }),
      makeParams("test-ws", "conv-abc"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.agent).toBe("canvas-agent");
    expect(triggerCall[1].node_data.source).toBe("jamie_agent");
  });

  test("conversation branch: environment is set to conversationId", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeConversationCapture({ conversationId: "conv-xyz" }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Conversation env" }),
      makeParams("test-ws", "conv-xyz"),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.environment).toBe("conv-xyz");
  });

  test("conversation branch: prompt_snapshot contains messages from conversation", async () => {
    const convMessages = [
      { role: "user", content: "Canvas question" },
      { role: "assistant", content: "Canvas answer" },
    ];
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeConversationCapture({ conversation: convMessages }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Conv snapshot" }),
      makeParams("test-ws", "conv-abc"),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    const parsed = JSON.parse(triggerCall[1].node_data.body);
    const snapshot = JSON.parse(parsed.prompt_snapshot);
    expect(snapshot.request_params.messages).toEqual(convMessages);
  });

  test("conversation branch: slices to turnIndex + 1 when turnIndex provided", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(makeConversationCapture());

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Conv turn", turnIndex: 1 }),
      makeParams("test-ws", "conv-abc"),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    const parsed = JSON.parse(triggerCall[1].node_data.body);
    const snapshot = JSON.parse(parsed.prompt_snapshot);
    // SAMPLE_MESSAGES has 4 items; turnIndex=1 → slice(0, 2)
    expect(snapshot.request_params.messages).toHaveLength(2);
  });

  test("conversation branch: explicit agent override is respected", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(makeConversationCapture());

    await POST(
      makeRequest({
        evalSetId: "eval-set-1",
        requirement: "Conv agent override",
        agent: "repo-agent",
      }),
      makeParams("test-ws", "conv-abc"),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    expect(triggerCall[1].node_data.agent).toBe("repo-agent");
  });

  test("conversation branch: IDOR denied returns 403 without Jarvis calls", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue({ denied: true });

    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "IDOR conv" }),
      makeParams("test-ws", "conv-other-ws"),
    );

    expect(res.status).toBe(403);
    expect(addNode).not.toHaveBeenCalled();
  });

  // ── HiveAgent upsert + ATTRIBUTED_TO edge (non-fatal) ────────────────────

  test("upserts HiveAgent node after EvalTrigger creation", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ agent: "coding-agent-cmr3lw4o5abc" }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "HiveAgent upsert" }),
      makeParams(),
    );

    const hiveAgentCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "HiveAgent",
    );
    expect(hiveAgentCall).toBeDefined();
    expect(hiveAgentCall[1].node_data.name).toBe("coding-agent");
    expect(hiveAgentCall[1].node_data.display_name).toBeTruthy();
    expect(hiveAgentCall[1].node_data.description).toBeTruthy();
  });

  test("upserts HiveAgent node with correct spec for wfe-agent", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ agent: "wfe-agent-cmr3abc" }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "WFE HiveAgent test" }),
      makeParams(),
    );

    const hiveAgentCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "HiveAgent",
    );
    expect(hiveAgentCall).toBeDefined();
    expect(hiveAgentCall[1].node_data.name).toBe("wfe-agent");
    expect(hiveAgentCall[1].node_data.display_name).toBeTruthy();
  });

  test("writes ATTRIBUTED_TO edge from EvalTrigger to HiveAgent", async () => {
    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "ATTRIBUTED_TO test" }),
      makeParams(),
    );

    const attrEdge = (addEdge as Mock).mock.calls.find(
      ([, e]) => e.edge.edge_type === "ATTRIBUTED_TO",
    );
    expect(attrEdge).toBeDefined();
    expect(attrEdge[1].source.ref_id).toBe("ref-EvalTrigger");
    expect(attrEdge[1].target.node_type).toBe("HiveAgent");
    expect(attrEdge[1].target.node_data.name).toBeTruthy();
  });

  test("HiveAgent upsert failure does not fail the capture (non-fatal)", async () => {
    (addNode as Mock).mockImplementation((_cfg, node) => {
      if (node.node_type === "HiveAgent") {
        return Promise.resolve({ success: false, error: "HiveAgent upsert failed" });
      }
      return Promise.resolve({ success: true, ref_id: `ref-${node.node_type}` });
    });

    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Non-fatal test" }),
      makeParams(),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("ATTRIBUTED_TO edge failure does not fail the capture (non-fatal)", async () => {
    (addEdge as Mock).mockImplementation((_cfg, edge) => {
      if (edge.edge.edge_type === "ATTRIBUTED_TO") {
        return Promise.resolve({ success: false, error: "Edge type not registered" });
      }
      return Promise.resolve({ success: true });
    });

    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "ATTRIBUTED_TO non-fatal" }),
      makeParams(),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("HiveAgent/ATTRIBUTED_TO throws does not fail the capture (non-fatal)", async () => {
    (addNode as Mock).mockImplementation((_cfg, node) => {
      if (node.node_type === "HiveAgent") {
        throw new Error("Unexpected Jarvis error");
      }
      return Promise.resolve({ success: true, ref_id: `ref-${node.node_type}` });
    });

    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "HiveAgent throw" }),
      makeParams(),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  // ── agentName in response ────────────────────────────────────────────────

  test("response includes agentName in data", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ agent: "plan-agent-cmr3xyz" }),
    );

    const res = await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "Response agentName test" }),
      makeParams(),
    );

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.agentName).toBe("plan-agent");
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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ effectiveConfig: fullConfig }),
    );

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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ conversation: messagesWithSystem }),
    );

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
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({
        metadata: {
          prompts: {
            MY_PROMPT: { prompt_id: 1, prompt_version_id: 2, resolution: {} },
          },
        },
      }),
    );

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

  test("PromptResolution map with resolution.value is normalised to include resolution string", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({
        metadata: {
          prompts: {
            MY_PROMPT: {
              prompt_id: 1,
              prompt_version_id: 2,
              resolution: { value: "You are a coding agent." },
            },
          },
        },
      }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "resolution passthrough" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    const prompts = triggerCall![1].node_data.prompts;
    expect(prompts).toHaveLength(1);
    const entry = JSON.parse(prompts[0]);
    expect(entry).toEqual({
      name: "MY_PROMPT",
      prompt_id: 1,
      prompt_version_id: 2,
      resolution: "You are a coding agent.",
    });
  });

  test("PromptResolution map with object resolution.value is flattened to string", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({
        metadata: {
          prompts: {
            JSON_PROMPT: {
              prompt_id: 3,
              prompt_version_id: 4,
              resolution: { value: { key: "val" } },
            },
          },
        },
      }),
    );

    await POST(
      makeRequest({ evalSetId: "eval-set-1", requirement: "json resolution" }),
      makeParams(),
    );

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, node]) => node.node_type === "EvalTrigger",
    );
    const entry = JSON.parse(triggerCall![1].node_data.prompts[0]);
    expect(typeof entry.resolution).toBe("string");
    expect(entry.resolution).toBe(String({ key: "val" }));
  });

  // ── fallback: DB config null → blob-parsed config ───────────────────────

  test("falls back to blob-parsed config for request_params when DB config column is null", async () => {
    // effectiveConfig = undefined simulates DB config null + blob-parsed config result
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ effectiveConfig: BASE_CONFIG }),
    );

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
        data: {
          evalSetRef: "eval-set-1",
          requirementRef: "mock-req-ref",
          triggerRef: "mock-trigger-ref",
        },
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
