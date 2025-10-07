import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/swarm/stakgraph/webhook/route";
import { db } from "@/lib/db";
import { EncryptionService, computeHmacSha256Hex } from "@/lib/encryption";
import { RepositoryStatus } from "@prisma/client";
import type { WebhookPayload } from "@/types";
import {
  generateUniqueId,
  generateUniqueSlug,
  createAuthenticatedSession,
  webhookTestHelpers,
  webhookFixtures,
} from "@/__tests__/support/helpers";

// Helper to create webhook request (kept for backwards compatibility)
function createWebhookRequest(payload: WebhookPayload, signature: string) {
  return webhookTestHelpers.createIntegrationWebhookRequest(payload, signature);
}

describe("POST /api/swarm/stakgraph/webhook - Integration Tests", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "swarm_webhook_test_key";

  let userId: string;
  let workspaceId: string;
  let swarmId: string;
  let repositoryUrl: string;
  let ingestRefId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    repositoryUrl = `https://github.com/test/webhook-repo-${generateUniqueId()}.git`;
    ingestRefId = `ingest-req-${generateUniqueId()}`;

    // Create test data atomically
    const testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: `test-swarm-${generateUniqueId()}`,
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: `https://test-swarm-${generateUniqueId()}.sphinx.chat/api`,
          swarmApiKey: JSON.stringify(enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY)),
          repositoryUrl,
          defaultBranch: "main",
          ingestRefId,
        },
      });

      const repository = await tx.repository.create({
        data: {
          name: "webhook-test-repo",
          repositoryUrl,
          workspaceId: workspace.id,
          status: RepositoryStatus.PENDING,
          branch: "main",
        },
      });

      return { user, workspace, swarm, repository };
    });

    userId = testData.user.id;
    workspaceId = testData.workspace.id;
    swarmId = testData.swarm.swarmId!;
  });

  describe("Signature Verification", () => {
    it("should accept webhooks with valid HMAC signature", async () => {
      const payload: WebhookPayload = {
        request_id: ingestRefId,
        status: "InProgress",
        progress: 50,
      };

      const body = JSON.stringify(payload);
      const signature = `sha256=${computeHmacSha256Hex(PLAINTEXT_SWARM_API_KEY, body)}`;
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it("should reject webhooks with invalid signature", async () => {
      const payload: WebhookPayload = {
        request_id: ingestRefId,
        status: "Complete",
        progress: 100,
      };

      const invalidSignature = "sha256=invalid-signature-hash";
      const request = createWebhookRequest(payload, invalidSignature);

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    it("should reject webhooks with tampered payload", async () => {
      const originalPayload: WebhookPayload = {
        request_id: ingestRefId,
        status: "Complete",
        progress: 100,
      };

      const body = JSON.stringify(originalPayload);
      const signature = `sha256=${computeHmacSha256Hex(PLAINTEXT_SWARM_API_KEY, body)}`;

      // Create request with tampered payload (different from signed payload)
      const tamperedPayload: WebhookPayload = {
        request_id: ingestRefId,
        status: "Failed",
        progress: 0,
      };

      const request = createWebhookRequest(tamperedPayload, signature);

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe("Swarm Lookup by IngestRefId", () => {
    it("should find swarm by ingestRefId", async () => {
      const payload: WebhookPayload = {
        request_id: ingestRefId,
        status: "Complete",
        progress: 100,
      };

      const body = JSON.stringify(payload);
      const signature = `sha256=${computeHmacSha256Hex(PLAINTEXT_SWARM_API_KEY, body)}`;
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify swarm was found and processed
      const swarm = await db.swarm.findFirst({
        where: { ingestRefId },
      });

      expect(swarm).toBeTruthy();
      expect(swarm?.ingestRefId).toBe(ingestRefId);
    });

    it("should reject webhooks for non-existent ingestRefId", async () => {
      const nonExistentRefId = `ingest-req-${generateUniqueId()}`;
      const payload: WebhookPayload = {
        request_id: nonExistentRefId,
        status: "Complete",
        progress: 100,
      };

      const body = JSON.stringify(payload);
      // Use a dummy signature since we won't find the swarm anyway
      const signature = "sha256=dummy-signature";
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });
  });

  describe("Status Propagation", () => {
    it("should update repository status to PENDING for InProgress webhook", async () => {
      const payload: WebhookPayload = {
        request_id: ingestRefId,
        status: "InProgress",
        progress: 50,
      };

      const body = JSON.stringify(payload);
      const signature = `sha256=${computeHmacSha256Hex(PLAINTEXT_SWARM_API_KEY, body)}`;
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify repository status updated
      const repository = await db.repository.findFirst({
        where: {
          repositoryUrl,
          workspaceId,
        },
      });

      expect(repository?.status).toBe(RepositoryStatus.PENDING);
    });

    it("should update repository status to SYNCED for Complete webhook", async () => {
      const payload: WebhookPayload = {
        request_id: ingestRefId,
        status: "Complete",
        progress: 100,
        result: { nodes: 1234, edges: 5678 },
        completed_at: "2024-01-01T12:00:00Z",
        duration_ms: 60000,
      };

      const body = JSON.stringify(payload);
      const signature = `sha256=${computeHmacSha256Hex(PLAINTEXT_SWARM_API_KEY, body)}`;
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify repository status updated to SYNCED
      const repository = await db.repository.findFirst({
        where: {
          repositoryUrl,
          workspaceId,
        },
      });

      expect(repository?.status).toBe(RepositoryStatus.SYNCED);
    });

    it("should update repository status to FAILED for Failed webhook", async () => {
      const payload: WebhookPayload = {
        request_id: ingestRefId,
        status: "Failed",
        progress: 75,
        error: "Repository not accessible",
      };

      const body = JSON.stringify(payload);
      const signature = `sha256=${computeHmacSha256Hex(PLAINTEXT_SWARM_API_KEY, body)}`;
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify repository status updated to FAILED
      const repository = await db.repository.findFirst({
        where: {
          repositoryUrl,
          workspaceId,
        },
      });

      expect(repository?.status).toBe(RepositoryStatus.FAILED);
    });

    it("should handle case-insensitive status values (COMPLETE uppercase)", async () => {
      const payload: WebhookPayload = {
        request_id: ingestRefId,
        status: "COMPLETE" as any,
        progress: 100,
      };

      const body = JSON.stringify(payload);
      const signature = `sha256=${computeHmacSha256Hex(PLAINTEXT_SWARM_API_KEY, body)}`;
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify repository status updated to SYNCED
      const repository = await db.repository.findFirst({
        where: {
          repositoryUrl,
          workspaceId,
        },
      });

      expect(repository?.status).toBe(RepositoryStatus.SYNCED);
    });

    it("should update swarm ingestRefId when processing webhook", async () => {
      const newIngestRefId = `ingest-req-${generateUniqueId()}`;
      
      // Update swarm with new ingestRefId
      await db.swarm.update({
        where: { workspaceId },
        data: { ingestRefId: newIngestRefId },
      });

      const payload: WebhookPayload = {
        request_id: newIngestRefId,
        status: "Complete",
        progress: 100,
      };

      const body = JSON.stringify(payload);
      const signature = `sha256=${computeHmacSha256Hex(PLAINTEXT_SWARM_API_KEY, body)}`;
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify swarm still has correct ingestRefId
      const swarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      expect(swarm?.ingestRefId).toBe(newIngestRefId);
    });
  });

  describe("Encrypted Field Handling", () => {
    it("should decrypt swarmApiKey for signature verification", async () => {
      const payload: WebhookPayload = {
        request_id: ingestRefId,
        status: "Complete",
        progress: 100,
      };

      const body = JSON.stringify(payload);
      // Use plaintext key to generate signature (since decryption happens in service)
      const signature = `sha256=${computeHmacSha256Hex(PLAINTEXT_SWARM_API_KEY, body)}`;
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify swarmApiKey is still encrypted in database
      const swarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      expect(swarm?.swarmApiKey).toBeTruthy();
      expect(swarm!.swarmApiKey).not.toContain(PLAINTEXT_SWARM_API_KEY);

      // Verify it can be decrypted
      const decryptedKey = enc.decryptField("swarmApiKey", swarm!.swarmApiKey!);
      expect(decryptedKey).toBe(PLAINTEXT_SWARM_API_KEY);
    });

    it("should reject webhooks when swarm has no API key", async () => {
      // Create swarm without API key
      const newWorkspace = await db.workspace.create({
        data: {
          name: "Test Workspace No Key",
          slug: generateUniqueSlug("test-workspace-no-key"),
          ownerId: userId,
        },
      });

      const newIngestRefId = `ingest-req-${generateUniqueId()}`;
      await db.swarm.create({
        data: {
          workspaceId: newWorkspace.id,
          name: `test-swarm-no-key-${generateUniqueId()}`,
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: `https://test-swarm-${generateUniqueId()}.sphinx.chat/api`,
          swarmApiKey: null,
          ingestRefId: newIngestRefId,
        },
      });

      const payload: WebhookPayload = {
        request_id: newIngestRefId,
        status: "Complete",
        progress: 100,
      };

      const body = JSON.stringify(payload);
      const signature = "sha256=any-signature";
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe("Repository Status Update Constraints", () => {
    it("should not update repository when swarm has no repositoryUrl", async () => {
      // Create swarm without repositoryUrl
      const newWorkspace = await db.workspace.create({
        data: {
          name: "Test Workspace No Repo",
          slug: generateUniqueSlug("test-workspace-no-repo"),
          ownerId: userId,
        },
      });

      const newIngestRefId = `ingest-req-${generateUniqueId()}`;
      await db.swarm.create({
        data: {
          workspaceId: newWorkspace.id,
          name: `test-swarm-no-repo-${generateUniqueId()}`,
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: `https://test-swarm-${generateUniqueId()}.sphinx.chat/api`,
          swarmApiKey: JSON.stringify(enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY)),
          repositoryUrl: null,
          ingestRefId: newIngestRefId,
        },
      });

      const payload: WebhookPayload = {
        request_id: newIngestRefId,
        status: "Complete",
        progress: 100,
      };

      const body = JSON.stringify(payload);
      const signature = `sha256=${computeHmacSha256Hex(PLAINTEXT_SWARM_API_KEY, body)}`;
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify no repositories were created or updated for this workspace
      const repositories = await db.repository.findMany({
        where: { workspaceId: newWorkspace.id },
      });

      expect(repositories).toHaveLength(0);
    });

    it("should update repository updatedAt timestamp", async () => {
      const originalRepository = await db.repository.findFirst({
        where: {
          repositoryUrl,
          workspaceId,
        },
      });

      const originalUpdatedAt = originalRepository!.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const payload: WebhookPayload = {
        request_id: ingestRefId,
        status: "Complete",
        progress: 100,
      };

      const body = JSON.stringify(payload);
      const signature = `sha256=${computeHmacSha256Hex(PLAINTEXT_SWARM_API_KEY, body)}`;
      const request = createWebhookRequest(payload, signature);

      await POST(request);

      // Verify updatedAt was changed
      const updatedRepository = await db.repository.findFirst({
        where: {
          repositoryUrl,
          workspaceId,
        },
      });

      expect(updatedRepository!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      // Mock database failure by using invalid workspaceId
      const payload: WebhookPayload = {
        request_id: "non-existent-ref-id",
        status: "Complete",
        progress: 100,
      };

      const body = JSON.stringify(payload);
      const signature = "sha256=invalid-signature";
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it("should handle decryption failures", async () => {
      // Create swarm with invalid encrypted data
      const newWorkspace = await db.workspace.create({
        data: {
          name: "Test Workspace Bad Encryption",
          slug: generateUniqueSlug("test-workspace-bad-enc"),
          ownerId: userId,
        },
      });

      const newIngestRefId = `ingest-req-${generateUniqueId()}`;
      await db.swarm.create({
        data: {
          workspaceId: newWorkspace.id,
          name: `test-swarm-bad-enc-${generateUniqueId()}`,
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: `https://test-swarm-${generateUniqueId()}.sphinx.chat/api`,
          swarmApiKey: "invalid-encrypted-data",
          ingestRefId: newIngestRefId,
        },
      });

      const payload: WebhookPayload = {
        request_id: newIngestRefId,
        status: "Complete",
        progress: 100,
      };

      const body = JSON.stringify(payload);
      const signature = "sha256=any-signature";
      const request = createWebhookRequest(payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });
});