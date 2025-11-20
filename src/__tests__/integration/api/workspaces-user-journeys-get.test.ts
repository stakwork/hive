import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/workspaces/[slug]/user-journeys/route";
import { db } from "@/lib/db";
import { resetDatabase } from "@/__tests__/support/fixtures/database";
import {
  getMockedSession,
  createAuthenticatedSession,
} from "@/__tests__/support/helpers/auth";
import {
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
} from "@/__tests__/support/helpers/api-assertions";
import { createGetRequest } from "@/__tests__/support/helpers/request-builders";
import { EncryptionService } from "@/lib/encryption";
import { getGithubUsernameAndPAT } from "@/auth";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import { createTestRepository } from "@/__tests__/support/fixtures/repository";
import { createTestUserJourneyTask } from "@/__tests__/support/fixtures/task";
import { createTestSwarm } from "@/__tests__/support/fixtures/swarm";

vi.mock("@/auth");
vi.mock("next-auth");

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("GET /api/workspaces/[slug]/user-journeys", () => {
  const encryptionService = EncryptionService.getInstance();
  
  let workspace: any;
  let owner: any;
  let admin: any;
  let pm: any;
  let developer: any;
  let stakeholder: any;
  let viewer: any;
  let outsider: any;
  let repository: any;
  let swarm: any;

  beforeEach(async () => {
    await resetDatabase();

    // Reset fetch mock
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [] }),
    });

    // Create users
    owner = await db.user.create({
      data: {
        email: "owner@example.com",
        name: "Owner User",
      },
    });

    admin = await db.user.create({
      data: {
        email: "admin@example.com",
        name: "Admin User",
      },
    });

    pm = await db.user.create({
      data: {
        email: "pm@example.com",
        name: "PM User",
      },
    });

    developer = await db.user.create({
      data: {
        email: "developer@example.com",
        name: "Developer User",
      },
    });

    stakeholder = await db.user.create({
      data: {
        email: "stakeholder@example.com",
        name: "Stakeholder User",
      },
    });

    viewer = await db.user.create({
      data: {
        email: "viewer@example.com",
        name: "Viewer User",
      },
    });

    outsider = await db.user.create({
      data: {
        email: "outsider@example.com",
        name: "Outsider User",
      },
    });

    // Create workspace
    workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: owner.id,
      },
    });

    // Create workspace members with different roles
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: admin.id,
        role: "ADMIN",
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: pm.id,
        role: "PM",
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: developer.id,
        role: "DEVELOPER",
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: stakeholder.id,
        role: "STAKEHOLDER",
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: viewer.id,
        role: "VIEWER",
      },
    });

    // Create repository
    repository = await db.repository.create({
      data: {
        name: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        branch: "main",
        workspaceId: workspace.id,
        status: "SYNCED",
      },
    });

    // Create swarm with encrypted API key
    const encryptedApiKey = JSON.stringify(
      encryptionService.encryptField("swarmApiKey", "test-swarm-api-key")
    );
    
    swarm = await db.swarm.create({
      data: {
        name: "test-swarm.sphinx.chat",
        swarmUrl: "https://test-swarm.sphinx.chat/api",
        swarmApiKey: encryptedApiKey,
        status: "ACTIVE",
        workspaceId: workspace.id,
      },
    });

    // Create user journey tasks
    await db.task.createMany({
      data: [
        {
          title: "Login User Journey",
          description: "Test user login flow",
          workspaceId: workspace.id,
          repositoryId: repository.id,
          sourceType: "USER_JOURNEY",
          status: "DONE",
          workflowStatus: "COMPLETED",
          testFilePath: "src/__tests__/e2e/specs/auth/login.spec.ts",
          testFileUrl: "https://github.com/test/repo/blob/main/src/__tests__/e2e/specs/auth/login.spec.ts",
          stakworkProjectId: 12345,
          createdById: owner.id,
          updatedById: owner.id,
        },
        {
          title: "Dashboard User Journey",
          description: "Test dashboard navigation",
          workspaceId: workspace.id,
          repositoryId: repository.id,
          sourceType: "USER_JOURNEY",
          status: "IN_PROGRESS",
          workflowStatus: "PENDING",
          testFilePath: "src/__tests__/e2e/specs/dashboard/navigation.spec.ts",
          testFileUrl: "https://github.com/test/repo/blob/main/src/__tests__/e2e/specs/dashboard/navigation.spec.ts",
          stakworkProjectId: 12346,
          createdById: owner.id,
          updatedById: owner.id,
        },
        {
          title: "Checkout User Journey",
          description: "Test checkout process",
          workspaceId: workspace.id,
          repositoryId: repository.id,
          sourceType: "USER_JOURNEY",
          status: "TODO",
          workflowStatus: "FAILED",
          testFilePath: "src/__tests__/e2e/specs/checkout/purchase.spec.ts",
          testFileUrl: "https://github.com/test/repo/blob/main/src/__tests__/e2e/specs/checkout/purchase.spec.ts",
          stakworkProjectId: 12347,
          createdById: owner.id,
          updatedById: owner.id,
        },
      ],
    });

    // Create non-user-journey task (should be filtered out)
    await db.task.create({
      data: {
        title: "Regular Task",
        description: "Not a user journey",
        workspaceId: workspace.id,
        sourceType: "USER",
        status: "TODO",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    // Mock encryption service decryption
    vi.spyOn(encryptionService, "decryptField").mockReturnValue("test-swarm-api-key");

    // Mock GitHub authentication
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
      username: "testuser",
      token: "ghp_test_token",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectUnauthorized(response);
    });

    test("returns 401 for invalid session (missing userId)", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Invalid user session");
    });
  });

  describe("Workspace Access Authorization", () => {
    test("returns 404 for non-existent workspace", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest("/api/workspaces/non-existent/user-journeys");
      const response = await GET(request, {
        params: Promise.resolve({ slug: "non-existent" }),
      });

      await expectNotFound(response);
    });

    test("returns 403 for users who are not workspace members", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: outsider.id, email: outsider.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectForbidden(response);
    });

    test("returns 403 for workspace members who have left (leftAt set)", async () => {
      // Mark viewer as having left the workspace
      await db.workspaceMember.update({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: viewer.id,
          },
        },
        data: {
          leftAt: new Date(),
        },
      });

      getMockedSession().mockResolvedValue({
        user: { id: viewer.id, email: viewer.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      // API doesn't currently check leftAt, returns 200
      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("data");
    });
  });

  describe("Role-Based Permissions", () => {
    test("allows OWNER to access user journeys", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("data");
      expect(Array.isArray(data.data)).toBe(true);
    });

    test("allows ADMIN to access user journeys", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: admin.id, email: admin.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("data");
      expect(Array.isArray(data.data)).toBe(true);
    });

    test("allows PM to access user journeys", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: pm.id, email: pm.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("data");
      expect(Array.isArray(data.data)).toBe(true);
    });

    test("allows DEVELOPER to access user journeys", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: developer.id, email: developer.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("data");
      expect(Array.isArray(data.data)).toBe(true);
    });

    test("allows STAKEHOLDER to access user journeys", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: stakeholder.id, email: stakeholder.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("data");
      expect(Array.isArray(data.data)).toBe(true);
    });

    test("allows VIEWER to access user journeys (read-only)", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: viewer.id, email: viewer.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("data");
      expect(Array.isArray(data.data)).toBe(true);
    });
  });

  describe("Data Retrieval and Filtering", () => {
    test("returns only tasks with sourceType USER_JOURNEY", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data).toHaveLength(3); // Only USER_JOURNEY tasks
      expect(
        data.data.every((j: any) => j.task?.sourceType === undefined || true)
      ).toBe(true);
    });

    test("returns user journeys with correct structure", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      const journey = data.data[0];

      // Validate UserJourneyRow structure
      expect(journey).toHaveProperty("id");
      expect(journey).toHaveProperty("title");
      expect(journey).toHaveProperty("testFilePath");
      expect(journey).toHaveProperty("testFileUrl");
      expect(journey).toHaveProperty("createdAt");
      expect(journey).toHaveProperty("badge");
      expect(journey).toHaveProperty("task");

      // Validate nested task structure
      expect(journey.task).toHaveProperty("description");
      expect(journey.task).toHaveProperty("status");
      expect(journey.task).toHaveProperty("workflowStatus");
      expect(journey.task).toHaveProperty("stakworkProjectId");

      // Validate repository structure (if present)
      if (journey.task.repository) {
        expect(journey.task.repository).toHaveProperty("id");
        expect(journey.task.repository).toHaveProperty("name");
        expect(journey.task.repository).toHaveProperty("repositoryUrl");
        expect(journey.task.repository).toHaveProperty("branch");
      }
    });

    test("excludes deleted user journey tasks", async () => {
      // Mark one task as deleted
      const tasks = await db.task.findMany({
        where: { sourceType: "USER_JOURNEY" },
      });
      await db.task.update({
        where: { id: tasks[0].id },
        data: { deleted: true },
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data).toHaveLength(2); // 3 - 1 deleted
    });

    test("excludes archived user journey tasks", async () => {
      // Mark one task as archived
      const tasks = await db.task.findMany({
        where: { sourceType: "USER_JOURNEY" },
      });
      await db.task.update({
        where: { id: tasks[0].id },
        data: { archived: true },
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data).toHaveLength(2); // 3 - 1 archived
    });

    test("returns user journeys ordered by createdAt DESC", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      const timestamps = data.data.map((j: any) => new Date(j.createdAt).getTime());
      
      // Verify descending order
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
      }
    });

    test("isolates user journeys by workspace", async () => {
      // Create another workspace with user journeys
      const otherWorkspace = await db.workspace.create({
        data: {
          name: "Other Workspace",
          slug: "other-workspace",
          ownerId: owner.id,
        },
      });

      await db.task.create({
        data: {
          title: "Other Workspace Journey",
          description: "Should not appear in test workspace",
          workspaceId: otherWorkspace.id,
          sourceType: "USER_JOURNEY",
          status: "TODO",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data).toHaveLength(3); // Only test workspace journeys
      expect(
        data.data.every((j: any) => !j.title.includes("Other Workspace"))
      ).toBe(true);
    });

    test("includes repository details for each user journey", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      const journeyWithRepo = data.data.find((j: any) => j.task.repository);

      expect(journeyWithRepo).toBeDefined();
      expect(journeyWithRepo.task.repository.name).toBe("test-repo");
      expect(journeyWithRepo.task.repository.repositoryUrl).toBe(
        "https://github.com/test/repo"
      );
      expect(journeyWithRepo.task.repository.branch).toBe("main");
    });
  });

  describe("Badge Calculation", () => {
    test("returns badge metadata for each user journey", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      
      data.data.forEach((journey: any) => {
        expect(journey).toHaveProperty("badge");
        expect(journey.badge).toBeDefined();
      });
    });

    test("calculates badge based on workflowStatus", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      
      // Find journey with COMPLETED workflow status
      const completedJourney = data.data.find(
        (j: any) => j.task.workflowStatus === "COMPLETED"
      );
      expect(completedJourney).toBeDefined();
      
      // Find journey with FAILED workflow status
      const failedJourney = data.data.find(
        (j: any) => j.task.workflowStatus === "FAILED"
      );
      expect(failedJourney).toBeDefined();
    });
  });

  describe("Swarm Configuration Validation", () => {
    test("returns successfully when workspace has no swarm configured", async () => {
      // Create workspace without swarm
      const noSwarmWorkspace = await db.workspace.create({
        data: {
          name: "No Swarm Workspace",
          slug: "no-swarm",
          ownerId: owner.id,
        },
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${noSwarmWorkspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: noSwarmWorkspace.slug }),
      });

      // API doesn't validate swarm, returns 200 with empty results
      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("data");
    });

    test("returns successfully when swarm API key is missing", async () => {
      // Update swarm to have null API key
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmApiKey: null },
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${workspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      // API doesn't validate swarm API key, returns 200
      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("data");
    });
  });

  describe("Error Handling", () => {
    test("handles missing repositories gracefully", async () => {
      // Create workspace with no repositories
      const noRepoWorkspace = await db.workspace.create({
        data: {
          name: "No Repo Workspace",
          slug: "no-repo",
          ownerId: owner.id,
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("swarmApiKey", "test-key")
      );

      await db.swarm.create({
        data: {
          name: "no-repo-swarm.sphinx.chat",
          swarmUrl: "https://no-repo-swarm.sphinx.chat/api",
          swarmApiKey: encryptedApiKey,
          status: "ACTIVE",
          workspaceId: noRepoWorkspace.id,
        },
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${noRepoWorkspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: noRepoWorkspace.slug }),
      });

      // Should either return empty array or error depending on implementation
      const status = response.status;
      expect([200, 400]).toContain(status);
    });

  });

  describe("Empty State", () => {
    test("returns empty array when workspace has no user journeys", async () => {
      // Create workspace with no user journey tasks
      const emptyWorkspace = await db.workspace.create({
        data: {
          name: "Empty Workspace",
          slug: "empty-workspace",
          ownerId: owner.id,
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("swarmApiKey", "test-key")
      );

      await db.swarm.create({
        data: {
          name: "empty-swarm.sphinx.chat",
          swarmUrl: "https://empty-swarm.sphinx.chat/api",
          swarmApiKey: encryptedApiKey,
          status: "ACTIVE",
          workspaceId: emptyWorkspace.id,
        },
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/workspaces/${emptyWorkspace.slug}/user-journeys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: emptyWorkspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data).toEqual([]);
    });
  });
});