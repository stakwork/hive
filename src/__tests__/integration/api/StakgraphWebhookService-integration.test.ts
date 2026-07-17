import { describe, it, expect, beforeEach, vi } from "vitest";
import { StakgraphWebhookService } from "@/services/swarm/StakgraphWebhookService";
import { db } from "@/lib/db";
import { EncryptionService, computeHmacSha256Hex } from "@/lib/encryption";
import { RepositoryStatus } from "@prisma/client";
import { generateUniqueId, generateUniqueSlug } from "@/__tests__/support/helpers";
import type { WebhookPayload } from "@/types";

/**
 * Integration tests for StakgraphWebhookService.processWebhook.
 *
 * These tests use a seeded database and real code paths (no wholesale db mock).
 * They verify that the terminal-status guard in updateStakgraphStatus correctly:
 *  - clears ingestRequestInProgress on terminal ("synced" / "failed") webhooks
 *  - leaves ingestRequestInProgress set on intermediate ("inprogress") webhooks
 */

describe("StakgraphWebhookService - integration", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_API_KEY = "swarm-webhook-secret-key";
  const INGEST_REF_ID = "ingest-ref-webhook-test";

  let workspaceId: string;
  let service: StakgraphWebhookService;

  beforeEach(async () => {
    vi.clearAllMocks();
    service = new StakgraphWebhookService();

    // Seed: user + workspace + swarm with ingestRequestInProgress: true
    const testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `webhook-user-${generateUniqueId()}@example.com`,
          name: "Webhook Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Webhook Test Workspace",
          slug: generateUniqueSlug("webhook-test"),
          ownerId: user.id,
        },
      });

      await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: `webhook-swarm-${generateUniqueId()}`,
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: `https://webhook-swarm-${generateUniqueId()}.sphinx.chat/api`,
          swarmApiKey: JSON.stringify(enc.encryptField("swarmApiKey", PLAINTEXT_API_KEY)),
          ingestRefId: INGEST_REF_ID,
          ingestRequestInProgress: true,
          agentRequestId: null,
          agentStatus: null,
        },
      });

      await tx.repository.create({
        data: {
          name: "webhook-repo",
          repositoryUrl: "https://github.com/test-org/webhook-repo",
          workspaceId: workspace.id,
          status: RepositoryStatus.PENDING,
          branch: "main",
        },
      });

      return { workspace };
    });

    workspaceId = testData.workspace.id;
  });

  /**
   * Helper: build a valid HMAC-SHA256 signature for the given payload body,
   * matching the algorithm used in StakgraphWebhookService.lookupAndVerifySwarm.
   */
  function buildSignature(body: string): string {
    const hex = computeHmacSha256Hex(PLAINTEXT_API_KEY, body);
    return `sha256=${hex}`;
  }

  it("should clear ingestRequestInProgress when a SYNCED terminal webhook is received", async () => {
    const payload: WebhookPayload = {
      request_id: INGEST_REF_ID,
      status: "synced",
      progress: 100,
      result: { nodes: 42, edges: 100 },
      error: null,
    };
    const rawBody = JSON.stringify(payload);
    const signature = buildSignature(rawBody);

    const result = await service.processWebhook(signature, rawBody, payload);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);

    const swarm = await db.swarm.findUnique({ where: { workspaceId } });
    expect(swarm?.ingestRequestInProgress).toBe(false);
  });

  it("should clear ingestRequestInProgress when a FAILED terminal webhook is received", async () => {
    const payload: WebhookPayload = {
      request_id: INGEST_REF_ID,
      status: "failed",
      progress: 0,
      result: null,
      error: "something went wrong",
    };
    const rawBody = JSON.stringify(payload);
    const signature = buildSignature(rawBody);

    const result = await service.processWebhook(signature, rawBody, payload);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);

    const swarm = await db.swarm.findUnique({ where: { workspaceId } });
    expect(swarm?.ingestRequestInProgress).toBe(false);
  });

  it("should leave ingestRequestInProgress true when an inprogress (non-terminal) webhook is received", async () => {
    const payload: WebhookPayload = {
      request_id: INGEST_REF_ID,
      status: "inprogress",
      progress: 50,
      result: null,
      error: null,
    };
    const rawBody = JSON.stringify(payload);
    const signature = buildSignature(rawBody);

    const result = await service.processWebhook(signature, rawBody, payload);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);

    // Flag must remain true — lock is still active while ingest is running
    const swarm = await db.swarm.findUnique({ where: { workspaceId } });
    expect(swarm?.ingestRequestInProgress).toBe(true);
  });
});
