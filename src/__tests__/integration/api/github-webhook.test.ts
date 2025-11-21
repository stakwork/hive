import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/webhook/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { triggerAsyncSync } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { RepositoryStatus } from "@prisma/client";
import {
  createTestRepository,
  createGitHubPushPayload,
  computeValidWebhookSignature,
  createWebhookRequest,
  testBranches,
  mockGitHubEvents,
} from "@/__tests__/support/fixtures/github-webhook";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock external services
vi.mock("@/services/swarm/stakgraph-actions", () => ({
  triggerAsyncSync: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

describe("GitHub Webhook Integration Tests - POST /api/github/webhook", () => {
  const webhookUrl = "http://localhost:3000/api/github/webhook";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("End-to-End Webhook Processing", () => {
    test("should successfully process webhook with valid signature and encrypted secret", async () => {
      // Create test data with real database operations
      const { repository, webhookSecret } = await createTestRepository({
        branch: "main",
        status: RepositoryStatus.SYNCED,
      });

      // Mock external services
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_integration_test",
      });

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "integration-req-123" },
      });

      // Create valid webhook request
      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, repository.githubWebhookId!);

      // Execute webhook handler
      const response = await POST(request as any);
      const data = await response.json();

      // Verify response
      expect(response.status).toBe(202);
      expect(data.success).toBe(true);

      // Verify repository status was updated
      const updatedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(updatedRepo?.status).toBe(RepositoryStatus.PENDING);

      // Verify triggerAsyncSync was called with correct parameters
      expect(triggerAsyncSync).toHaveBeenCalledWith(
        expect.stringContaining("test-swarm"),
        expect.any(String), // Decrypted API key
        repository.repositoryUrl,
        { username: "testuser", pat: "github_pat_integration_test" },
        expect.stringContaining("/api/swarm/stakgraph/webhook"),
      );

      // Verify swarm ingestRefId was updated
      const swarm = await db.swarm.findFirst({
        where: { workspaceId: repository.workspaceId },
      });
      expect(swarm?.ingestRefId).toBe("integration-req-123");
    });

    test("should reject webhook with invalid signature", async () => {
      const { repository } = await createTestRepository();

      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const invalidSignature = "sha256=invalid_signature_hash";

      const request = createWebhookRequest(webhookUrl, payload, invalidSignature, repository.githubWebhookId!);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);

      // Verify repository status was not updated
      const unchangedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(unchangedRepo?.status).toBe(RepositoryStatus.SYNCED);

      // Verify triggerAsyncSync was not called
      expect(triggerAsyncSync).not.toHaveBeenCalled();
    });

    test("should handle webhook with encrypted secrets correctly", async () => {
      const customWebhookSecret = "custom_secret_for_integration_test_12345";
      const { repository } = await createTestRepository({
        webhookSecret: customWebhookSecret,
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-encrypted-test" },
      });

      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(customWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, repository.githubWebhookId!);

      const response = await POST(request as any);

      expect(response.status).toBe(202);

      // Verify the encrypted secret was properly decrypted and used
      // The fact that signature validation passed confirms decryption worked
      expect(triggerAsyncSync).toHaveBeenCalled();
    });

    test("should filter non-allowed branches and not trigger sync", async () => {
      const { repository, webhookSecret } = await createTestRepository({
        branch: "main",
      });

      const payload = createGitHubPushPayload(
        testBranches.feature, // Feature branch not in allowed list
        repository.repositoryUrl,
      );
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, repository.githubWebhookId!);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);

      // Verify triggerAsyncSync was NOT called for filtered branch
      expect(triggerAsyncSync).not.toHaveBeenCalled();

      // Verify repository status was not updated
      const unchangedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(unchangedRepo?.status).toBe(RepositoryStatus.SYNCED);
    });

    test("should filter non-push events and not trigger sync", async () => {
      const { repository, webhookSecret } = await createTestRepository();

      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        repository.githubWebhookId!,
        mockGitHubEvents.pullRequest,
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
      expect(triggerAsyncSync).not.toHaveBeenCalled();
    });

    test("should process webhook for configured repository branch", async () => {
      const customBranch = "develop";
      const { repository, webhookSecret } = await createTestRepository({
        branch: customBranch,
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-custom-branch" },
      });

      const payload = createGitHubPushPayload(testBranches.develop, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, repository.githubWebhookId!);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
      expect(triggerAsyncSync).toHaveBeenCalled();
    });
  });

  describe("Database Integration", () => {
    test("should return 404 when workspace is deleted", async () => {
      const { repository, webhookSecret, workspace } = await createTestRepository();

      // Soft delete the workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, repository.githubWebhookId!);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(triggerAsyncSync).not.toHaveBeenCalled();
    });

    test("should lookup repository by githubWebhookId", async () => {
      const customWebhookId = "webhook-integration-test-456";
      const { repository, webhookSecret } = await createTestRepository({
        githubWebhookId: customWebhookId,
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);
      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-lookup-test" },
      });

      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, customWebhookId);

      const response = await POST(request as any);

      expect(response.status).toBe(202);

      // Verify the correct repository was found and processed
      const foundRepo = await db.repository.findFirst({
        where: { githubWebhookId: customWebhookId },
      });
      expect(foundRepo).toBeTruthy();
      expect(foundRepo?.id).toBe(repository.id);
    });

    test("should return 404 when repository does not exist in database", async () => {
      const nonExistentWebhookId = "webhook-does-not-exist-999";

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature("any_secret", body);

      const request = createWebhookRequest(webhookUrl, payload, signature, nonExistentWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
    });

    test("should handle missing swarm configuration", async () => {
      const { repository, webhookSecret } = await createTestRepository();

      // Delete swarm to simulate missing configuration
      await db.swarm.deleteMany({
        where: { workspaceId: repository.workspaceId },
      });

      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, repository.githubWebhookId!);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(triggerAsyncSync).not.toHaveBeenCalled();
    });
  });

  describe("Encryption Integration", () => {
    test("should properly decrypt webhook secret for signature verification", async () => {
      const encryptionService = EncryptionService.getInstance();
      const plainSecret = "super_secret_webhook_key_12345";

      const { repository } = await createTestRepository({
        webhookSecret: plainSecret,
      });

      // Verify secret is stored encrypted
      const storedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(storedRepo?.githubWebhookSecret).toBeTruthy();
      expect(storedRepo?.githubWebhookSecret).not.toContain(plainSecret);

      // Verify we can decrypt it
      const decrypted = encryptionService.decryptField("githubWebhookSecret", storedRepo!.githubWebhookSecret!);
      expect(decrypted).toBe(plainSecret);

      // Verify webhook processing uses decrypted secret correctly
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);
      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-decrypt-test" },
      });

      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(plainSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, repository.githubWebhookId!);

      const response = await POST(request as any);

      expect(response.status).toBe(202);
    });

    test("should properly decrypt swarm API key for async sync", async () => {
      const { repository, webhookSecret } = await createTestRepository();

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      const mockAsyncSync = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-api-key-test" },
      });
      vi.mocked(triggerAsyncSync).mockImplementation(mockAsyncSync);

      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, repository.githubWebhookId!);

      await POST(request as any);

      // Verify triggerAsyncSync received decrypted API key
      expect(mockAsyncSync).toHaveBeenCalled();
      const apiKeyArg = mockAsyncSync.mock.calls[0][1];
      expect(apiKeyArg).toBeTruthy();
      expect(typeof apiKeyArg).toBe("string");
      // Should not contain encryption metadata
      expect(apiKeyArg).not.toContain("data");
      expect(apiKeyArg).not.toContain("iv");
    });
  });

  describe("GitHub Credentials Integration", () => {
    test("should fetch GitHub credentials when workspace owner exists", async () => {
      const testUser = await createTestUser({
        name: "Webhook Test User",
        withGitHubAuth: true,
        githubUsername: "webhook-test-user",
      });

      const { repository, webhookSecret, workspace } = await createTestRepository();

      // Update workspace to have real owner
      await db.workspace.update({
        where: { id: workspace.id },
        data: { ownerId: testUser.id },
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "webhook-test-user",
        token: "github_pat_real_user",
      });

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-creds-test" },
      });

      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, repository.githubWebhookId!);

      await POST(request as any);

      // Verify getGithubUsernameAndPAT was called
      expect(getGithubUsernameAndPAT).toHaveBeenCalledWith(testUser.id, workspace.slug);

      // Verify credentials were passed to triggerAsyncSync
      expect(triggerAsyncSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        { username: "webhook-test-user", pat: "github_pat_real_user" },
        expect.any(String),
      );
    });

    test("should trigger sync without credentials when user has none", async () => {
      const { repository, webhookSecret } = await createTestRepository();

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-no-creds" },
      });

      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, repository.githubWebhookId!);

      const response = await POST(request as any);

      expect(response.status).toBe(202);

      // Verify triggerAsyncSync was called without credentials
      expect(triggerAsyncSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        undefined, // No credentials
        expect.any(String),
      );
    });
  });

  describe("Callback URL Integration", () => {
    test("should include callback URL in triggerAsyncSync call", async () => {
      const { repository, webhookSecret } = await createTestRepository();

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      const mockAsyncSync = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-callback-test" },
      });
      vi.mocked(triggerAsyncSync).mockImplementation(mockAsyncSync);

      const payload = createGitHubPushPayload(testBranches.main, repository.repositoryUrl);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, repository.githubWebhookId!);

      await POST(request as any);

      // Verify callback URL was included
      expect(mockAsyncSync).toHaveBeenCalled();
      const callbackUrl = mockAsyncSync.mock.calls[0][4];
      expect(callbackUrl).toBeTruthy();
      expect(callbackUrl).toContain("/api/swarm/stakgraph/webhook");
    });
  });
});
