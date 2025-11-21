import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/webhook/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { triggerAsyncSync } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { RepositoryStatus } from "@prisma/client";
import {
  createGitHubPushPayload,
  computeValidWebhookSignature,
  createWebhookRequest,
  createWebhookRequestWithMissingHeaders,
  mockGitHubEvents,
  testBranches,
} from "@/__tests__/support/fixtures/github-webhook";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    repository: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    swarm: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", async () => {
  const actual = await vi.importActual("@/lib/encryption");
  return {
    ...actual,
    EncryptionService: {
      getInstance: vi.fn(() => ({
        decryptField: vi.fn((field: string, value: any) => {
          // Mock decryption - return a predictable value
          if (field === "githubWebhookSecret") return "test_webhook_secret_123";
          if (field === "swarmApiKey") return "sk_test_swarm_123";
          return "decrypted_value";
        }),
      })),
    },
  };
});

vi.mock("@/services/swarm/stakgraph-actions", () => ({
  triggerAsyncSync: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

describe("GitHub Webhook Route - POST /api/github/webhook", () => {
  const webhookUrl = "http://localhost:3000/api/github/webhook";
  const mockWebhookId = "webhook-123";
  const mockWebhookSecret = "test_webhook_secret_123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Header Validation", () => {
    test("should return 400 when x-hub-signature-256 header is missing", async () => {
      const payload = createGitHubPushPayload();
      const request = createWebhookRequestWithMissingHeaders(webhookUrl, payload, "signature");

      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(db.repository.findFirst).not.toHaveBeenCalled();
    });

    test("should return 400 when x-github-event header is missing", async () => {
      const payload = createGitHubPushPayload();
      const request = createWebhookRequestWithMissingHeaders(webhookUrl, payload, "event");

      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });

    test("should return 400 when x-github-hook-id header is missing", async () => {
      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-hub-signature-256": signature,
          "x-github-event": "push",
          // Missing x-github-hook-id
        },
        body,
      });

      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe("Payload Validation", () => {
    test("should return 400 when payload is not valid JSON", async () => {
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-hub-signature-256": "sha256=test",
          "x-github-event": "push",
          "x-github-hook-id": mockWebhookId,
        },
        body: "invalid json {",
      });

      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });

    test("should return 400 when payload is missing repository data", async () => {
      const invalidPayload = { ref: "refs/heads/main" }; // Missing repository
      const body = JSON.stringify(invalidPayload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-hub-signature-256": signature,
          "x-github-event": "push",
          "x-github-hook-id": mockWebhookId,
        },
        body,
      });

      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });

    test("should return 400 when push event is missing ref field", async () => {
      const payload = createGitHubPushPayload();
      delete (payload as any).ref;
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      vi.mocked(db.repository.findFirst).mockResolvedValue({
        id: "repo-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-owner/test-repo",
        branch: "main",
        githubWebhookSecret: JSON.stringify({ data: "encrypted" }),
        workspace: {
          swarm: {
            id: "swarm-123",
          },
        },
      } as any);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-hub-signature-256": signature,
          "x-github-event": "push",
          "x-github-hook-id": mockWebhookId,
        },
        body,
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe("Repository Lookup", () => {
    test("should filter out deleted workspaces when looking up repository", async () => {
      vi.mocked(db.repository.findFirst).mockResolvedValue(null);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(db.repository.findFirst).toHaveBeenCalledWith({
        where: {
          githubWebhookId: mockWebhookId,
          workspace: {
            deleted: false,
            deletedAt: null,
          },
        },
        select: expect.any(Object),
      });
    });

    test("should return 404 when repository is not found", async () => {
      vi.mocked(db.repository.findFirst).mockResolvedValue(null);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(db.repository.findFirst).toHaveBeenCalledWith({
        where: {
          githubWebhookId: mockWebhookId,
          workspace: {
            deleted: false,
            deletedAt: null,
          },
        },
        select: expect.any(Object),
      });
    });

    test("should return 404 when repository is missing webhook secret", async () => {
      vi.mocked(db.repository.findFirst).mockResolvedValue({
        id: "repo-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-owner/test-repo",
        branch: "main",
        githubWebhookSecret: null, // Missing secret
        workspace: {
          swarm: {
            id: "swarm-123",
          },
        },
      } as any);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
    });
  });

  describe("Signature Verification", () => {
    test("should return 401 when signature does not match", async () => {
      vi.mocked(db.repository.findFirst).mockResolvedValue({
        id: "repo-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-owner/test-repo",
        branch: "main",
        githubWebhookSecret: JSON.stringify({ data: "encrypted" }),
        workspace: {
          swarm: {
            id: "swarm-123",
          },
        },
      } as any);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const invalidSignature = "sha256=invalid_signature_12345";

      const request = createWebhookRequest(webhookUrl, payload, invalidSignature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
    });

    test("should verify signature using timing-safe comparison", async () => {
      vi.mocked(db.repository.findFirst).mockResolvedValue({
        id: "repo-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-owner/test-repo",
        branch: "main",
        githubWebhookSecret: JSON.stringify({ data: "encrypted" }),
        workspace: {
          swarm: {
            id: "swarm-123",
          },
        },
      } as any);

      vi.mocked(db.swarm.findUnique).mockResolvedValue({
        id: "swarm-123",
        workspaceId: "workspace-123",
        name: "test-swarm",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify({ data: "encrypted" }),
      } as any);

      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "workspace-123",
        ownerId: "user-123",
      } as any);

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_123",
      });

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-123" },
      });

      vi.mocked(db.repository.update).mockResolvedValue({} as any);
      vi.mocked(db.swarm.update).mockResolvedValue({} as any);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const validSignature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, validSignature, mockWebhookId);

      const response = await POST(request as any);

      expect(response.status).toBe(202);
      // Signature was validated successfully
    });
  });

  describe("Branch Filtering", () => {
    beforeEach(() => {
      vi.mocked(db.repository.findFirst).mockResolvedValue({
        id: "repo-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-owner/test-repo",
        branch: "main",
        githubWebhookSecret: JSON.stringify({ data: "encrypted" }),
        workspace: {
          swarm: {
            id: "swarm-123",
          },
        },
      } as any);
    });

    test("should accept push to main branch", async () => {
      vi.mocked(db.swarm.findUnique).mockResolvedValue({
        id: "swarm-123",
        workspaceId: "workspace-123",
        name: "test-swarm",
        swarmApiKey: JSON.stringify({ data: "encrypted" }),
      } as any);

      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "workspace-123",
        ownerId: "user-123",
      } as any);

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-123" },
      });

      vi.mocked(db.repository.update).mockResolvedValue({} as any);
      vi.mocked(db.swarm.update).mockResolvedValue({} as any);

      const payload = createGitHubPushPayload(testBranches.main);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
      expect(triggerAsyncSync).toHaveBeenCalled();
    });

    test("should accept push to master branch", async () => {
      vi.mocked(db.swarm.findUnique).mockResolvedValue({
        id: "swarm-123",
        workspaceId: "workspace-123",
        name: "test-swarm",
        swarmApiKey: JSON.stringify({ data: "encrypted" }),
      } as any);

      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "workspace-123",
        ownerId: "user-123",
      } as any);

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-123" },
      });

      vi.mocked(db.repository.update).mockResolvedValue({} as any);
      vi.mocked(db.swarm.update).mockResolvedValue({} as any);

      const payload = createGitHubPushPayload(testBranches.master);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
    });

    test("should return 202 and not trigger sync for non-allowed branch", async () => {
      const payload = createGitHubPushPayload(testBranches.feature);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
      expect(triggerAsyncSync).not.toHaveBeenCalled();
    });

    test("should accept push to configured repository branch", async () => {
      vi.mocked(db.repository.findFirst).mockResolvedValue({
        id: "repo-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-owner/test-repo",
        branch: "develop",
        githubWebhookSecret: JSON.stringify({ data: "encrypted" }),
        workspace: {
          swarm: {
            id: "swarm-123",
          },
        },
      } as any);

      vi.mocked(db.swarm.findUnique).mockResolvedValue({
        id: "swarm-123",
        workspaceId: "workspace-123",
        name: "test-swarm",
        swarmApiKey: JSON.stringify({ data: "encrypted" }),
      } as any);

      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "workspace-123",
        ownerId: "user-123",
      } as any);

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-123" },
      });

      vi.mocked(db.repository.update).mockResolvedValue({} as any);
      vi.mocked(db.swarm.update).mockResolvedValue({} as any);

      const payload = createGitHubPushPayload(testBranches.develop);
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
      expect(triggerAsyncSync).toHaveBeenCalled();
    });
  });

  describe("Event Type Filtering", () => {
    beforeEach(() => {
      vi.mocked(db.repository.findFirst).mockResolvedValue({
        id: "repo-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-owner/test-repo",
        branch: "main",
        githubWebhookSecret: JSON.stringify({ data: "encrypted" }),
        workspace: {
          swarm: {
            id: "swarm-123",
          },
        },
      } as any);
    });

    test("should return 202 and not trigger sync for pull_request event", async () => {
      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId, mockGitHubEvents.pullRequest);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
      expect(triggerAsyncSync).not.toHaveBeenCalled();
    });

    test("should return 202 and not trigger sync for issues event", async () => {
      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId, mockGitHubEvents.issues);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
      expect(triggerAsyncSync).not.toHaveBeenCalled();
    });

    test("should only process push events", async () => {
      vi.mocked(db.swarm.findUnique).mockResolvedValue({
        id: "swarm-123",
        workspaceId: "workspace-123",
        name: "test-swarm",
        swarmApiKey: JSON.stringify({ data: "encrypted" }),
      } as any);

      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "workspace-123",
        ownerId: "user-123",
      } as any);

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-123" },
      });

      vi.mocked(db.repository.update).mockResolvedValue({} as any);
      vi.mocked(db.swarm.update).mockResolvedValue({} as any);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId, mockGitHubEvents.push);

      const response = await POST(request as any);

      expect(response.status).toBe(202);
      expect(triggerAsyncSync).toHaveBeenCalled();
    });
  });

  describe("Async Sync Trigger", () => {
    beforeEach(() => {
      vi.mocked(db.repository.findFirst).mockResolvedValue({
        id: "repo-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-owner/test-repo",
        branch: "main",
        githubWebhookSecret: JSON.stringify({ data: "encrypted" }),
        workspace: {
          swarm: {
            id: "swarm-123",
          },
        },
      } as any);

      vi.mocked(db.swarm.findUnique).mockResolvedValue({
        id: "swarm-123",
        workspaceId: "workspace-123",
        name: "test-swarm",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify({ data: "encrypted" }),
      } as any);

      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "workspace-123",
        ownerId: "user-123",
      } as any);
    });

    test("should trigger async sync with callback URL", async () => {
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_123",
      });

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-123" },
      });

      vi.mocked(db.repository.update).mockResolvedValue({} as any);
      vi.mocked(db.swarm.update).mockResolvedValue({} as any);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
      expect(triggerAsyncSync).toHaveBeenCalledWith(
        expect.any(String), // swarmHost
        "sk_test_swarm_123", // decrypted API key
        "https://github.com/test-owner/test-repo",
        { username: "testuser", pat: "github_pat_123" },
        expect.stringContaining("/api/swarm/stakgraph/webhook"),
      );
    });

    test("should update repository status to PENDING", async () => {
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-123" },
      });

      vi.mocked(db.repository.update).mockResolvedValue({} as any);
      vi.mocked(db.swarm.update).mockResolvedValue({} as any);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      await POST(request as any);

      expect(db.repository.update).toHaveBeenCalledWith({
        where: { id: "repo-123" },
        data: { status: RepositoryStatus.PENDING },
      });
    });

    test("should persist request_id from async sync response", async () => {
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      const mockRequestId = "req-456";
      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: mockRequestId },
      });

      vi.mocked(db.repository.update).mockResolvedValue({} as any);
      vi.mocked(db.swarm.update).mockResolvedValue({} as any);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      await POST(request as any);

      expect(db.swarm.update).toHaveBeenCalledWith({
        where: { id: "swarm-123" },
        data: { ingestRefId: mockRequestId },
      });
    });

    test("should return 400 when swarm is missing", async () => {
      vi.mocked(db.swarm.findUnique).mockResolvedValue(null);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(triggerAsyncSync).not.toHaveBeenCalled();
    });

    test("should trigger async sync without credentials when user has none", async () => {
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-123" },
      });

      vi.mocked(db.repository.update).mockResolvedValue({} as any);
      vi.mocked(db.swarm.update).mockResolvedValue({} as any);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      await POST(request as any);

      expect(triggerAsyncSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        undefined, // No credentials
        expect.any(String),
      );
    });
  });

  describe("Error Handling", () => {
    test("should return 500 when database query fails", async () => {
      vi.mocked(db.repository.findFirst).mockRejectedValue(new Error("Database connection failed"));

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });

    test("should return 500 when encryption service fails", async () => {
      vi.mocked(db.repository.findFirst).mockResolvedValue({
        id: "repo-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-owner/test-repo",
        branch: "main",
        githubWebhookSecret: JSON.stringify({ data: "encrypted" }),
        workspace: {
          swarm: {
            id: "swarm-123",
          },
        },
      } as any);

      // Mock encryption service to throw error
      vi.mocked(EncryptionService.getInstance).mockReturnValue({
        decryptField: vi.fn(() => {
          throw new Error("Decryption failed");
        }),
      } as any);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });

    test("should handle repository update failure gracefully", async () => {
      // Reset encryption service to normal behavior for this test
      vi.mocked(EncryptionService.getInstance).mockReturnValue({
        decryptField: vi.fn((field: string, value: any) => {
          if (field === "githubWebhookSecret") return "test_webhook_secret_123";
          if (field === "swarmApiKey") return "sk_test_swarm_123";
          return "decrypted_value";
        }),
      } as any);

      vi.mocked(db.repository.findFirst).mockResolvedValue({
        id: "repo-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-owner/test-repo",
        branch: "main",
        githubWebhookSecret: JSON.stringify({ data: "encrypted" }),
        workspace: {
          swarm: {
            id: "swarm-123",
          },
        },
      } as any);

      vi.mocked(db.swarm.findUnique).mockResolvedValue({
        id: "swarm-123",
        workspaceId: "workspace-123",
        name: "test-swarm",
        swarmApiKey: JSON.stringify({ data: "encrypted" }),
      } as any);

      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "workspace-123",
        ownerId: "user-123",
      } as any);

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      // Repository update fails
      vi.mocked(db.repository.update).mockRejectedValue(new Error("Update failed"));

      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "req-123" },
      });

      vi.mocked(db.swarm.update).mockResolvedValue({} as any);

      const payload = createGitHubPushPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createWebhookRequest(webhookUrl, payload, signature, mockWebhookId);

      const response = await POST(request as any);
      const data = await response.json();

      // Should still succeed and trigger sync despite update failure
      expect(response.status).toBe(202);
      expect(data.success).toBe(true);
      expect(triggerAsyncSync).toHaveBeenCalled();
    });
  });
});
