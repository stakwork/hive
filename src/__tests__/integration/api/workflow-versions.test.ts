/**
 * Integration tests for workflow versions API endpoint
 * Tests authentication, authorization, and data fetching from graph API
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/workflows/[workflowId]/versions/route";
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
import { createTestSwarm } from "@/__tests__/support/factories/swarm.factory";

// Mock fetch for graph API calls
const mockFetch = vi.fn();

describe("GET /api/workspaces/[slug]/workflows/[workflowId]/versions", () => {
  
  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdSwarmIds: string[] = [];

  // Helper to create test fixtures
  async function createTestFixtures() {
    const user = await createTestUser({
      id: generateUniqueId(),
      email: `test-${Date.now()}@example.com`,
    });
    createdUserIds.push(user.id);

    const workspace = await createTestWorkspace({
      id: generateUniqueId(),
      name: "Test Workspace",
      slug: `test-workspace-${Date.now()}`,
      ownerId: user.id,
    });
    createdWorkspaceIds.push(workspace.id);

    // Create workspace membership
    await db.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: "OWNER",
      },
    });

    const swarm = await createTestSwarm({
      id: generateUniqueId(),
      workspaceId: workspace.id,
      swarmUrl: "https://knowledge-graph.stakwork.com",
      swarmApiKey: "test-graph-api-key",
    });
    createdSwarmIds.push(swarm.id);

    return { user, workspace, swarm };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch;
  });

  afterEach(async () => {
    // Cleanup in reverse order of creation
    if (createdSwarmIds.length > 0) {
      await db.swarm.deleteMany({
        where: { id: { in: createdSwarmIds } },
      });
      createdSwarmIds.length = 0;
    }

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
      await db.session.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await db.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }
  });

  describe("Authentication", () => {
    test("returns 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost/api/workspaces/test-workspace/workflows/123/versions",
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace", workflowId: "123" }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });

    test("returns 401 when session is null", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createGetRequest(
        "http://localhost/api/workspaces/test-workspace/workflows/123/versions",
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace", workflowId: "123" }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Authorization", () => {
    test("returns 404 when workspace does not exist", async () => {
      const { user } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost/api/workspaces/non-existent-workspace/workflows/123/versions",
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "non-existent-workspace", workflowId: "123" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Workspace not found");
    });

    test("returns 403 when user is not a workspace member", async () => {
      const { workspace } = await createTestFixtures();
      
      // Create a different user who is not a member
      const nonMember = await createTestUser({
        id: generateUniqueId(),
        email: `nonmember-${Date.now()}@example.com`,
      });
      createdUserIds.push(nonMember.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createGetRequest(
        `http://localhost/api/workspaces/${workspace.slug}/workflows/123/versions`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Access denied");
    });
  });

  describe("Input Validation", () => {
    test("returns 400 when workflowId is not a number", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        `http://localhost/api/workspaces/${workspace.slug}/workflows/invalid/versions`,
      );

      const response = await GET(request, {
        params: { slug: workspace.slug, workflowId: "invalid" },
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Invalid workflow ID");
    });
  });

  describe("Swarm Configuration", () => {
    test("returns 404 when workspace has no swarm configured", async () => {
      const user = await createTestUser({
        id: generateUniqueId(),
        email: `test-${Date.now()}@example.com`,
      });
      createdUserIds.push(user.id);

      const workspace = await createTestWorkspace({
        id: generateUniqueId(),
        name: "Test Workspace",
        slug: `test-workspace-${Date.now()}`,
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        `http://localhost/api/workspaces/${workspace.slug}/workflows/123/versions`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Swarm configuration not found for this workspace");
    });
  });

  describe("Successful Requests", () => {
    test("returns workflow versions sorted by date descending", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockVersions = [
        {
          ref_id: "version-3",
          node_type: "Workflow_version",
          date_added_to_graph: "2024-01-03T00:00:00Z",
          properties: {
            workflow_version_id: "wv-3",
            workflow_id: 123,
            workflow_json: JSON.stringify({ nodes: [] }),
            workflow_name: "Test Workflow",
            date_added_to_graph: "2024-01-03T00:00:00Z",
            published_at: null,
          },
        },
        {
          ref_id: "version-2",
          node_type: "Workflow_version",
          date_added_to_graph: "2024-01-02T00:00:00Z",
          properties: {
            workflow_version_id: "wv-2",
            workflow_id: 123,
            workflow_json: JSON.stringify({ nodes: [] }),
            workflow_name: "Test Workflow",
            date_added_to_graph: "2024-01-02T00:00:00Z",
            published_at: "2024-01-02T12:00:00Z",
          },
        },
        {
          ref_id: "version-1",
          node_type: "Workflow_version",
          date_added_to_graph: "2024-01-01T00:00:00Z",
          properties: {
            workflow_version_id: "wv-1",
            workflow_id: 123,
            workflow_json: JSON.stringify({ nodes: [] }),
            workflow_name: "Test Workflow",
            date_added_to_graph: "2024-01-01T00:00:00Z",
            published_at: null,
          },
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockVersions,
      });

      const request = createGetRequest(
        `http://localhost/api/workspaces/${workspace.slug}/workflows/123/versions`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.versions).toHaveLength(3);
      
      // Verify sorting (newest first)
      expect(data.data.versions[0].workflow_version_id).toBe("wv-3");
      expect(data.data.versions[1].workflow_version_id).toBe("wv-2");
      expect(data.data.versions[2].workflow_version_id).toBe("wv-1");

      // Verify graph API was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/graph/search/attributes"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-api-token": "test-graph-api-key",
          }),
          body: expect.stringContaining('"node_type":["Workflow_version"]'),
        }),
      );
    });

    test("returns empty array when no versions found", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      const request = createGetRequest(
        `http://localhost/api/workspaces/${workspace.slug}/workflows/999/versions`,
      );

      const response = await GET(request, {
        params: { slug: workspace.slug, workflowId: "999" },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.versions).toEqual([]);
    });

    test("limits results to 10 versions when more exist", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create 15 mock versions
      const mockVersions = Array.from({ length: 15 }, (_, i) => ({
        ref_id: `version-${i + 1}`,
        node_type: "Workflow_version",
        date_added_to_graph: `2024-01-${String(15 - i).padStart(2, "0")}T00:00:00Z`,
        properties: {
          workflow_version_id: `wv-${i + 1}`,
          workflow_id: 123,
          workflow_json: JSON.stringify({ nodes: [] }),
          workflow_name: "Test Workflow",
          date_added_to_graph: `2024-01-${String(15 - i).padStart(2, "0")}T00:00:00Z`,
          published_at: i === 0 ? "2024-01-15T12:00:00Z" : null,
        },
      }));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockVersions,
      });

      const request = createGetRequest(
        `http://localhost/api/workspaces/${workspace.slug}/workflows/123/versions`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.versions).toHaveLength(10);
    });
  });

  describe("Error Handling", () => {
    test("returns 500 when graph API request fails", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const request = createGetRequest(
        `http://localhost/api/workspaces/${workspace.slug}/workflows/123/versions`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain("Failed to fetch workflow versions");
    });

    test("returns 500 when graph API throws network error", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockRejectedValue(new Error("Network error"));

      const request = createGetRequest(
        `http://localhost/api/workspaces/${workspace.slug}/workflows/123/versions`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "123" }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain("Failed to fetch workflow versions");
    });
  });
});
