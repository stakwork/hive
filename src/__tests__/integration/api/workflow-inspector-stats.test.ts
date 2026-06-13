/**
 * Integration tests for:
 *   GET /api/workspaces/[slug]/workflows/[workflowId]/stats
 *   GET /api/workspaces/[slug]/workflows/[workflowId]/runs
 *
 * Covers:
 * - 401 for unauthenticated requests
 * - 404 IDOR guard (non-member authenticated user)
 * - 400 for non-numeric workflowId
 * - Dev mode → delegates to mock endpoint → returns available: true
 * - Upstream non-200 → returns { available: false } / { runs: [] }, no 5xx
 * - Stakwork data envelope unwrapping (statsData.data.*, runsData.data[])
 * - workflow_state mapped to status in runs response
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createGetRequest,
  getMockedSession,
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockIsDevelopmentMode = vi.fn().mockReturnValue(false);

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: () => mockIsDevelopmentMode(),
}));

const mockFetch = vi.fn();

// Import route handlers after mocks are set up
import { GET as statsGET } from "@/app/api/workspaces/[slug]/workflows/[workflowId]/stats/route";
import { GET as runsGET } from "@/app/api/workspaces/[slug]/workflows/[workflowId]/runs/route";
import { NextRequest } from "next/server";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];

async function createTestFixtures() {
  const user = await createTestUser({
    id: generateUniqueId("stats-user"),
    email: `stats-${Date.now()}@example.com`,
  });
  createdUserIds.push(user.id);

  const workspace = await createTestWorkspace({
    id: generateUniqueId("stats-ws"),
    name: "Stats Test Workspace",
    slug: `stats-ws-${Date.now()}`,
    ownerId: user.id,
  });
  createdWorkspaceIds.push(workspace.id);

  await db.workspaceMember.create({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      role: "OWNER",
    },
  });

  return { user, workspace };
}

function makeStatsRequest(slug: string, workflowId: string): NextRequest {
  return createGetRequest(
    `http://localhost/api/workspaces/${slug}/workflows/${workflowId}/stats`,
  );
}

function makeRunsRequest(slug: string, workflowId: string): NextRequest {
  return createGetRequest(
    `http://localhost/api/workspaces/${slug}/workflows/${workflowId}/runs`,
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDevelopmentMode.mockReturnValue(false);
  global.fetch = mockFetch;
});

afterEach(async () => {
  if (createdWorkspaceIds.length > 0) {
    await db.workspaceMember.deleteMany({
      where: { workspaceId: { in: createdWorkspaceIds } },
    });
    await db.workspace.deleteMany({
      where: { id: { in: createdWorkspaceIds } },
    });
    createdWorkspaceIds.length = 0;
  }

  if (createdUserIds.length > 0) {
    await db.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

// ── Stats Tests ───────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/workflows/[workflowId]/stats", () => {
  describe("Authentication", () => {
    test("returns 401 when session is null (unauthenticated)", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = makeStatsRequest("any-workspace", "123");
      const response = await statsGET(request, {
        params: Promise.resolve({ slug: "any-workspace", workflowId: "123" }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("IDOR guard", () => {
    test("returns 404 when authenticated user is not a workspace member", async () => {
      const { workspace } = await createTestFixtures();

      const nonMember = await createTestUser({
        id: generateUniqueId("non-member"),
        email: `nonmember-${Date.now()}@example.com`,
      });
      createdUserIds.push(nonMember.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

      const request = makeStatsRequest(workspace.slug, "123");
      const response = await statsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Workspace not found or access denied");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 404 when workspace slug does not exist", async () => {
      const { user } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = makeStatsRequest("does-not-exist", "123");
      const response = await statsGET(request, {
        params: Promise.resolve({ slug: "does-not-exist", workflowId: "123" }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("Input validation", () => {
    test("returns 400 for non-numeric workflowId", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = makeStatsRequest(workspace.slug, "not-a-number");
      const response = await statsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "not-a-number" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Invalid workflow ID");
    });
  });

  describe("Dev mode (mock delegation)", () => {
    test("returns available: true with mock fields in dev mode", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(true);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { available: true, last_run_at: "2024-03-18T14:32:10.000Z", total_runs: 42, error_rate: 0.07 },
        }),
      });

      const request = makeStatsRequest(workspace.slug, "42");
      const response = await statsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.available).toBe(true);
      expect(data.data.total_runs).toBeDefined();
    });
  });

  describe("Stakwork data envelope unwrapping", () => {
    test("correctly unwraps statsData.data fields from Stakwork response", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      // Stakwork returns { success: true, data: { ... } }
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            workflow_id: 99,
            total_runs: 15,
            last_run_at: "2025-01-10T08:00:00.000Z",
            active_runs: 2,
            error_rate: 0.13,
          },
        }),
      });

      const request = makeStatsRequest(workspace.slug, "99");
      const response = await statsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "99" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.available).toBe(true);
      expect(body.data.total_runs).toBe(15);
      expect(body.data.last_run_at).toBe("2025-01-10T08:00:00.000Z");
      expect(body.data.active_runs).toBe(2);
      expect(body.data.error_rate).toBe(0.13);
    });

    test("falls back to defaults when data envelope fields are missing", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      const request = makeStatsRequest(workspace.slug, "99");
      const response = await statsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "99" }),
      });

      const body = await response.json();
      expect(body.data.available).toBe(true);
      expect(body.data.total_runs).toBe(0);
      expect(body.data.last_run_at).toBeNull();
      expect(body.data.active_runs).toBe(0);
      expect(body.data.error_rate).toBe(0);
    });
  });

  describe("Upstream error handling", () => {
    test("returns available: false (not a 5xx) when upstream returns non-200", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "upstream error body",
      });

      const request = makeStatsRequest(workspace.slug, "123");
      const response = await statsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.available).toBe(false);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Workflow Stats] upstream error",
        expect.objectContaining({
          status: 503,
          workflowId: 123,
          env: expect.any(String),
        }),
      );

      consoleErrorSpy.mockRestore();
    });

    test("returns available: false when upstream throws a network error", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockRejectedValue(new Error("Network timeout"));

      const request = makeStatsRequest(workspace.slug, "123");
      const response = await statsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.available).toBe(false);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Workflow Stats] upstream fetch failed",
        expect.objectContaining({
          error: "Network timeout",
          workflowId: 123,
        }),
      );

      consoleErrorSpy.mockRestore();
    });
  });
});

// ── Runs Tests ────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/workflows/[workflowId]/runs", () => {
  describe("Authentication", () => {
    test("returns 401 when unauthenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = makeRunsRequest("any-workspace", "123");
      const response = await runsGET(request, {
        params: Promise.resolve({ slug: "any-workspace", workflowId: "123" }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("IDOR guard", () => {
    test("returns 404 for non-member user", async () => {
      const { workspace } = await createTestFixtures();

      const nonMember = await createTestUser({
        id: generateUniqueId("runs-non-member"),
        email: `runs-nonmember-${Date.now()}@example.com`,
      });
      createdUserIds.push(nonMember.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = makeRunsRequest(workspace.slug, "123");
      const response = await runsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(404);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Input validation", () => {
    test("returns 400 for non-numeric workflowId", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = makeRunsRequest(workspace.slug, "bad-id");
      const response = await runsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "bad-id" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid workflow ID");
    });
  });

  describe("Stakwork data envelope unwrapping", () => {
    test("correctly maps runsData.data array with workflow_state → status", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      // Stakwork returns { success: true, data: [ { id, name, workflow_state, ... } ] }
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: 101,
              name: "hive-task-abc",
              workflow_state: "completed",
              started_at: "2025-06-01T10:00:00.000Z",
              finished_at: "2025-06-01T10:05:00.000Z",
              duration_seconds: 300,
            },
            {
              id: 102,
              name: "hive-task-def",
              workflow_state: "failed",
              started_at: "2025-06-02T09:00:00.000Z",
              finished_at: null,
              duration_seconds: null,
            },
          ],
        }),
      });

      const request = makeRunsRequest(workspace.slug, "99");
      const response = await runsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "99" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.runs).toHaveLength(2);

      const [run1, run2] = body.data.runs;
      expect(run1.id).toBe(101);
      expect(run1.name).toBe("hive-task-abc");
      expect(run1.status).toBe("completed");
      expect(run1.started_at).toBe("2025-06-01T10:00:00.000Z");
      expect(run1.finished_at).toBe("2025-06-01T10:05:00.000Z");

      expect(run2.status).toBe("failed");
      expect(run2.finished_at).toBeNull();
    });

    test("returns empty runs array when data envelope is empty", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      const request = makeRunsRequest(workspace.slug, "99");
      const response = await runsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "99" }),
      });

      const body = await response.json();
      expect(body.data.runs).toEqual([]);
    });
  });

  describe("Upstream error handling", () => {
    test("returns { runs: [] } when upstream returns non-200", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: async () => "error",
      });

      const request = makeRunsRequest(workspace.slug, "123");
      const response = await runsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.runs).toEqual([]);

      consoleErrorSpy.mockRestore();
    });

    test("returns { runs: [] } when upstream throws", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const request = makeRunsRequest(workspace.slug, "123");
      const response = await runsGET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.runs).toEqual([]);

      consoleErrorSpy.mockRestore();
    });
  });
});
