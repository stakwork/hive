/**
 * Integration tests for GET /api/workspaces/[slug]/workflows/[workflowId]/runs
 *
 * Covers:
 * - 401 for unauthenticated requests
 * - 404 IDOR guard (non-member authenticated user, upstream NOT called)
 * - 404 for non-existent workspace slug
 * - 400 for non-numeric workflowId
 * - Dev mode → delegates to mock endpoint → returns runs array
 * - Upstream non-200 → returns { runs: [] }, no 5xx, console.error called
 * - Network error → returns { runs: [] }, no 5xx, console.error called
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

// Import route handler after mocks are set up
import { GET } from "@/app/api/workspaces/[slug]/workflows/[workflowId]/runs/route";
import { NextRequest } from "next/server";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];

async function createTestFixtures() {
  const user = await createTestUser({
    id: generateUniqueId("runs-user"),
    email: `runs-${Date.now()}@example.com`,
  });
  createdUserIds.push(user.id);

  const workspace = await createTestWorkspace({
    id: generateUniqueId("runs-ws"),
    name: "Runs Test Workspace",
    slug: `runs-ws-${Date.now()}`,
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

function makeRequest(slug: string, workflowId: string): NextRequest {
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/workflows/[workflowId]/runs", () => {
  describe("Authentication", () => {
    test("returns 401 when session is null (unauthenticated)", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = makeRequest("any-workspace", "123");
      const response = await GET(request, {
        params: Promise.resolve({ slug: "any-workspace", workflowId: "123" }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("IDOR guard", () => {
    test("returns 404 when authenticated user is not a workspace member and does NOT call upstream", async () => {
      const { workspace } = await createTestFixtures();

      const nonMember = await createTestUser({
        id: generateUniqueId("non-member"),
        email: `nonmember-runs-${Date.now()}@example.com`,
      });
      createdUserIds.push(nonMember.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      // Confirm Stakwork is NOT called (guard fires first)
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

      const request = makeRequest(workspace.slug, "123");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Workspace not found or access denied");

      // Stakwork fetch must NOT have been called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 404 when workspace slug does not exist", async () => {
      const { user } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = makeRequest("does-not-exist", "123");
      const response = await GET(request, {
        params: Promise.resolve({ slug: "does-not-exist", workflowId: "123" }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("Input validation", () => {
    test("returns 400 for non-numeric workflowId", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = makeRequest(workspace.slug, "not-a-number");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "not-a-number" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Invalid workflow ID");
    });
  });

  describe("Dev mode (mock delegation)", () => {
    test("returns runs array from mock endpoint in dev mode", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(true);

      // The route fetches the mock endpoint via the request origin
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            runs: [
              {
                id: 1001,
                name: "Run #1001",
                status: "finished",
                started_at: "2024-03-18T14:00:00.000Z",
                finished_at: "2024-03-18T14:32:10.000Z",
              },
            ],
          },
        }),
      });

      const request = makeRequest(workspace.slug, "42");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.runs).toHaveLength(1);
      expect(data.data.runs[0].id).toBe(1001);
    });
  });

  describe("Upstream error handling", () => {
    test("returns empty runs (not a 5xx) when upstream returns non-200, and logs error", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "err",
      });

      const request = makeRequest(workspace.slug, "123");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.runs).toEqual([]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Workflow Runs] upstream error",
        expect.objectContaining({
          status: 503,
          workflowId: 123,
          env: expect.any(String),
        }),
      );

      consoleErrorSpy.mockRestore();
    });

    test("returns empty runs when upstream throws a network error, and logs error", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockRejectedValue(new Error("Timeout"));

      const request = makeRequest(workspace.slug, "123");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.runs).toEqual([]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Workflow Runs] upstream fetch failed",
        expect.objectContaining({
          error: "Timeout",
          workflowId: 123,
        }),
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
