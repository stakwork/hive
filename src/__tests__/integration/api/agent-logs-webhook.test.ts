/**
 * Integration tests for POST /api/webhook/agent-logs
 *
 * Verifies that after a successful upsert with a feature_id present, the
 * route broadcasts AGENT_LOG_UPDATED on the feature's Pusher channel with
 * the correct payload.
 */

import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { generateUniqueId, generateUniqueSlug, generateUniqueEmail } from "@/__tests__/support/helpers";

// ── Pusher mock ───────────────────────────────────────────────────────────────
const { mockPusherTrigger, mockAddNode, mockAddEdge, mockGetJarvisConfig } = vi.hoisted(() => ({
  mockPusherTrigger: vi.fn(),
  mockAddNode: vi.fn(),
  mockAddEdge: vi.fn(),
  mockGetJarvisConfig: vi.fn(),
}));

vi.mock("@/lib/pusher", async () => {
  const actual = await vi.importActual("@/lib/pusher");
  return {
    ...actual,
    pusherServer: {
      trigger: mockPusherTrigger,
    },
  };
});

// Blob mock — avoids real network calls
vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.example.com/agent-log.json" }),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: mockAddNode,
  addEdge: mockAddEdge,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfig,
}));

// Import route handler after mocks are in place
import { POST } from "@/app/api/webhook/agent-logs/route";
import { NextRequest } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/webhook/agent-logs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": process.env.API_TOKEN ?? "test-token",
    },
    body: JSON.stringify(body),
  });
}

async function createTestSetup() {
  return db.$transaction(async (tx) => {
    const owner = await tx.user.create({
      data: {
        id: generateUniqueId("user"),
        email: generateUniqueEmail("agent-log-webhook"),
        name: "Test Owner",
      },
    });

    const workspace = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Test Workspace",
        slug: generateUniqueSlug("agent-log-ws"),
        ownerId: owner.id,
      },
    });

    const feature = await tx.feature.create({
      data: {
        id: generateUniqueId("feature"),
        title: "Test Feature",
        brief: "Brief",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    return { owner, workspace, feature };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhook/agent-logs — Pusher broadcast", () => {
  let testData: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Ensure API_TOKEN is set for auth check
    process.env.API_TOKEN = "test-token";
    testData = await createTestSetup();
  });

  afterEach(async () => {
    // Cleanup in reverse order
    await db.agentLog.deleteMany({ where: { workspaceId: testData.workspace.id } });
    await db.feature.deleteMany({ where: { workspaceId: testData.workspace.id } });
    await db.workspace.deleteMany({ where: { id: testData.workspace.id } });
    await db.user.deleteMany({ where: { id: testData.owner.id } });
  });

  test("broadcasts AGENT_LOG_UPDATED on the feature channel after successful create", async () => {
    const { workspace, feature } = testData;

    const request = buildRequest({
      agent: "plan-agent-abc",
      workspace_id: workspace.id,
      feature_id: feature.id,
      logs: [{ role: "assistant", content: "Hello" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    expect(mockPusherTrigger).toHaveBeenCalledOnce();
    const [channelName, eventName, payload] = mockPusherTrigger.mock.calls[0];

    expect(channelName).toBe(`feature-${feature.id}`);
    expect(eventName).toBe("agent-log-updated");
    expect(payload).toMatchObject({
      agent: "plan-agent-abc",
      isNew: true,
    });
    expect(typeof payload.id).toBe("string");
    expect(payload.id).toBeTruthy();
    expect(typeof payload.createdAt).toBe("object"); // Date object from Prisma
  });

  test("broadcasts AGENT_LOG_UPDATED with isNew=false on upsert (update)", async () => {
    const { workspace, feature } = testData;

    // First request — creates the record
    await POST(
      buildRequest({
        agent: "plan-agent-abc",
        workspace_id: workspace.id,
        feature_id: feature.id,
        logs: [{ role: "assistant", content: "First" }],
      })
    );

    mockPusherTrigger.mockClear();

    // Second request — updates the same agent/feature combo
    const response = await POST(
      buildRequest({
        agent: "plan-agent-abc",
        workspace_id: workspace.id,
        feature_id: feature.id,
        logs: [{ role: "assistant", content: "Updated" }],
      })
    );

    expect(response.status).toBe(201);
    expect(mockPusherTrigger).toHaveBeenCalledOnce();

    const [, , payload] = mockPusherTrigger.mock.calls[0];
    expect(payload.isNew).toBe(false);
  });

  test("broadcasts on the task channel when task_id is present but feature_id is absent", async () => {
    const { workspace } = testData;

    // Create a task to satisfy the "at least one association" requirement
    const task = await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Test Task",
        workspaceId: workspace.id,
        createdById: testData.owner.id,
        updatedById: testData.owner.id,
      },
    });

    try {
      const request = buildRequest({
        agent: "coding-agent-xyz",
        workspace_id: workspace.id,
        task_id: task.id,
        logs: [{ role: "assistant", content: "No feature" }],
      });

      const response = await POST(request);
      expect(response.status).toBe(201);

      // Pusher should be called on the task channel, not the feature channel
      expect(mockPusherTrigger).toHaveBeenCalledTimes(1);
      const [channel, event, payload] = mockPusherTrigger.mock.calls[0];
      expect(channel).toBe(`task-${task.id}`);
      expect(event).toBe("agent-log-updated");
      expect(payload.agent).toBe("coding-agent-xyz");
      expect(payload.isNew).toBe(true);
    } finally {
      await db.agentLog.deleteMany({ where: { taskId: task.id } });
      await db.task.deleteMany({ where: { id: task.id } });
    }
  });

  test("returns 201 even when Pusher broadcast throws", async () => {
    const { workspace, feature } = testData;

    // Simulate Pusher failure
    mockPusherTrigger.mockRejectedValueOnce(new Error("Pusher unavailable"));

    const request = buildRequest({
      agent: "plan-agent-failing",
      workspace_id: workspace.id,
      feature_id: feature.id,
      logs: [{ role: "assistant", content: "Log content" }],
    });

    const response = await POST(request);
    // Webhook must succeed even when Pusher fails
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.success).toBe(true);
  });

  test("returns 401 when API token is missing", async () => {
    const request = new NextRequest("http://localhost/api/webhook/agent-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "x", workspace_id: "y", feature_id: "z", logs: [] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(mockPusherTrigger).not.toHaveBeenCalled();
  });
});

