import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RepositoryStatus } from "@prisma/client";
import { POST } from "@/app/api/github/webhook/[workspaceId]/route";
import * as stakgraphActions from "@/services/swarm/stakgraph-actions";
import * as githubAuth from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import {
  createTestRepository,
  createGitHubPushPayload,
  createGitHubPullRequestPayload,
  computeValidWebhookSignature,
  createWebhookRequest,
} from "@/__tests__/support/fixtures/github-webhook";

// Mock external services
vi.mock("@/services/swarm/stakgraph-actions");
vi.mock("@/lib/auth/nextauth");

describe("GitHub Webhook Integration Tests", () => {
  let testRepository: Awaited<ReturnType<typeof createTestRepository>>;
  let webhookSecret: string;
  let workspaceId: string;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup default mock responses
    vi.mocked(stakgraphActions.triggerAsyncSync).mockResolvedValue({
      ok: true,
      status: 200,
      data: { request_id: "test-ref-id-123" },
    });

    vi.mocked(githubAuth.getGithubUsernameAndPAT).mockResolvedValue({
      username: "testuser",
      token: "github_pat_test123",
    });

    // Create test repository with all dependencies
    testRepository = await createTestRepository({
      repositoryUrl: "https://github.com/test-org/test-repo",
      branch: "main",
      status: RepositoryStatus.SYNCED,
    });

    webhookSecret = testRepository.webhookSecret;
    workspaceId = testRepository.repository.workspaceId;
  });

  afterEach(async () => {
    // Cleanup database
    if (testRepository) {
      await db.repository.deleteMany({
        where: { workspaceId: testRepository.repository.workspaceId },
      });
      await db.swarm.deleteMany({
        where: { workspaceId: testRepository.repository.workspaceId },
      });
      await db.workspaceMember.deleteMany({
        where: { workspaceId: testRepository.repository.workspaceId },
      });
      await db.workspace.deleteMany({
        where: { id: testRepository.repository.workspaceId },
      });
      await db.gitHubAuth.deleteMany({
        where: { userId: testRepository.user.id },
      });
      await db.user.deleteMany({
        where: { id: testRepository.user.id },
      });
    }
  });

  describe("Security Validation", () => {
    it("should reject requests with invalid HMAC signature", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const invalidSignature = "sha256=invalid_signature_here";

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        invalidSignature,
        testRepository.repository.githubWebhookId!
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(stakgraphActions.triggerAsyncSync).not.toHaveBeenCalled();
    });

    it("should reject requests with missing signature header", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );

      const request = new Request(
        `http://localhost:3000/api/github/webhook/${workspaceId}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "push",
            "x-github-delivery": "test-delivery-id",
            "x-github-hook-id": testRepository.repository.githubWebhookId!,
            // Missing x-hub-signature-256
          },
          body: JSON.stringify(payload),
        }
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    it("should successfully verify valid HMAC signature", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(202);
      expect(stakgraphActions.triggerAsyncSync).toHaveBeenCalled();
    });

    it("should properly decrypt webhook secret for verification", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(202);

      // Verify the repository's webhook secret is stored encrypted
      const repo = await db.repository.findUnique({
        where: { id: testRepository.repository.id },
      });
      expect(repo?.githubWebhookSecret).not.toBe(webhookSecret);
      expect(repo?.githubWebhookSecret).toContain('"data"');
      expect(repo?.githubWebhookSecret).toContain('"iv"');
    });
  });

  describe("Event Processing - Push Events", () => {
    it("should process push event to configured branch", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(202);
      expect(stakgraphActions.triggerAsyncSync).toHaveBeenCalledWith(
        expect.any(String), // swarm name
        testRepository.swarmApiKey, // decrypted API key
        testRepository.repository.repositoryUrl,
        { username: "testuser", pat: "github_pat_test123" },
        expect.stringContaining("/api/swarm/stakgraph/webhook")
      );
    });

    it("should ignore push event to non-configured branch", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/feature/test-branch",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(202);
      expect(stakgraphActions.triggerAsyncSync).not.toHaveBeenCalled();

      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it("should update repository status to PENDING on push", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      const response = await POST(request, { params: { workspaceId } });
      expect(response.status).toBe(202);

      const updatedRepo = await db.repository.findUnique({
        where: { id: testRepository.repository.id },
      });

      expect(updatedRepo?.status).toBe(RepositoryStatus.PENDING);
      expect(updatedRepo?.updatedAt.getTime()).toBeGreaterThan(
        testRepository.repository.updatedAt.getTime()
      );
    });

    it("should store ingest reference ID in swarm", async () => {
      const mockRefId = "ingest-ref-abc123";
      vi.mocked(stakgraphActions.triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: mockRefId },
      });

      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      const response = await POST(request, { params: { workspaceId } });
      expect(response.status).toBe(202);

      const updatedSwarm = await db.swarm.findUnique({
        where: { workspaceId: testRepository.repository.workspaceId },
      });

      expect(updatedSwarm?.ingestRefId).toBe(mockRefId);
    });
  });

  describe("Event Processing - Pull Request Events", () => {
    it("should process merged pull request event", async () => {
      const payload = createGitHubPullRequestPayload(
        testRepository.repository.repositoryUrl,
        true
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = new Request(
        `http://localhost:3000/api/github/webhook/${workspaceId}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": validSignature,
            "x-github-event": "pull_request",
            "x-github-delivery": "test-delivery-id",
            "x-github-hook-id": testRepository.repository.githubWebhookId!,
          },
          body: JSON.stringify(payload),
        }
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(202);
      // Note: storePullRequest is currently disabled in the code
      // but the event should still be accepted
    });

    it("should ignore non-merged pull request event", async () => {
      const payload = createGitHubPullRequestPayload(
        testRepository.repository.repositoryUrl,
        false
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = new Request(
        `http://localhost:3000/api/github/webhook/${workspaceId}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": validSignature,
            "x-github-event": "pull_request",
            "x-github-delivery": "test-delivery-id",
            "x-github-hook-id": testRepository.repository.githubWebhookId!,
          },
          body: JSON.stringify(payload),
        }
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(202);
    });
  });

  describe("Event Processing - Other Events", () => {
    it("should return 400 for event with missing repository", async () => {
      const payload = { action: "test" }; // Missing repository field
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = new Request(
        `http://localhost:3000/api/github/webhook/${workspaceId}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": validSignature,
            "x-github-event": "unknown_event",
            "x-github-delivery": "test-delivery-id",
            "x-github-hook-id": testRepository.repository.githubWebhookId!,
          },
          body: JSON.stringify(payload),
        }
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
    });
  });

  describe("Error Handling - Missing Resources", () => {
    it("should return 404 when repository not found", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        "invalid-webhook-id"
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    it("should return 404 when workspace is soft-deleted", async () => {
      // Soft delete the workspace
      await db.workspace.update({
        where: { id: workspaceId },
        data: { deletedAt: new Date() },
      });

      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    it("should return 400 when swarm configuration is missing", async () => {
      // Delete swarm configuration
      await db.swarm.delete({
        where: { workspaceId: testRepository.repository.workspaceId },
      });

      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    it("should return 400 when required headers are missing", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );

      const request = new Request(
        `http://localhost:3000/api/github/webhook/${workspaceId}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Missing all required headers
          },
          body: JSON.stringify(payload),
        }
      );

      const response = await POST(request, { params: { workspaceId } });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
    });
  });

  describe("Service Integration", () => {
    it("should pass correct parameters to triggerAsyncSync", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      await POST(request, { params: { workspaceId } });

      expect(stakgraphActions.triggerAsyncSync).toHaveBeenCalledWith(
        expect.any(String),
        testRepository.swarmApiKey,
        testRepository.repository.repositoryUrl,
        { username: "testuser", pat: "github_pat_test123" },
        expect.stringContaining("/api/swarm/stakgraph/webhook")
      );
    });

    it("should construct correct callback URL", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      await POST(request, { params: { workspaceId } });

      const callbackUrl =
        vi.mocked(stakgraphActions.triggerAsyncSync).mock.calls[0][4];
      expect(callbackUrl).toContain("/api/swarm/stakgraph/webhook");
    });

    it("should fetch GitHub credentials for user", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      await POST(request, { params: { workspaceId } });

      expect(githubAuth.getGithubUsernameAndPAT).toHaveBeenCalledWith(
        testRepository.user.id,
        testRepository.workspace.slug
      );
    });

    it("should return 202 even when external service call fails", async () => {
      vi.mocked(stakgraphActions.triggerAsyncSync).mockResolvedValue({
        ok: false,
        status: 500,
        error: "External service unavailable",
      });

      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      const response = await POST(request, { params: { workspaceId } });

      // Webhook accepts request even if async sync fails
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.success).toBe(false);
    });
  });

  describe("Data Integrity", () => {
    it("should maintain repository foreign key relationships", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      await POST(request, { params: { workspaceId } });

      // Verify workspace relationship intact
      const repo = await db.repository.findUnique({
        where: { id: testRepository.repository.id },
        include: { workspace: true },
      });

      expect(repo?.workspace.id).toBe(workspaceId);
      expect(repo?.workspace.deletedAt).toBeNull();
    });

    it("should maintain swarm workspace relationship", async () => {
      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      await POST(request, { params: { workspaceId } });

      const swarm = await db.swarm.findUnique({
        where: { workspaceId },
        include: { workspace: true },
      });

      expect(swarm?.workspace.id).toBe(workspaceId);
    });

    it("should update timestamps correctly", async () => {
      const beforeUpdate = new Date();

      const payload = createGitHubPushPayload(
        "refs/heads/main",
        testRepository.repository.repositoryUrl
      );
      const validSignature = computeValidWebhookSignature(
        webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `/api/github/webhook/${workspaceId}`,
        payload,
        validSignature,
        testRepository.repository.githubWebhookId!
      );

      await POST(request, { params: { workspaceId } });

      const updatedRepo = await db.repository.findUnique({
        where: { id: testRepository.repository.id },
      });

      expect(updatedRepo?.updatedAt.getTime()).toBeGreaterThanOrEqual(
        beforeUpdate.getTime()
      );
    });
  });

  describe("Encryption Validation", () => {
    it("should store webhook secret encrypted", async () => {
      const repo = await db.repository.findUnique({
        where: { id: testRepository.repository.id },
      });

      expect(repo?.githubWebhookSecret).not.toBe(webhookSecret);
      expect(repo?.githubWebhookSecret).toContain('"data"');
      expect(repo?.githubWebhookSecret).toContain('"iv"');
      expect(repo?.githubWebhookSecret).toContain('"tag"');
    });

    it("should store swarm API key encrypted", async () => {
      const swarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      expect(swarm?.swarmApiKey).not.toBe(testRepository.swarmApiKey);
      expect(swarm?.swarmApiKey).toContain('"data"');
      expect(swarm?.swarmApiKey).toContain('"iv"');
      expect(swarm?.swarmApiKey).toContain('"tag"');
    });
  });
});
