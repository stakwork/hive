/**
 * Integration tests for the Graph Agent Chat routes:
 *   - POST /api/workspaces/[slug]/graph/agent (dispatch)
 *   - GET  /api/workspaces/[slug]/graph/agent/runs (thread list / thread runs)
 *
 * Covers: admin gate, thread creation, follow-up sessionId reuse,
 * proposalsEnabled immutability, dispatch-failure → FAILED, and
 * workspace/agentKind scoping of the history reads.
 *
 * The swarm is mocked at the `dispatchRepoAgent` seam (the route's only
 * outbound call) and swarm credential resolution at `getSwarmConfig`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace, createTestMembership } from "@/__tests__/support/fixtures";
import { createAuthenticatedSession, mockSessionAs } from "@/__tests__/support/helpers/auth";

vi.mock("next-auth/next", async () => {
  const actual = await vi.importActual("next-auth/next");
  return { ...actual, getServerSession: vi.fn() };
});

vi.mock("@/lib/ai/askTools", () => ({
  dispatchRepoAgent: vi.fn(),
}));

vi.mock("@/app/api/learnings/utils", () => ({
  getSwarmConfig: vi.fn(),
}));

// Import routes after mocks
import { POST } from "@/app/api/workspaces/[slug]/graph/agent/route";
import { GET } from "@/app/api/workspaces/[slug]/graph/agent/runs/route";
import { dispatchRepoAgent } from "@/lib/ai/askTools";
import { getSwarmConfig } from "@/app/api/learnings/utils";

const mockDispatch = vi.mocked(dispatchRepoAgent);
const mockGetSwarmConfig = vi.mocked(getSwarmConfig);

function postRequest(slug: string, body: object): [NextRequest, { params: Promise<{ slug: string }> }] {
  return [
    new NextRequest(`http://localhost:3000/api/workspaces/${slug}/graph/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  ];
}

function getRequest(slug: string, sessionId?: string): [NextRequest, { params: Promise<{ slug: string }> }] {
  const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  return [
    new NextRequest(`http://localhost:3000/api/workspaces/${slug}/graph/agent/runs${qs}`),
    { params: Promise.resolve({ slug }) },
  ];
}

describe("Graph Agent Chat routes", () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDispatch.mockResolvedValue("mock-request-id-1");
    mockGetSwarmConfig.mockResolvedValue({
      baseSwarmUrl: "https://swarm.test:3355",
      decryptedSwarmApiKey: "decrypted-key",
    } as never);

    owner = await createTestUser({ name: "Graph Owner" });
    workspace = await createTestWorkspace({ ownerId: owner.id });
    mockSessionAs(createAuthenticatedSession(owner));
  });

  // ── Auth gates ─────────────────────────────────────────────────────────────

  it("POST returns 401 when unauthenticated", async () => {
    mockSessionAs(null);
    const res = await POST(...postRequest(workspace.slug, { prompt: "hi" }));
    expect(res.status).toBe(401);
  });

  it("POST returns 403 for a non-admin member (DEVELOPER)", async () => {
    const dev = await createTestUser({ name: "Dev" });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: dev.id,
      role: "DEVELOPER",
    });
    mockSessionAs(createAuthenticatedSession(dev));

    const res = await POST(...postRequest(workspace.slug, { prompt: "hi" }));
    expect(res.status).toBe(403);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("POST returns 404 for a non-member", async () => {
    const outsider = await createTestUser({ name: "Outsider" });
    mockSessionAs(createAuthenticatedSession(outsider));

    const res = await POST(...postRequest(workspace.slug, { prompt: "hi" }));
    expect(res.status).toBe(404);
  });

  it("GET returns 401 when unauthenticated and 403 for non-admin", async () => {
    mockSessionAs(null);
    const res1 = await GET(...getRequest(workspace.slug));
    expect(res1.status).toBe(401);

    const viewer = await createTestUser({ name: "Viewer" });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: viewer.id,
      role: "VIEWER",
    });
    mockSessionAs(createAuthenticatedSession(viewer));
    const res2 = await GET(...getRequest(workspace.slug));
    expect(res2.status).toBe(403);
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it("POST returns 400 when prompt is missing or blank", async () => {
    const res1 = await POST(...postRequest(workspace.slug, {}));
    expect(res1.status).toBe(400);
    const res2 = await POST(...postRequest(workspace.slug, { prompt: "   " }));
    expect(res2.status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ── Thread creation ────────────────────────────────────────────────────────

  it("creates a new thread: mints a sessionId, snapshots proposalsEnabled, dispatches with graph mode + tools", async () => {
    const res = await POST(
      ...postRequest(workspace.slug, {
        prompt: "Map the auth module\nplease include edges",
        proposalsEnabled: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runId).toBeTruthy();
    expect(body.sessionId).toBeTruthy();

    const row = await db.agentRun.findUnique({ where: { id: body.runId } });
    expect(row).toMatchObject({
      agentKind: "graph_chat",
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      sessionId: body.sessionId,
      prompt: "Map the auth module\nplease include edges",
      proposalsEnabled: true,
      status: "PENDING",
      requestId: "mock-request-id-1",
      title: "Map the auth module", // first line of the prompt
      conversationId: null,
    });
    // Token stored only as a hash
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const [swarmUrl, apiKey, params] = mockDispatch.mock.calls[0];
    expect(swarmUrl).toBe("https://swarm.test:3355");
    expect(apiKey).toBe("decrypted-key");
    expect(params).toMatchObject({
      prompt: "Map the auth module\nplease include edges",
      mode: "graph",
      sessionId: body.sessionId,
      toolsConfig: { propose_concept_change: true, list_concept_proposals: true },
    });
    expect(params.webhookUrl).toContain(`/api/agent-runs/webhook?id=${body.runId}&token=`);
    // The raw token in the webhookUrl hashes to the stored tokenHash's format
    // but is never echoed back to the client.
    expect(JSON.stringify(body)).not.toContain("token");
  });

  it("omits toolsConfig entirely when proposals are off", async () => {
    const res = await POST(...postRequest(workspace.slug, { prompt: "hello graph" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    const row = await db.agentRun.findUnique({ where: { id: body.runId } });
    expect(row?.proposalsEnabled).toBe(false);

    const [, , params] = mockDispatch.mock.calls[0];
    expect(params).not.toHaveProperty("toolsConfig");
  });

  // ── Follow-ups & immutability ──────────────────────────────────────────────

  it("reuses the sessionId on follow-up and re-snapshots the thread's proposalsEnabled", async () => {
    const first = await POST(...postRequest(workspace.slug, { prompt: "start", proposalsEnabled: true }));
    const { runId: firstRunId, sessionId } = await first.json();

    // Follow-up does not send proposalsEnabled at all — the server derives it
    const res = await POST(...postRequest(workspace.slug, { prompt: "follow up", sessionId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe(sessionId);
    expect(body.runId).not.toBe(firstRunId); // distinct row per message

    const rows = await db.agentRun.findMany({
      where: { sessionId, agentKind: "graph_chat" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[1].prompt).toBe("follow up");
    expect(rows[1].proposalsEnabled).toBe(true); // re-snapshotted from the thread

    // Both dispatches used the same swarm session
    expect(mockDispatch.mock.calls[1][2]).toMatchObject({ sessionId, mode: "graph" });
  });

  it("rejects an attempt to flip proposalsEnabled mid-thread (409, no row created)", async () => {
    const first = await POST(...postRequest(workspace.slug, { prompt: "start", proposalsEnabled: true }));
    const { sessionId } = await first.json();

    const res = await POST(
      ...postRequest(workspace.slug, {
        prompt: "sneaky flip",
        sessionId,
        proposalsEnabled: false,
      }),
    );
    expect(res.status).toBe(409);

    const rows = await db.agentRun.findMany({ where: { sessionId } });
    expect(rows).toHaveLength(1);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for a follow-up on an unknown sessionId", async () => {
    const res = await POST(...postRequest(workspace.slug, { prompt: "hi", sessionId: "no-such-session" }));
    expect(res.status).toBe(404);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ── Dispatch failure ───────────────────────────────────────────────────────

  it("marks the run FAILED and returns 502 when dispatch throws", async () => {
    mockDispatch.mockRejectedValue(new Error("swarm unreachable"));

    const res = await POST(...postRequest(workspace.slug, { prompt: "doomed" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.runId).toBeTruthy();

    const row = await db.agentRun.findUnique({ where: { id: body.runId } });
    expect(row?.status).toBe("FAILED");
    expect(row?.error).toBe("swarm unreachable");
  });

  it("does not create a run row when the swarm is not configured", async () => {
    mockGetSwarmConfig.mockResolvedValue({
      error: "Swarm not found for this workspace",
      status: 404,
    } as never);

    const res = await POST(...postRequest(workspace.slug, { prompt: "hi" }));
    expect(res.status).toBe(404);
    expect(await db.agentRun.count({ where: { workspaceId: workspace.id } })).toBe(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ── Runs GET ───────────────────────────────────────────────────────────────

  describe("GET /runs", () => {
    async function seedRun(overrides: Record<string, unknown> = {}) {
      return db.agentRun.create({
        data: {
          tokenHash: "0".repeat(64),
          agentKind: "graph_chat",
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
          orgId: null,
          userId: owner.id,
          sessionId: "session-1",
          title: "Thread one",
          prompt: "first prompt",
          status: "DELIVERED_WEBHOOK",
          result: "the answer",
          ...overrides,
        },
      });
    }

    it("returns runs for a session oldest-first with display fields", async () => {
      await seedRun({ createdAt: new Date("2026-08-01T10:00:00Z") });
      await seedRun({
        prompt: "second prompt",
        status: "PENDING",
        result: null,
        createdAt: new Date("2026-08-01T11:00:00Z"),
      });

      const res = await GET(...getRequest(workspace.slug, "session-1"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.runs).toHaveLength(2);
      expect(body.runs[0]).toMatchObject({
        prompt: "first prompt",
        result: "the answer",
        status: "DELIVERED_WEBHOOK",
      });
      expect(body.runs[1]).toMatchObject({ prompt: "second prompt", status: "PENDING" });
      // No token material in the payload
      expect(JSON.stringify(body)).not.toContain("tokenHash");
    });

    it("returns the thread list grouped by session, newest-first, title from the first run", async () => {
      await seedRun({
        sessionId: "session-1",
        title: "Thread one",
        createdAt: new Date("2026-08-01T10:00:00Z"),
        updatedAt: new Date("2026-08-01T10:05:00Z"),
      });
      await seedRun({
        sessionId: "session-1",
        title: "Follow-up title (ignored)",
        status: "PENDING",
        proposalsEnabled: true,
        createdAt: new Date("2026-08-02T10:00:00Z"),
        updatedAt: new Date("2026-08-02T10:00:00Z"),
      });
      await seedRun({
        sessionId: "session-2",
        title: "Thread two",
        createdAt: new Date("2026-08-01T12:00:00Z"),
        updatedAt: new Date("2026-08-01T12:30:00Z"),
      });

      const res = await GET(...getRequest(workspace.slug));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.threads).toHaveLength(2);
      // Newest activity first
      expect(body.threads[0]).toMatchObject({
        sessionId: "session-1",
        title: "Thread one", // first run's title wins
        lastStatus: "PENDING", // latest run's status
        proposalsEnabled: true, // latest run's snapshot
      });
      expect(body.threads[1]).toMatchObject({ sessionId: "session-2", title: "Thread two" });
    });

    it("scopes reads to the workspace and agentKind graph_chat", async () => {
      // Foreign workspace graph run
      const otherOwner = await createTestUser({ name: "Other" });
      const otherWs = await createTestWorkspace({ ownerId: otherOwner.id });
      await seedRun({ workspaceId: otherWs.id, workspaceSlug: otherWs.slug, sessionId: "foreign" });
      // Canvas run in THIS workspace's org scope (different kind)
      await db.agentRun.create({
        data: {
          tokenHash: "1".repeat(64),
          agentKind: "workflow_explorer",
          orgId: "some-org",
          userId: owner.id,
          title: "Canvas run",
        },
      });

      const res = await GET(...getRequest(workspace.slug));
      const body = await res.json();
      expect(body.threads).toHaveLength(0);
    });
  });
});
