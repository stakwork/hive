import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/webhook/ensure/route";
import { WebhookService } from "@/services/github/WebhookService";
import {
  createTestUser,
  createTestWorkspace,
  createTestRepository,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  createPostRequest,
} from "@/__tests__/support/helpers";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/services/github/WebhookService");

describe("GitHub Webhook Ensure API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/github/webhook/ensure", () => {
    test("returns 401 when user not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: "test-workspace-id",
        repositoryUrl: "https://github.com/test/repo",
      });

      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("returns 400 when workspaceId is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        repositoryUrl: "https://github.com/test/repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("Missing required fields: workspaceId and repositoryUrl or repositoryId");
    });

    test("returns 400 when both repositoryUrl and repositoryId are missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: "test-workspace-id",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("Missing required fields: workspaceId and repositoryUrl or repositoryId");
    });

    test("returns 404 when repository not found by repositoryId", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: "test-workspace-id",
        repositoryId: "non-existent-repo-id",
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.message).toContain("Repository not found for workspace");
    });

    test("returns 404 when repository workspaceId does not match", async () => {
      const user = await createTestUser();
      const workspace1 = await createTestWorkspace({
        name: "Workspace 1",
        ownerId: user.id,
      });
      const workspace2 = await createTestWorkspace({
        name: "Workspace 2",
        ownerId: user.id,
      });
      const repository = await createTestRepository({
        workspaceId: workspace1.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: workspace2.id, // Different workspace
        repositoryId: repository.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.message).toContain("Repository not found for workspace");
    });

    test("returns 500 when repository URL not found after repositoryId lookup", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      // Create repository with empty URL
      const repository = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: workspace.id,
        repositoryId: repository.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.message).toContain("Failed to ensure webhook");
    });

    test("returns 200 with webhookId on successful webhook setup using repositoryUrl", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockWebhookId = 123456789;
      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: "mock-secret-12345678",
      });

      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(mockWebhookId);

      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith({
        userId: user.id,
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
        callbackUrl: expect.stringContaining("/api/github/webhook"),
      });
    });

    test("returns 200 with webhookId on successful webhook setup using repositoryId", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });
      const repository = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockWebhookId = 987654321;
      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: "mock-secret-87654321",
      });

      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: workspace.id,
        repositoryId: repository.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(mockWebhookId);

      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith({
        userId: user.id,
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
        callbackUrl: expect.stringContaining("/api/github/webhook"),
      });
    });

    test("returns 500 when WebhookService throws INSUFFICIENT_PERMISSIONS error", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockEnsureRepoWebhook = vi.fn().mockRejectedValue(
        new Error("INSUFFICIENT_PERMISSIONS")
      );

      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.message).toContain("Failed to ensure webhook");
    });

    test("returns 500 when WebhookService throws WEBHOOK_CREATION_FAILED error", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockEnsureRepoWebhook = vi.fn().mockRejectedValue(
        new Error("WEBHOOK_CREATION_FAILED")
      );

      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.message).toContain("Failed to ensure webhook");
    });

    test("returns 500 when WebhookService throws Repository not found error", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockEnsureRepoWebhook = vi.fn().mockRejectedValue(
        new Error("Repository not found for workspace")
      );

      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.message).toContain("Failed to ensure webhook");
    });

    test("handles webhook idempotency correctly", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const existingWebhookId = 111222333;
      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: existingWebhookId,
        secret: "existing-secret",
      });

      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const requestData = {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      };

      // First call
      const request1 = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        requestData
      );
      const response1 = await POST(request1);
      const data1 = await expectSuccess(response1);

      expect(data1.data.webhookId).toBe(existingWebhookId);

      // Second call with same data (idempotency test)
      const request2 = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        requestData
      );
      const response2 = await POST(request2);
      const data2 = await expectSuccess(response2);

      expect(data2.data.webhookId).toBe(existingWebhookId);

      // Both calls should invoke the service
      expect(mockEnsureRepoWebhook).toHaveBeenCalledTimes(2);
    });

    test("validates callback URL is passed to WebhookService", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: 123456,
        secret: "mock-secret",
      });

      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      await POST(request);

      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith({
        userId: user.id,
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
        callbackUrl: expect.stringContaining("/api/github/webhook"),
      });
    });

    test("handles concurrent webhook setup requests correctly", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockWebhookId = 999888777;
      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: "mock-secret",
      });

      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const requestData = {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      };

      // Simulate concurrent requests
      const requests = [
        createPostRequest("http://localhost:3000/api/github/webhook/ensure", requestData),
        createPostRequest("http://localhost:3000/api/github/webhook/ensure", requestData),
        createPostRequest("http://localhost:3000/api/github/webhook/ensure", requestData),
      ];

      const responses = await Promise.all(requests.map((req) => POST(req)));

      // All requests should succeed
      for (const response of responses) {
        const data = await expectSuccess(response);
        expect(data.data.webhookId).toBe(mockWebhookId);
      }

      expect(mockEnsureRepoWebhook).toHaveBeenCalledTimes(3);
    });

    test("passes correct userId to WebhookService", async () => {
      const user = await createTestUser({ name: "Specific Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: 555666777,
        secret: "mock-secret",
      });

      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      await POST(request);

      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: user.id,
        })
      );
    });

    test("handles both repositoryUrl and repositoryId provided together", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });
      const repository = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/original-repo",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: 444555666,
        secret: "mock-secret",
      });

      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest("http://localhost:3000/api/github/webhook/ensure", {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/override-repo", // This should be used
        repositoryId: repository.id, // This should be ignored
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.data.webhookId).toBe(444555666);

      // Should use the repositoryUrl from request body, not lookup from repositoryId
      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith({
        userId: user.id,
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/override-repo",
        callbackUrl: expect.stringContaining("/api/github/webhook"),
      });
    });
  });
});