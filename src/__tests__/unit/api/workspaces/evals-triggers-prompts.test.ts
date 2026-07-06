/**
 * Unit tests for prompts[] persistence in the /triggers POST route.
 *
 * Covers:
 * - session resolves to a log with metadata.prompts → prompts written correctly (JSON-stringified shape)
 * - session resolves to a log with no prompts → prompts field omitted, still succeeds
 * - session has no matching log_url → prompts field omitted, still succeeds
 * - Jarvis session lookup throws → prompts field omitted, no 500
 * - DB lookup throws → prompts field omitted, no 500
 * - IDOR guard: agentLog.workspaceId !== request workspaceId → prompts omitted, no 500
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

vi.mock("@/lib/utils/swarm", () => ({
  getJarvisUrl: vi.fn(() => "https://jarvis.example.com"),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: vi.fn(),
  addEdge: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    agentLog: { findFirst: vi.fn() },
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from "@/app/api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]/triggers/route";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { db } from "@/lib/db";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SWARM_SUCCESS = {
  success: true,
  data: {
    swarmName: "test-swarm",
    swarmApiKey: "key-abc",
    workspaceId: "ws-1",
  },
};

const VALID_BODY = {
  agent: "repo-agent",
  agentName: "repo-agent",
  start_point: "start",
  end_point: "end",
  environment: "env-1",
  session_ref_id: "session-ref-123",
};

function makeRequest(body = VALID_BODY) {
  return new NextRequest(
    "http://localhost/api/workspaces/test-ws/evals/eval-set-1/requirements/req-1/triggers",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const ROUTE_PARAMS = {
  params: Promise.resolve({ slug: "test-ws", evalSetId: "eval-set-1", reqId: "req-1" }),
};

/** Mock a Jarvis session response with a given log_url */
function mockJarvisSessionResponse(logUrl: string | undefined) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ref_id: "session-ref-123",
      node_type: "AgentSession",
      properties: logUrl ? { log_url: logUrl } : {},
    }),
  } as Response);
}

/** Mock Jarvis returning a non-OK response */
function mockJarvisError(status = 500) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: "Server error" }),
  } as Response);
}

/** Mock Jarvis fetch throwing */
function mockJarvisFetchThrows() {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  originalFetch = globalThis.fetch;
  process.env.USE_MOCKS = "false";
  (getWorkspaceSwarmAccess as Mock).mockResolvedValue(SWARM_SUCCESS);
  (addNode as Mock).mockResolvedValue({ success: true, ref_id: "node-ref-1" });
  (addEdge as Mock).mockResolvedValue({ success: true });
  (db.agentLog.findFirst as Mock).mockResolvedValue(null);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.USE_MOCKS = "false";
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /triggers — prompts[] persistence via resolveSessionPrompts", () => {
  test("writes prompts[] onto EvalTrigger when session resolves to log with metadata.prompts array", async () => {
    const promptEntries = [
      { name: "p1", prompt_id: 1, prompt_version_id: 10 },
      { name: "p2", prompt_id: 2, prompt_version_id: 20, resolution: "v2" },
    ];
    mockJarvisSessionResponse("https://blob.example.com/log.json");
    (db.agentLog.findFirst as Mock).mockResolvedValue({
      workspaceId: "ws-1",
      metadata: { prompts: promptEntries },
    });

    const res = await POST(makeRequest(), ROUTE_PARAMS);
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
        prompt_id: 5,
        prompt_version_id: 50,
        resolution: { value: "resolved-value" },
      },
    };
    mockJarvisSessionResponse("https://blob.example.com/log.json");
    (db.agentLog.findFirst as Mock).mockResolvedValue({
      workspaceId: "ws-1",
      metadata: { prompts: record },
    });

    const res = await POST(makeRequest(), ROUTE_PARAMS);
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    const { prompts } = triggerCall![1].node_data;
    expect(prompts).toHaveLength(1);
    const parsed = JSON.parse(prompts[0]);
    expect(parsed).toMatchObject({
      name: "my_prompt",
      prompt_id: 5,
      prompt_version_id: 50,
      resolution: "resolved-value",
    });
  });

  test("omits prompts field when log has no metadata.prompts", async () => {
    mockJarvisSessionResponse("https://blob.example.com/log.json");
    (db.agentLog.findFirst as Mock).mockResolvedValue({
      workspaceId: "ws-1",
      metadata: { other: "data" },
    });

    const res = await POST(makeRequest(), ROUTE_PARAMS);
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    expect(triggerCall![1].node_data.prompts).toBeUndefined();
  });

  test("omits prompts field when session has no log_url", async () => {
    mockJarvisSessionResponse(undefined); // no log_url in properties
    (db.agentLog.findFirst as Mock).mockResolvedValue(null);

    const res = await POST(makeRequest(), ROUTE_PARAMS);
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    expect(triggerCall![1].node_data.prompts).toBeUndefined();
  });

  test("omits prompts field when no AgentLog is found for log_url", async () => {
    mockJarvisSessionResponse("https://blob.example.com/not-found.json");
    (db.agentLog.findFirst as Mock).mockResolvedValue(null);

    const res = await POST(makeRequest(), ROUTE_PARAMS);
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    expect(triggerCall![1].node_data.prompts).toBeUndefined();
  });

  test("omits prompts and does NOT 500 when Jarvis session fetch returns non-OK", async () => {
    mockJarvisError(500);

    const res = await POST(makeRequest(), ROUTE_PARAMS);
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    expect(triggerCall![1].node_data.prompts).toBeUndefined();
  });

  test("omits prompts and does NOT 500 when Jarvis fetch throws a network error", async () => {
    mockJarvisFetchThrows();

    const res = await POST(makeRequest(), ROUTE_PARAMS);
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    expect(triggerCall![1].node_data.prompts).toBeUndefined();
  });

  test("omits prompts and does NOT 500 when DB lookup throws", async () => {
    mockJarvisSessionResponse("https://blob.example.com/log.json");
    (db.agentLog.findFirst as Mock).mockRejectedValue(new Error("DB connection lost"));

    const res = await POST(makeRequest(), ROUTE_PARAMS);
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    expect(triggerCall![1].node_data.prompts).toBeUndefined();
  });

  test("IDOR guard: omits prompts when agentLog.workspaceId does not match request workspaceId", async () => {
    mockJarvisSessionResponse("https://blob.example.com/log.json");
    (db.agentLog.findFirst as Mock).mockResolvedValue({
      workspaceId: "ws-OTHER", // different workspace
      metadata: {
        prompts: [{ name: "p1", prompt_id: 1, prompt_version_id: 10 }],
      },
    });

    const res = await POST(makeRequest(), ROUTE_PARAMS);
    // Trigger creation still succeeds
    expect(res.status).toBe(200);

    const triggerCall = (addNode as Mock).mock.calls.find(
      ([, n]: [unknown, { node_type: string }]) => n.node_type === "EvalTrigger",
    );
    // Prompts must NOT be written — cross-workspace data leak prevented
    expect(triggerCall![1].node_data.prompts).toBeUndefined();
  });
});
