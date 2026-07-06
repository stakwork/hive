/**
 * Unit tests for prompts[] persistence in the /flag-as-eval route.
 *
 * Covers:
 * - agent_log branch: prompts written with correct JSON-stringified shape when metadata.prompts exists
 * - agent_log branch: prompts omitted when metadata.prompts is absent
 * - conversation branch: prompts always omitted (no metadata)
 * - route still returns success in all cases
 */

import { describe, test, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ userId: "user-1" })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: vi.fn(),
}));

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

vi.mock("@/lib/utils/agent-session-lookup", () => ({
  lookupAgentSessionByLogUrl: vi.fn(() => null),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/workspaces/[slug]/agent-logs/[logId]/flag-as-eval/route";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { resolveCaptureSource } from "@/lib/eval-capture/resolve-capture-source";
import { addNode, addEdge } from "@/services/swarm/api/nodes";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SWARM_SUCCESS = {
  success: true,
  data: { swarmName: "test-swarm", swarmApiKey: "key-abc", workspaceId: "ws-1" },
};

const VALID_BODY = {
  evalSetId: "eval-set-1",
  requirementName: "Test requirement",
  requirementDescription: "Description",
  positiveCases: ["case-a"],
  negativeCases: ["case-b"],
  agent: "test-agent",
  environment: "env-1",
  source: "repo_agent",
};

function makeRequest(body = VALID_BODY, logId = "log-1") {
  return new NextRequest(
    `http://localhost/api/workspaces/test-ws/agent-logs/${logId}/flag-as-eval`,
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

function makeAgentLogCapture(metadata: unknown = null) {
  return {
    kind: "agent_log" as const,
    workspaceId: "ws-1",
    blobUrl: "https://blob.example.com/log.json",
    agent: null,
    source: "github",
    metadata,
    config: null,
    conversation: [],
    effectiveConfig: undefined,
  };
}

function makeConversationCapture() {
  return {
    kind: "conversation" as const,
    workspaceId: "ws-1",
    conversationId: "conv-1",
    source: "org-canvas",
    conversation: [],
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env.USE_MOCKS = "false";
  (getWorkspaceSwarmAccess as Mock).mockResolvedValue(SWARM_SUCCESS);
  // Default: addNode returns success for any call
  (addNode as Mock).mockResolvedValue({ success: true, ref_id: "node-ref-1" });
  (addEdge as Mock).mockResolvedValue({ success: true });
});

afterEach(() => {
  process.env.USE_MOCKS = "false";
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /flag-as-eval — prompts[] persistence", () => {
  test("writes prompts[] onto EvalTrigger node_data when metadata.prompts is an array", async () => {
    const promptEntries = [
      { name: "p1", prompt_id: 1, prompt_version_id: 10 },
      { name: "p2", prompt_id: 2, prompt_version_id: 20, resolution: "v2" },
    ];
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ prompts: promptEntries }),
    );

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    expect(triggerCall).toBeDefined();
    const { prompts } = triggerCall![1].node_data;
    expect(prompts).toHaveLength(2);
    expect(JSON.parse(prompts[0])).toEqual(promptEntries[0]);
    expect(JSON.parse(prompts[1])).toEqual(promptEntries[1]);
  });

  test("writes prompts[] from PromptResolution record in metadata.prompts", async () => {
    const record = {
      my_prompt: {
        prompt_id: 7,
        prompt_version_id: 77,
        resolution: { value: "resolved" },
      },
    };
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ prompts: record }),
    );

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    const { prompts } = triggerCall![1].node_data;
    expect(prompts).toHaveLength(1);
    const parsed = JSON.parse(prompts[0]);
    expect(parsed).toMatchObject({
      name: "my_prompt",
      prompt_id: 7,
      prompt_version_id: 77,
      resolution: "resolved",
    });
  });

  test("omits prompts field when metadata is null", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(makeAgentLogCapture(null));

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    expect(triggerCall![1].node_data.prompts).toBeUndefined();
  });

  test("omits prompts field when metadata has no prompts key", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ other: "data" }),
    );

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    expect(triggerCall![1].node_data.prompts).toBeUndefined();
  });

  test("omits prompts field for conversation branch (no metadata)", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(makeConversationCapture());

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    expect(triggerCall![1].node_data.prompts).toBeUndefined();
  });

  test("still returns success when metadata.prompts is an empty array", async () => {
    (resolveCaptureSource as Mock).mockResolvedValue(
      makeAgentLogCapture({ prompts: [] }),
    );

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    // empty array → extractMetadataPrompts returns [] → prompts field omitted
    expect(triggerCall![1].node_data.prompts).toBeUndefined();
  });
});
