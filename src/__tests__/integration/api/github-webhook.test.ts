import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST as ensureWebhook } from "@/app/api/github/webhook/ensure/route";
import { POST as receiveWebhook } from "@/app/api/github/webhook/route";
import { db } from "@/lib/db";
import { EncryptionService, computeHmacSha256Hex } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  getMockedSession,
  createPostRequest,
  generateUniqueId,
  expectSuccess,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock next-auth
vi.mock("next-auth/next");

// Mock GitHub App utilities
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

// Mock swarm actions
vi.mock("@/services/swarm/stakgraph-actions", () => ({
  triggerAsyncSync: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    data: { request_id: "test-request-id" },
  }),
}));

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GitHub Webhook Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();
  let testUser: any;
  let testWorkspace: any;
  let testRepository: any;
  let testSwarm: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test user
    testUser = await createTestUser({
      name: "Test User",
      email: `test-${generateUniqueId()}@example.com`,
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: `test-workspace-${generateUniqueId()}`,
        ownerId: testUser.id,
      },
    });

    // Create test swarm
    testSwarm = await db.swarm.create({
      data: {
        name: `test-swarm-${generateUniqueId()}`,
        workspaceId: testWorkspace.id,
        status: "ACTIVE",
        swarmApiKey: JSON.stringify(
          encryptionService.encryptField("swarmApiKey", "test-swarm-key")
        ),
        defaultBranch: "main",
      },
    });

    // Create test repository
    testRepository = await db.repository.create({
      data: {
        name: "test-repo",
        repositoryUrl: "https://github.com/test-org/test-repo",
        workspaceId: testWorkspace.id,
        branch: "main",
        status: "PENDING",
      },
    });

    // Mock GitHub API token
    vi.mocked(require("@/lib/githubApp").getUserAppTokens).mockResolvedValue({
      accessToken: "ghu_test_token",
    });
  });

  describe("Webhook Setup Integration", () => {
    test("should setup webhook end-to-end with encrypted secret storage", async () => {
      const mockWebhookId = 123456789;

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API: list hooks (empty) then create hook
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: mockWebhookId }),
        });

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: testWorkspace.id,
          repositoryUrl: testRepository.repositoryUrl,
        }
      );

      const response = await ensureWebhook(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(mockWebhookId);

      // Verify webhook was stored in database
      const updatedRepo = await db.repository.findUnique({
        where: { id: testRepository.id },
      });

      expect(updatedRepo?.githubWebhookId).toBe(String(mockWebhookId));
      expect(updatedRepo?.githubWebhookSecret).toBeDefined();

      // Verify secret is encrypted
      const secretData = JSON.parse(updatedRepo?.githubWebhookSecret || "{}");
      expect(secretData.data).toBeDefined();
      expect(secretData.iv).toBeDefined();
      expect(secretData.tag).toBeDefined();

      // Verify secret can be decrypted
      const decryptedSecret = encryptionService.decryptField(
        "githubWebhookSecret",
        updatedRepo?.githubWebhookSecret || ""
      );
      expect(decryptedSecret).toHaveLength(64); // 32 bytes = 64 hex chars
    });

    test("should update existing webhook when callback URL matches", async () => {
      const mockWebhookId = 987654321;
      const existingSecret = "a".repeat(64);

      // Setup existing webhook in database
      await db.repository.update({
        where: { id: testRepository.id },
        data: {
          githubWebhookId: String(mockWebhookId),
          githubWebhookSecret: JSON.stringify(
            encryptionService.encryptField("githubWebhookSecret", existingSecret)
          ),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API: list hooks returns existing webhook
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: mockWebhookId,
              config: { url: "http://localhost:3000/api/github/webhook" },
            },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: testWorkspace.id,
          repositoryUrl: testRepository.repositoryUrl,
        }
      );

      const response = await ensureWebhook(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(mockWebhookId);

      // Verify secret was reused
      const updatedRepo = await db.repository.findUnique({
        where: { id: testRepository.id },
      });

      const decryptedSecret = encryptionService.decryptField(
        "githubWebhookSecret",
        updatedRepo?.githubWebhookSecret || ""
      );
      expect(decryptedSecret).toBe(existingSecret);
    });
  });

  describe("Webhook Receipt Integration", () => {
    let webhookSecret: string;

    beforeEach(async () => {
      webhookSecret = "b".repeat(64);

      // Setup repository with webhook
      await db.repository.update({
        where: { id: testRepository.id },
        data: {
          githubWebhookId: "123456",
          githubWebhookSecret: JSON.stringify(
            encryptionService.encryptField("githubWebhookSecret", webhookSecret)
          ),
        },
      });
    });

    test("should validate HMAC signature using timingSafeEqual", async () => {
      const payload = {
        ref: "refs/heads/main",
        repository: {
          html_url: testRepository.repositoryUrl,
          full_name: "test-org/test-repo",
          default_branch: "main",
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeHmacSha256Hex(webhookSecret, rawBody);

      const request = new Request("http://localhost:3000/api/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${signature}`,
          "x-github-event": "push",
          "x-github-hook-id": "123456",
          "x-github-delivery": "test-delivery-id",
        },
        body: rawBody,
      });

      const response = await receiveWebhook(request);

      expect(response.status).toBe(202);
      const data = await response.json();
      expect(data.success).toBeDefined();
    });

    test("should reject webhook with invalid signature", async () => {
      const payload = {
        ref: "refs/heads/main",
        repository: {
          html_url: testRepository.repositoryUrl,
          full_name: "test-org/test-repo",
          default_branch: "main",
        },
      };

      const rawBody = JSON.stringify(payload);
      const invalidSignature = "invalid-signature";

      const request = new Request("http://localhost:3000/api/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${invalidSignature}`,
          "x-github-event": "push",
          "x-github-hook-id": "123456",
          "x-github-delivery": "test-delivery-id",
        },
        body: rawBody,
      });

      const response = await receiveWebhook(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
    });

    test("should reject webhook with tampered payload", async () => {
      const payload = {
        ref: "refs/heads/main",
        repository: {
          html_url: testRepository.repositoryUrl,
          full_name: "test-org/test-repo",
          default_branch: "main",
        },
      };

      const originalBody = JSON.stringify(payload);
      const signature = computeHmacSha256Hex(webhookSecret, originalBody);

      // Tamper with payload after signing
      const tamperedPayload = { ...payload, ref: "refs/heads/malicious" };
      const tamperedBody = JSON.stringify(tamperedPayload);

      const request = new Request("http://localhost:3000/api/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${signature}`,
          "x-github-event": "push",
          "x-github-hook-id": "123456",
          "x-github-delivery": "test-delivery-id",
        },
        body: tamperedBody,
      });

      const response = await receiveWebhook(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
    });

    test("should handle branch filtering correctly", async () => {
      const testCases = [
        { branch: "main", shouldProcess: true },
        { branch: "master", shouldProcess: true },
        { branch: "develop", shouldProcess: false },
        { branch: "feature/test", shouldProcess: false },
      ];

      for (const { branch, shouldProcess } of testCases) {
        const payload = {
          ref: `refs/heads/${branch}`,
          repository: {
            html_url: testRepository.repositoryUrl,
            full_name: "test-org/test-repo",
            default_branch: "main",
          },
        };

        const rawBody = JSON.stringify(payload);
        const signature = computeHmacSha256Hex(webhookSecret, rawBody);

        const request = new Request("http://localhost:3000/api/github/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": `sha256=${signature}`,
            "x-github-event": "push",
            "x-github-hook-id": "123456",
            "x-github-delivery": `test-delivery-${branch}`,
          },
          body: rawBody,
        });

        const response = await receiveWebhook(request);

        expect(response.status).toBe(202);

        if (shouldProcess) {
          const { triggerAsyncSync } = require("@/services/swarm/stakgraph-actions");
          expect(triggerAsyncSync).toHaveBeenCalled();
        }
      }
    });

    test("should update repository status to PENDING on webhook receipt", async () => {
      const payload = {
        ref: "refs/heads/main",
        repository: {
          html_url: testRepository.repositoryUrl,
          full_name: "test-org/test-repo",
          default_branch: "main",
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeHmacSha256Hex(webhookSecret, rawBody);

      const request = new Request("http://localhost:3000/api/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${signature}`,
          "x-github-event": "push",
          "x-github-hook-id": "123456",
          "x-github-delivery": "test-delivery-id",
        },
        body: rawBody,
      });

      await receiveWebhook(request);

      const updatedRepo = await db.repository.findUnique({
        where: { id: testRepository.id },
      });

      expect(updatedRepo?.status).toBe("PENDING");
    });

    test("should return 400 for missing required headers", async () => {
      const headerTestCases = [
        { headers: {}, description: "all headers missing" },
        {
          headers: { "x-hub-signature-256": "sha256=test" },
          description: "missing event header",
        },
        {
          headers: { "x-github-event": "push" },
          description: "missing signature header",
        },
        {
          headers: {
            "x-hub-signature-256": "sha256=test",
            "x-github-event": "push",
          },
          description: "missing hook ID header",
        },
      ];

      for (const { headers, description } of headerTestCases) {
        const request = new Request("http://localhost:3000/api/github/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify({}),
        });

        const response = await receiveWebhook(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
      }
    });

    test("should return 404 for repository not found", async () => {
      const payload = {
        ref: "refs/heads/main",
        repository: {
          html_url: "https://github.com/nonexistent/repo",
          full_name: "nonexistent/repo",
          default_branch: "main",
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeHmacSha256Hex(webhookSecret, rawBody);

      const request = new Request("http://localhost:3000/api/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${signature}`,
          "x-github-event": "push",
          "x-github-hook-id": "999999",
          "x-github-delivery": "test-delivery-id",
        },
        body: rawBody,
      });

      const response = await receiveWebhook(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
    });

    test("should return 202 for non-push events", async () => {
      const eventTypes = ["pull_request", "issues", "create", "delete"];

      for (const eventType of eventTypes) {
        const payload = {
          repository: {
            html_url: testRepository.repositoryUrl,
            full_name: "test-org/test-repo",
          },
        };

        const rawBody = JSON.stringify(payload);
        const signature = computeHmacSha256Hex(webhookSecret, rawBody);

        const request = new Request("http://localhost:3000/api/github/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": `sha256=${signature}`,
            "x-github-event": eventType,
            "x-github-hook-id": "123456",
            "x-github-delivery": `test-delivery-${eventType}`,
          },
          body: rawBody,
        });

        const response = await receiveWebhook(request);

        expect(response.status).toBe(202);
      }
    });
  });

  describe("Error Handling", () => {
    test("should handle missing webhook secret in database", async () => {
      await db.repository.update({
        where: { id: testRepository.id },
        data: {
          githubWebhookId: "123456",
          githubWebhookSecret: null,
        },
      });

      const payload = {
        ref: "refs/heads/main",
        repository: {
          html_url: testRepository.repositoryUrl,
          full_name: "test-org/test-repo",
          default_branch: "main",
        },
      };

      const rawBody = JSON.stringify(payload);

      const request = new Request("http://localhost:3000/api/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": "sha256=test",
          "x-github-event": "push",
          "x-github-hook-id": "123456",
          "x-github-delivery": "test-delivery-id",
        },
        body: rawBody,
      });

      const response = await receiveWebhook(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
    });

    test("should handle invalid JSON payload", async () => {
      const request = new Request("http://localhost:3000/api/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": "sha256=test",
          "x-github-event": "push",
          "x-github-hook-id": "123456",
          "x-github-delivery": "test-delivery-id",
        },
        body: "invalid json {",
      });

      const response = await receiveWebhook(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });
});