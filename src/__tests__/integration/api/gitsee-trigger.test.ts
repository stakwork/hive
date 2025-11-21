import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/gitsee/trigger/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  createPostRequest,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectForbidden,
  expectNotFound,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspaceScenario } from "@/__tests__/support/fixtures";

describe("POST /api/gitsee/trigger - Integration Tests", () => {
  let fetchSpy: any;
  const encryptionService = EncryptionService.getInstance();

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock successful GitSee service response by default
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        visualization: {
          nodes: 10,
          edges: 20,
        },
      }),
      text: async () => "Success",
    } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: "test-workspace-id",
      });

      const response = await POST(request);

      await expectUnauthorized(response);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("returns 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: "test-workspace-id",
      });

      const response = await POST(request);

      await expectUnauthorized(response);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("allows authenticated users to proceed", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);

      // Should proceed past authentication (may fail later but not at auth)
      expect(response.status).not.toBe(401);
    });
  });

  describe("Input Validation", () => {
    test("returns 400 when repositoryUrl is missing", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);

      await expectError(response, "repositoryUrl is required", 400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("returns 400 when workspaceId is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
      });

      const response = await POST(request);

      await expectError(response, "workspaceId is required", 400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("returns 400 when both repositoryUrl and workspaceId are missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {});

      const response = await POST(request);

      // Should fail on first missing field check
      expect(response.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("Authorization", () => {
    test("returns 403 when user lacks workspace access", async () => {
      const { workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      // Create different user who is not a member
      const nonMember = await createTestUser({ email: "nonmember@test.com" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);

      await expectForbidden(response);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("allows workspace owner to trigger visualization", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalled();
    });

    test("allows workspace members to trigger visualization", async () => {
      const { workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      // Create member user
      const member = await createTestUser({ email: "member@test.com" });
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe("Swarm Configuration", () => {
    test("returns 404 when workspace has no swarm", async () => {
      // Create workspace WITHOUT swarm
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: false,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);

      await expectNotFound(response, "Swarm not found");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("returns 404 when workspace does not exist", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: "nonexistent-workspace-id",
      });

      const response = await POST(request);

      // Should fail at workspace validation (403) or workspace lookup (404)
      expect([403, 404]).toContain(response.status);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("GitSee Service Integration", () => {
    test("successfully triggers visualization with valid payload", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);

      const data = await expectSuccess(response, 200);

      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("message");
      expect(data.message).toContain("stakwork/hive");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test("includes decrypted swarm API key in request headers", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      await POST(request);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];

      // Verify x-api-token header is present
      expect(options.headers).toHaveProperty("x-api-token");

      // Verify header contains decrypted value (not JSON encrypted format)
      const apiToken = options.headers["x-api-token"];
      expect(typeof apiToken).toBe("string");
      expect(apiToken).not.toContain("data");
      expect(apiToken).not.toContain("iv");
      expect(apiToken).not.toContain("tag");
    });

    test("passes GitHub credentials for private repo access", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
        owner: { withGitHubAuth: true },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/private-repo",
        workspaceId: workspace.id,
      });

      await POST(request);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];

      // Verify request body contains cloneOptions
      const body = JSON.parse(options.body);
      expect(body).toHaveProperty("cloneOptions");
      expect(body.cloneOptions).toHaveProperty("username");
      expect(body.cloneOptions).toHaveProperty("token");
    });

    test("constructs correct GitSee URL from swarm configuration", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      await POST(request);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0];

      // URL should be constructed from swarm hostname with port 3355
      expect(url).toContain(":3355/gitsee");
    });

    test("handles localhost swarm URLs correctly", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      // Update swarm URL to localhost
      await db.swarm.update({
        where: { id: swarm!.id },
        data: { swarmUrl: "http://localhost:8080" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      await POST(request);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0];

      // Should use http for localhost
      expect(url).toContain("http://localhost:3355/gitsee");
    });

    test("includes correct data types in GitSee request", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      await POST(request);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];

      const body = JSON.parse(options.body);
      expect(body.data).toEqual(["repo_info", "contributors", "icon", "files", "stats"]);
    });

    test("handles GitSee service errors gracefully", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      // Mock GitSee service error
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "GitSee service unavailable",
      } as Response);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);

      await expectError(response, "Failed to trigger visualization", 500);
    });

    test("handles network errors during GitSee request", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      // Mock network error
      fetchSpy.mockRejectedValueOnce(new Error("Network timeout"));

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);

      await expectError(response, "Failed to trigger visualization", 500);
    });
  });

  describe("URL Parsing", () => {
    test("correctly parses HTTPS GitHub URLs", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/facebook/react",
        workspaceId: workspace.id,
      });

      await POST(request);

      const [url, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.owner).toBe("facebook");
      expect(body.repo).toBe("react");
    });

    test("correctly parses SSH GitHub URLs", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "git@github.com:vercel/next.js.git",
        workspaceId: workspace.id,
      });

      await POST(request);

      const [url, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.owner).toBe("vercel");
      expect(body.repo).toBe("next.js");
    });

    test("handles GitHub URLs with .git extension", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/microsoft/typescript.git",
        workspaceId: workspace.id,
      });

      await POST(request);

      const [url, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.owner).toBe("microsoft");
      expect(body.repo).toBe("typescript");
    });
  });

  describe("Response Format", () => {
    test("returns expected data structure on success", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      // Verify response structure
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("message");
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("owner");
      expect(data.data).toHaveProperty("repo");
      expect(data.data).toHaveProperty("gitseeResponse");
    });

    test("includes owner and repo in response data", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data.owner).toBe("stakwork");
      expect(data.data.repo).toBe("hive");
    });

    test("includes GitSee service response in data", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      const mockGitSeeResponse = {
        success: true,
        visualization: {
          nodes: 25,
          edges: 40,
          metadata: {
            language: "TypeScript",
            framework: "Next.js",
          },
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockGitSeeResponse,
      } as Response);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data.gitseeResponse).toEqual(mockGitSeeResponse);
    });
  });

  describe("Edge Cases", () => {
    test("handles empty swarmApiKey gracefully", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      // Set empty encrypted API key
      await db.swarm.update({
        where: { id: swarm!.id },
        data: {
          swarmApiKey: JSON.stringify(encryptionService.encryptField("swarmApiKey", "")),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);

      // Should still attempt the request (GitSee service may reject)
      expect(fetchSpy).toHaveBeenCalled();
    });

    test("handles user without GitHub credentials", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
        owner: { withGitHubAuth: false }, // No GitHub auth
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("http://localhost:3000/api/gitsee/trigger", {
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      });

      const response = await POST(request);

      // Should still proceed but without clone options
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);

      // cloneOptions should be undefined when no credentials
      expect(body.cloneOptions).toBeUndefined();
    });
  });
});