// ── Jarvis graph write tests ───────────────────────────────────────────────────

describe("POST /api/webhook/agent-logs — Jarvis graph write (best-effort)", () => {
  const MOCK_JARVIS_CONFIG = { jarvisUrl: "https://jarvis.example.com", apiKey: "jarvis-key" };
  let testData: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.API_TOKEN = "test-token";
    // Default: Jarvis config present, addNode/addEdge succeed with ref_ids
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "mock-ref" });
    mockAddEdge.mockResolvedValue({ success: true });
    testData = await createTestSetup();
  });

  afterEach(async () => {
    await db.agentLog.deleteMany({ where: { workspaceId: testData.workspace.id } });
    await db.feature.deleteMany({ where: { workspaceId: testData.workspace.id } });
    await db.workspace.deleteMany({ where: { id: testData.workspace.id } });
    await db.user.deleteMany({ where: { id: testData.owner.id } });
  });

  test("returns 201 and writes AgentRole + AgentSession + HAS_SESSION edge when Jarvis config present", async () => {
    const { workspace, feature } = testData;

    const response = await POST(
      buildRequest({
        agent: "plan-agent-abc123",
        workspace_id: workspace.id,
        feature_id: feature.id,
        logs: [{ role: "assistant", content: "Hello" }],
      })
    );

    expect(response.status).toBe(201);

    // AgentRole upserted with normalised name
    expect(mockAddNode).toHaveBeenCalledTimes(2);
    expect(mockAddNode.mock.calls[0][1]).toMatchObject({
      node_type: "AgentRole",
      node_data: { name: "plan-agent" },
    });
    // AgentSession created
    expect(mockAddNode.mock.calls[1][1]).toMatchObject({
      node_type: "AgentSession",
      node_data: expect.objectContaining({
        agent_name: "plan-agent-abc123",
        log_url: "https://blob.example.com/agent-log.json",
        workspace_id: workspace.id,
      }),
    });
    // HAS_SESSION edge
    expect(mockAddEdge).toHaveBeenCalledOnce();
    expect(mockAddEdge.mock.calls[0][1]).toMatchObject({
      edge: { edge_type: "HAS_SESSION" },
      source: { ref_id: "mock-ref" },
      target: { ref_id: "mock-ref" },
    });
  });

  test("returns 201 and skips Jarvis writes when getJarvisConfigForWorkspace returns null", async () => {
    mockGetJarvisConfig.mockResolvedValue(null);
    const { workspace, feature } = testData;

    const response = await POST(
      buildRequest({
        agent: "plan-agent-abc",
        workspace_id: workspace.id,
        feature_id: feature.id,
        logs: [],
      })
    );

    expect(response.status).toBe(201);
    expect(mockAddNode).not.toHaveBeenCalled();
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  test("returns 201 even when addNode throws (Jarvis down scenario)", async () => {
    mockAddNode.mockRejectedValue(new Error("Jarvis unavailable"));
    const { workspace, feature } = testData;

    const response = await POST(
      buildRequest({
        agent: "coding-agent-xyz",
        workspace_id: workspace.id,
        feature_id: feature.id,
        logs: [],
      })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  test("does not call addEdge when AgentRole addNode returns no ref_id", async () => {
    // First addNode (AgentRole) returns no ref_id
    mockAddNode
      .mockResolvedValueOnce({ success: true, ref_id: undefined })
      .mockResolvedValueOnce({ success: true, ref_id: "session-ref" });

    const { workspace, feature } = testData;

    const response = await POST(
      buildRequest({
        agent: "plan-agent-abc",
        workspace_id: workspace.id,
        feature_id: feature.id,
        logs: [],
      })
    );

    expect(response.status).toBe(201);
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  test("passes correct agent_name, log_url, workspace_id, start_time to AgentSession node_data", async () => {
    const { workspace, feature } = testData;

    await POST(
      buildRequest({
        agent: "researcher-agent-001",
        workspace_id: workspace.id,
        feature_id: feature.id,
        logs: [],
      })
    );

    const sessionCall = mockAddNode.mock.calls[1][1];
    expect(sessionCall.node_data.agent_name).toBe("researcher-agent-001");
    expect(sessionCall.node_data.log_url).toBe("https://blob.example.com/agent-log.json");
    expect(sessionCall.node_data.workspace_id).toBe(workspace.id);
    expect(typeof sessionCall.node_data.start_time).toBe("number");
    expect(sessionCall.node_data.start_time as number).toBeGreaterThan(0);
  });

  test("defaults source to the agent role name when config.source is absent", async () => {
    const { workspace, feature } = testData;

    await POST(
      buildRequest({
        agent: "researcher-agent-001",
        workspace_id: workspace.id,
        feature_id: feature.id,
        logs: [],
      })
    );

    const sessionCall = mockAddNode.mock.calls[1][1];
    expect(sessionCall.node_data.source).toBe("researcher-agent");
  });

  test("prefers config.source over the derived role name when provided", async () => {
    const { workspace, feature } = testData;

    await POST(
      buildRequest({
        agent: "researcher-agent-001",
        workspace_id: workspace.id,
        feature_id: feature.id,
        logs: [],
        config: { source: "stakwork" },
      })
    );

    const sessionCall = mockAddNode.mock.calls[1][1];
    expect(sessionCall.node_data.source).toBe("stakwork");
  });

  test("attaches estimated_tokens, tool_call_count, message_count derived from the transcript", async () => {
    const { workspace, feature } = testData;

    await POST(
      buildRequest({
        agent: "coding-agent-001",
        workspace_id: workspace.id,
        feature_id: feature.id,
        messages: [
          { role: "user", content: "do the thing" },
          {
            role: "assistant",
            content: [{ type: "tool-call", toolCallId: "1", toolName: "bash", input: { command: "ls" } }],
          },
        ],
      })
    );

    const sessionCall = mockAddNode.mock.calls[1][1];
    expect(sessionCall.node_data.message_count).toBe(2);
    expect(sessionCall.node_data.tool_call_count).toBe(1);
    expect(typeof sessionCall.node_data.estimated_tokens).toBe("number");
    expect(sessionCall.node_data.estimated_tokens as number).toBeGreaterThan(0);
  });

  test("marks the AgentSession node as a complete session record via the file sentinel", async () => {
    const { workspace, feature } = testData;

    await POST(
      buildRequest({
        agent: "plan-agent-abc",
        workspace_id: workspace.id,
        feature_id: feature.id,
        logs: [],
      })
    );

    const sessionCall = mockAddNode.mock.calls[1][1];
    expect(sessionCall.node_data.file).toBe("session://generated");
  });

  test("omits model from node_data when not in request body", async () => {
    const { workspace, feature } = testData;

    await POST(
      buildRequest({
        agent: "plan-agent-abc",
        workspace_id: workspace.id,
        feature_id: feature.id,
        messages: [{ role: "assistant", content: "Hello" }],
        // no model field, no config.model
      })
    );

    const sessionCall = mockAddNode.mock.calls[1][1];
    expect(sessionCall.node_data).not.toHaveProperty("model");
  });

  test("includes model in node_data when provided as legacy body.model", async () => {
    const { workspace, feature } = testData;

    await POST(
      buildRequest({
        agent: "plan-agent-abc",
        workspace_id: workspace.id,
        feature_id: feature.id,
        messages: [{ role: "assistant", content: "Hello" }],
        model: "claude-3-5-sonnet",
      })
    );

    const sessionCall = mockAddNode.mock.calls[1][1];
    expect(sessionCall.node_data.model).toBe("claude-3-5-sonnet");
  });

  test("prefers config.model over legacy body.model for AgentSession node_data", async () => {
    const { workspace, feature } = testData;

    await POST(
      buildRequest({
        agent: "plan-agent-abc",
        workspace_id: workspace.id,
        feature_id: feature.id,
        messages: [{ role: "assistant", content: "Hello" }],
        model: "legacy-model",
        config: { model: "claude-sonnet-4-6", provider: "anthropic" },
      })
    );

    const sessionCall = mockAddNode.mock.calls[1][1];
    expect(sessionCall.node_data.model).toBe("claude-sonnet-4-6");
  });
});

// ── New payload shape + config persistence tests ──────────────────────────────

describe("POST /api/webhook/agent-logs — new payload shape & config persistence", () => {
  let testData: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.API_TOKEN = "test-token";
    mockGetJarvisConfig.mockResolvedValue(null); // skip Jarvis writes for these tests
    testData = await createTestSetup();
  });

  afterEach(async () => {
    await db.agentLog.deleteMany({ where: { workspaceId: testData.workspace.id } });
    await db.feature.deleteMany({ where: { workspaceId: testData.workspace.id } });
    await db.workspace.deleteMany({ where: { id: testData.workspace.id } });
    await db.user.deleteMany({ where: { id: testData.owner.id } });
  });

  test("POST with new { messages, config, sessionId } shape → 201, DB row has config and sessionId", async () => {
    const { workspace, feature } = testData;
    const config = {
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      source: "repo_agent",
      repos: [{ name: "stakwork/hive" }],
      temperature: 0,
    };

    const response = await POST(
      buildRequest({
        agent: "plan-agent-new",
        workspace_id: workspace.id,
        feature_id: feature.id,
        messages: [{ role: "user", content: "Hello" }],
        sessionId: "sess-abc-123",
        config,
      })
    );

    expect(response.status).toBe(201);

    const agentLog = await db.agentLog.findFirst({
      where: { agent: "plan-agent-new", workspaceId: workspace.id },
      select: { config: true, sessionId: true },
    });

    expect(agentLog).not.toBeNull();
    expect(agentLog?.sessionId).toBe("sess-abc-123");
    expect(agentLog?.config).toMatchObject({
      model: "claude-sonnet-4-6",
      provider: "anthropic",
    });

    // Blob must only carry the transcript — no config key
    const blobBody = JSON.parse((put as Mock).mock.calls[0][1] as string);
    expect(blobBody).not.toHaveProperty("config");
    expect(blobBody).toHaveProperty("messages");
    expect(blobBody).toHaveProperty("sessionId", "sess-abc-123");
  });

  test("POST with legacy { logs } shape → 201, config is null on DB row", async () => {
    const { workspace, feature } = testData;

    const response = await POST(
      buildRequest({
        agent: "plan-agent-legacy",
        workspace_id: workspace.id,
        feature_id: feature.id,
        logs: [{ role: "assistant", content: "Hello" }],
        // no config, no sessionId
      })
    );

    expect(response.status).toBe(201);

    const agentLog = await db.agentLog.findFirst({
      where: { agent: "plan-agent-legacy", workspaceId: workspace.id },
      select: { config: true, sessionId: true },
    });

    expect(agentLog).not.toBeNull();
    expect(agentLog?.config).toBeNull();
    expect(agentLog?.sessionId).toBeNull();
  });

  test("POST missing both messages and logs → 400", async () => {
    const { workspace, feature } = testData;

    const response = await POST(
      buildRequest({
        agent: "plan-agent-bad",
        workspace_id: workspace.id,
        feature_id: feature.id,
        // no messages, no logs
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/messages/i);
  });

  test("POST with config.model present → Jarvis AgentSession node_data contains correct model", async () => {
    const { workspace, feature } = testData;
    const MOCK_JARVIS_CONFIG = { jarvisUrl: "https://jarvis.example.com", apiKey: "jarvis-key" };
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "mock-ref" });
    mockAddEdge.mockResolvedValue({ success: true });

    await POST(
      buildRequest({
        agent: "plan-agent-config-model",
        workspace_id: workspace.id,
        feature_id: feature.id,
        messages: [{ role: "user", content: "Hi" }],
        config: { model: "claude-opus-4", provider: "anthropic" },
      })
    );

    const sessionCall = mockAddNode.mock.calls[1][1];
    expect(sessionCall.node_data.model).toBe("claude-opus-4");
  });
});
