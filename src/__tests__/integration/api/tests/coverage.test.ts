import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/tests/coverage/route";
import { db } from "@/lib/db";
import {
  createGetRequest,
  expectSuccess,
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { resetDatabase } from "@/__tests__/support/utilities/database";

// Mock swarmApiRequest at module level
vi.mock("@/services/swarm/api/swarm", () => ({
  swarmApiRequest: vi.fn(),
}));

import { swarmApiRequest } from "@/services/swarm/api/swarm";

describe("GET /api/tests/coverage Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();
  });

  async function createTestWorkspaceWithSwarm() {
    const user = await createTestUser({ name: "Test User" });
    const workspace = await createTestWorkspace({
      name: "Test Workspace",
      ownerId: user.id,
    });

    // Create swarm with encrypted API key in proper format
    const swarm = await db.swarm.create({
      data: {
        name: `swarm-${workspace.id}`,
        swarmId: "test-swarm-id",
        swarmUrl: "https://test.sphinx.chat/api",
        workspaceId: workspace.id,
        status: "ACTIVE",
        swarmApiKey: JSON.stringify({
          data: "encrypted-test-key",
          iv: "test-iv",
          tag: "test-tag",
          version: "1",
          encryptedAt: new Date().toISOString(),
        }),
      },
    });

    return { user, workspace, swarm };
  }

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      const { workspace } = await createTestWorkspaceWithSwarm();
      
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost/api/tests/coverage",
        { workspaceId: workspace.id }
      );

      const response = await GET(request);
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });
  });

  describe("E2E Test Coverage Data", () => {
    test("should return E2E data naturally from stakgraph without artificial manipulation", async () => {
      const { user, workspace } = await createTestWorkspaceWithSwarm();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock stakgraph response with natural E2E data (not 100%)
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          unit: {
            covered: 150,
            total: 205,
            percentage: 73.2,
            coveredLines: 1200,
            totalLines: 1500,
            linePercentage: 80.0,
          },
          integration: {
            covered: 44,
            total: 67,
            percentage: 65.7,
            coveredLines: 800,
            totalLines: 1000,
            linePercentage: 80.0,
          },
          e2e: {
            covered: 12,
            total: 15,
            percentage: 80.0,
            coveredLines: 0,
            totalLines: 0,
            linePercentage: 0,
          },
          mocks: {
            covered: 12,
            total: 14,
            percentage: 85.7,
            coveredLines: 0,
            totalLines: 0,
            linePercentage: 0,
          },
        },
        status: 200,
      });

      const request = createGetRequest(
        "http://localhost/api/tests/coverage",
        { workspaceId: workspace.id }
      );

      const response = await GET(request);
      const result = await expectSuccess(response, 200);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      // Verify E2E data is NOT artificially set to 100%
      expect(result.data.e2e).toBeDefined();
      expect(result.data.e2e.covered).toBe(12);
      expect(result.data.e2e.total).toBe(15);
      expect(result.data.e2e.percentage).toBe(80.0);
      
      // E2E should not have percentage artificially set to 100
      expect(result.data.e2e.percentage).not.toBe(100);
      
      // Verify other test types remain unchanged
      expect(result.data.unit.percentage).toBe(73.2);
      expect(result.data.integration.percentage).toBe(65.7);
      expect(result.data.mocks.percentage).toBe(85.7);
    });

    test("should handle E2E data with zero tests", async () => {
      const { user, workspace } = await createTestWorkspaceWithSwarm();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          unit: { covered: 100, total: 200, percentage: 50.0, coveredLines: 1000, totalLines: 2000, linePercentage: 50.0 },
          integration: { covered: 50, total: 100, percentage: 50.0, coveredLines: 500, totalLines: 1000, linePercentage: 50.0 },
          e2e: { covered: 0, total: 0, percentage: 0, coveredLines: 0, totalLines: 0, linePercentage: 0 },
          mocks: { covered: 10, total: 10, percentage: 100.0, coveredLines: 0, totalLines: 0, linePercentage: 0 },
        },
        status: 200,
      });

      const request = createGetRequest(
        "http://localhost/api/tests/coverage",
        { workspaceId: workspace.id }
      );

      const response = await GET(request);
      const result = await expectSuccess(response, 200);

      expect(result.data.e2e.covered).toBe(0);
      expect(result.data.e2e.total).toBe(0);
      expect(result.data.e2e.percentage).toBe(0);
    });

    test("should pass through E2E data when covered equals total naturally", async () => {
      const { user, workspace } = await createTestWorkspaceWithSwarm();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Natural case where all E2E tests exist and are counted
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          unit: { covered: 100, total: 200, percentage: 50.0, coveredLines: 1000, totalLines: 2000, linePercentage: 50.0 },
          integration: { covered: 50, total: 100, percentage: 50.0, coveredLines: 500, totalLines: 1000, linePercentage: 50.0 },
          e2e: { covered: 20, total: 20, percentage: 100.0, coveredLines: 0, totalLines: 0, linePercentage: 0 },
          mocks: { covered: 10, total: 10, percentage: 100.0, coveredLines: 0, totalLines: 0, linePercentage: 0 },
        },
        status: 200,
      });

      const request = createGetRequest(
        "http://localhost/api/tests/coverage",
        { workspaceId: workspace.id }
      );

      const response = await GET(request);
      const result = await expectSuccess(response, 200);

      // Should pass through natural 100% when stakgraph reports it
      expect(result.data.e2e.covered).toBe(20);
      expect(result.data.e2e.total).toBe(20);
      expect(result.data.e2e.percentage).toBe(100.0);
    });
  });

  describe("Query Parameters", () => {
    test("should return 400 when workspaceId and swarmId are missing", async () => {
      const { user } = await createTestWorkspaceWithSwarm();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost/api/tests/coverage", {});

      const response = await GET(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Missing required parameter");
    });

    test("should handle ignoreDirs parameter", async () => {
      const { user, workspace } = await createTestWorkspaceWithSwarm();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          unit: { covered: 100, total: 200, percentage: 50.0, coveredLines: 1000, totalLines: 2000, linePercentage: 50.0 },
          integration: { covered: 50, total: 100, percentage: 50.0, coveredLines: 500, totalLines: 1000, linePercentage: 50.0 },
          e2e: { covered: 10, total: 12, percentage: 83.3, coveredLines: 0, totalLines: 0, linePercentage: 0 },
          mocks: { covered: 10, total: 10, percentage: 100.0, coveredLines: 0, totalLines: 0, linePercentage: 0 },
        },
        status: 200,
      });

      const request = createGetRequest(
        "http://localhost/api/tests/coverage",
        { workspaceId: workspace.id, ignoreDirs: "node_modules,dist" }
      );

      const response = await GET(request);
      const result = await expectSuccess(response, 200);

      expect(result.success).toBe(true);
      expect(result.ignoreDirs).toBe("node_modules,dist");
    });

    test("should handle glob pattern parameters", async () => {
      const { user, workspace } = await createTestWorkspaceWithSwarm();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          unit: { covered: 100, total: 200, percentage: 50.0, coveredLines: 1000, totalLines: 2000, linePercentage: 50.0 },
          integration: { covered: 50, total: 100, percentage: 50.0, coveredLines: 500, totalLines: 1000, linePercentage: 50.0 },
          e2e: { covered: 8, total: 10, percentage: 80.0, coveredLines: 0, totalLines: 0, linePercentage: 0 },
          mocks: { covered: 10, total: 10, percentage: 100.0, coveredLines: 0, totalLines: 0, linePercentage: 0 },
        },
        status: 200,
      });

      const request = createGetRequest(
        "http://localhost/api/tests/coverage",
        { 
          workspaceId: workspace.id,
          unitGlob: "**/*.test.ts",
          integrationGlob: "**/*.integration.ts",
          e2eGlob: "**/*.e2e.ts"
        }
      );

      const response = await GET(request);
      const result = await expectSuccess(response, 200);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    test("should return 404 when swarm is not found", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost/api/tests/coverage",
        { workspaceId: workspace.id }
      );

      const response = await GET(request);
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm not found");
    });

    test("should return 400 when swarm is missing URL or API key", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      // Create swarm without URL
      await db.swarm.create({
        data: {
          name: `swarm-${workspace.id}`,
          swarmId: "test-swarm-id",
          workspaceId: workspace.id,
          status: "ACTIVE",
        },
      });
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost/api/tests/coverage",
        { workspaceId: workspace.id }
      );

      const response = await GET(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Test coverage is not available");
    });

    test("should handle stakgraph API errors", async () => {
      const { user, workspace } = await createTestWorkspaceWithSwarm();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: false,
        data: { error: "Internal server error" },
        status: 500,
      });

      const request = createGetRequest(
        "http://localhost/api/tests/coverage",
        { workspaceId: workspace.id }
      );

      const response = await GET(request);
      
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Failed to fetch test coverage data");
    });
  });

  describe("Authorization", () => {
    test("should allow workspace member to access coverage", async () => {
      const { workspace } = await createTestWorkspaceWithSwarm();
      const member = await createTestUser({ name: "Member User" });

      // Add member to workspace
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          unit: { covered: 100, total: 200, percentage: 50.0, coveredLines: 1000, totalLines: 2000, linePercentage: 50.0 },
          integration: { covered: 50, total: 100, percentage: 50.0, coveredLines: 500, totalLines: 1000, linePercentage: 50.0 },
          e2e: { covered: 5, total: 10, percentage: 50.0, coveredLines: 0, totalLines: 0, linePercentage: 0 },
          mocks: { covered: 10, total: 10, percentage: 100.0, coveredLines: 0, totalLines: 0, linePercentage: 0 },
        },
        status: 200,
      });

      const request = createGetRequest(
        "http://localhost/api/tests/coverage",
        { workspaceId: workspace.id }
      );

      const response = await GET(request);
      await expectSuccess(response, 200);
    });
  });
});
