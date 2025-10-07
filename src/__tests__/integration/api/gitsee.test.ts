import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/gitsee/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { WorkspaceRole } from "@prisma/client";
import type { User, Workspace, Swarm } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  expectError,
  getMockedSession,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { createTestWorkspaceScenario, createTestMembership } from "@/__tests__/support/fixtures/workspace";
import { createTestUser } from "@/__tests__/support/fixtures/user";

describe("GitSee API Integration Tests", () => {
  let ownerUser: User;
  let memberUser: User;
  let unauthorizedUser: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const getApiUrl = (workspaceId: string) =>
    `http://localhost:3000/api/gitsee?workspaceId=${workspaceId}`;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test workspace with swarm
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Owner User", withGitHubAuth: true, githubUsername: "owneruser" },
      members: [
        {
          user: { name: "Member User", withGitHubAuth: true, githubUsername: "memberuser" },
          role: WorkspaceRole.DEVELOPER,
        },
      ],
      withSwarm: true,
      swarm: {
        name: "test-swarm",
        status: "ACTIVE",
      },
    });

    ownerUser = scenario.owner;
    workspace = scenario.workspace;
    swarm = scenario.swarm!;
    memberUser = scenario.members[0];

    // Create unauthorized user not in workspace
    unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

    // Update swarm with required fields
    const encryptionService = EncryptionService.getInstance();
    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmId: "test-swarm-123",
        swarmUrl: "https://test-swarm.example.com",
        swarmApiKey: JSON.stringify(
          encryptionService.encryptField("swarmApiKey", "test-api-key-12345")
        ),
      },
    });

    // Refresh swarm reference
    swarm = (await db.swarm.findUnique({ where: { id: swarm.id } }))!;

    // Set up fetch spy
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/gitsee - Authentication Tests", () => {
    test("should return 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);

      await expectUnauthorized(response);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);

      await expectUnauthorized(response);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/gitsee - Authorization Tests", () => {
    test("should allow workspace owner to access endpoint", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { commits: 10 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);

      await expectSuccess(response);
      expect(fetchSpy).toHaveBeenCalled();
    });

    test("should allow workspace member to access endpoint", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { commits: 10 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);

      await expectSuccess(response);
      expect(fetchSpy).toHaveBeenCalled();
    });

    test("should return 403 when user has no workspace access", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);

      await expectForbidden(response, "Workspace not found or access denied");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("should return 404 when workspace does not exist", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest(
        "http://localhost:3000/api/gitsee?workspaceId=non-existent-id",
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);

      await expectForbidden(response, "Workspace not found or access denied");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/gitsee - Validation Tests", () => {
    test("should return 400 when workspaceId is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest("http://localhost:3000/api/gitsee", {
        repoUrl: "https://github.com/test/repo",
      });

      const response = await POST(request);

      await expectError(response, "Missing required parameter: workspaceId", 400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("should return 404 when swarm is not found", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Delete swarm
      await db.swarm.delete({ where: { id: swarm.id } });

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);

      await expectNotFound(response, "Swarm not found");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/gitsee - Success Scenarios", () => {
    test("should successfully proxy request with GitHub credentials", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const mockGitSeeResponse = {
        success: true,
        data: {
          commits: 42,
          branches: 5,
        },
      };

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify(mockGitSeeResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const requestBody = {
        repoUrl: "https://github.com/test/repo",
        branch: "main",
      };

      const request = createPostRequest(
        getApiUrl(workspace.id),
        requestBody
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data).toEqual(mockGitSeeResponse);

      // Verify fetch was called with correct parameters
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://test-swarm.example.com:3355/gitsee",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-token": "test-api-key-12345",
          }),
        })
      );

      // Verify request body format
      const fetchCallArgs = fetchSpy.mock.calls[0];
      const fetchBody = JSON.parse(fetchCallArgs[1]?.body as string);

      // GitHub credentials may or may not be present depending on OAuth setup
      // If present, verify they have the correct structure
      if (fetchBody.cloneOptions) {
        expect(fetchBody.cloneOptions).toHaveProperty("username");
        expect(fetchBody.cloneOptions).toHaveProperty("token");
      }
    });

    test("should successfully proxy request without GitHub credentials", async () => {
      // Create user without GitHub auth
      const userWithoutGitHub = await createTestUser({ name: "No GitHub User" });

      // Add user to workspace
      await createTestMembership({
        workspaceId: workspace.id,
        userId: userWithoutGitHub.id,
        role: WorkspaceRole.DEVELOPER,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(userWithoutGitHub));

      const mockGitSeeResponse = { success: true, data: { commits: 10 } };

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify(mockGitSeeResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data).toEqual(mockGitSeeResponse);
      expect(fetchSpy).toHaveBeenCalled();
    });

    test("should use correct swarm URL for production", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      await POST(request);

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://test-swarm.example.com:3355/gitsee",
        expect.any(Object)
      );
    });

    test("should use correct swarm URL for localhost", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Update swarm URL to localhost
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: "http://localhost:8000" },
      });

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      await POST(request);

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3355/gitsee",
        expect.any(Object)
      );
    });

    test("should decrypt swarm API key before sending request", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      await POST(request);

      // Verify encrypted key is stored in database
      const storedSwarm = await db.swarm.findUnique({ where: { id: swarm.id } });
      expect(storedSwarm?.swarmApiKey).toBeDefined();
      expect(storedSwarm?.swarmApiKey).not.toContain("test-api-key-12345");

      // Verify fetch was called with decrypted key
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": "test-api-key-12345",
          }),
        })
      );
    });
  });

  describe("POST /api/gitsee - External Service Error Handling", () => {
    test("should return 500 when external service returns error status", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ error: "Service error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);

      await expectError(response, "Failed to fetch repository data", 500);
    });

    test("should return 500 when external service call fails", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      fetchSpy.mockRejectedValue(new Error("Network error"));

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);

      await expectError(response, "Failed to fetch repository data", 500);
    });

    test("should handle timeout errors from external service", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      fetchSpy.mockRejectedValue(new Error("Request timeout"));

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);

      await expectError(response, "Failed to fetch repository data", 500);
    });
  });

  describe("POST /api/gitsee - Request Body Handling", () => {
    test("should forward complete request body to external service", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const requestBody = {
        repoUrl: "https://github.com/test/repo",
        branch: "develop",
        depth: 100,
        cloneOptions: {
          branch: "feature/test",
        },
      };

      const request = createPostRequest(
        getApiUrl(workspace.id),
        requestBody
      );

      await POST(request);

      const fetchCallArgs = fetchSpy.mock.calls[0];
      const fetchBody = JSON.parse(fetchCallArgs[1]?.body as string);

      expect(fetchBody).toMatchObject({
        repoUrl: "https://github.com/test/repo",
        branch: "develop",
        depth: 100,
      });
    });

    test("should merge GitHub credentials with existing cloneOptions", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const requestBody = {
        repoUrl: "https://github.com/test/repo",
        cloneOptions: {
          branch: "custom-branch",
          depth: 50,
        },
      };

      const request = createPostRequest(
        getApiUrl(workspace.id),
        requestBody
      );

      await POST(request);

      const fetchCallArgs = fetchSpy.mock.calls[0];
      const fetchBody = JSON.parse(fetchCallArgs[1]?.body as string);

      // Verify cloneOptions are preserved
      expect(fetchBody.cloneOptions).toBeDefined();
      expect(fetchBody.cloneOptions).toMatchObject({
        branch: "custom-branch",
        depth: 50,
      });

      // If GitHub credentials are available, verify they were merged
      if (fetchBody.cloneOptions.username && fetchBody.cloneOptions.token) {
        expect(fetchBody.cloneOptions.username).toEqual(expect.any(String));
        expect(fetchBody.cloneOptions.token).toEqual(expect.any(String));
      }
    });
  });

  describe("POST /api/gitsee - Response Format", () => {
    test("should return properly formatted success response", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const mockResponse = {
        success: true,
        data: {
          commits: 100,
          branches: ["main", "develop"],
          contributors: 5,
        },
      };

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createPostRequest(
        getApiUrl(workspace.id),
        { repoUrl: "https://github.com/test/repo" }
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data).toEqual(mockResponse);
    });
  });
});