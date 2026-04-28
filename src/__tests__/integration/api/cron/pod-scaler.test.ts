import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { GET } from "@/app/api/cron/pod-scaler/route";
import { NextRequest } from "next/server";
import {
  resetDatabase,
  createTestUser,
  createTestWorkspace,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import { upsertTestPlatformConfig } from "@/__tests__/support/factories";
import { POD_SCALER_CONFIG_KEYS } from "@/lib/constants/pod-scaler";

/**
 * Integration tests for GET /api/cron/pod-scaler endpoint
 *
 * Tests verify:
 * - Authentication via CRON_SECRET (Bearer token)
 * - Swarms with soft-deleted workspaces are excluded from processing
 * - Stale tasks (updatedAt > 30 days ago) are excluded from overQueuedCount
 * - Fresh tasks within 30 days are counted correctly
 * - Active swarms with valid workspaces continue to be processed normally
 */

// Mock the Pool Manager fetch call so no real HTTP requests are made
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function createMockRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) {
    headers.set("authorization", authHeader);
  }
  return new NextRequest("http://localhost:3000/api/cron/pod-scaler", {
    headers,
  });
}

describe("GET /api/cron/pod-scaler", () => {
  let originalCronSecret: string | undefined;
  let originalEncryptionKey: string | undefined;
  let originalEncryptionKeyId: string | undefined;
  let originalPoolManagerUrl: string | undefined;

  beforeEach(async () => {
    originalCronSecret = process.env.CRON_SECRET;
    originalEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
    originalEncryptionKeyId = process.env.TOKEN_ENCRYPTION_KEY_ID;
    originalPoolManagerUrl = process.env.POOL_MANAGER_BASE_URL;

    process.env.CRON_SECRET = "test-scaler-secret";
    process.env.TOKEN_ENCRYPTION_KEY =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    process.env.TOKEN_ENCRYPTION_KEY_ID = "k-test";
    process.env.POOL_MANAGER_BASE_URL = "https://pool-manager.example.com";

    await resetDatabase();
    vi.clearAllMocks();

    // Default: Pool Manager scale call succeeds
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "OK",
      json: async () => ({ success: true }),
    });
  });

  afterEach(() => {
    if (originalCronSecret !== undefined) {
      process.env.CRON_SECRET = originalCronSecret;
    } else {
      delete process.env.CRON_SECRET;
    }
    if (originalEncryptionKey !== undefined) {
      process.env.TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
    } else {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    }
    if (originalEncryptionKeyId !== undefined) {
      process.env.TOKEN_ENCRYPTION_KEY_ID = originalEncryptionKeyId;
    } else {
      delete process.env.TOKEN_ENCRYPTION_KEY_ID;
    }
    if (originalPoolManagerUrl !== undefined) {
      process.env.POOL_MANAGER_BASE_URL = originalPoolManagerUrl;
    } else {
      delete process.env.POOL_MANAGER_BASE_URL;
    }
  });

  describe("Authorization", () => {
    it("should return 401 without an authorization header", async () => {
      const request = createMockRequest();
      const response = await GET(request);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should return 401 with an incorrect CRON_SECRET", async () => {
      const request = createMockRequest("Bearer wrong-secret");
      const response = await GET(request);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should accept requests with a valid CRON_SECRET", async () => {
      const request = createMockRequest("Bearer test-scaler-secret");
      const response = await GET(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("success");
      expect(body).toHaveProperty("swarmsProcessed");
    });
  });

  describe("Feature flag", () => {
    it("should return disabled message when cronEnabled is set to 0 in DB", async () => {
      await upsertTestPlatformConfig(POD_SCALER_CONFIG_KEYS.cronEnabled, "0");
      const request = createMockRequest("Bearer test-scaler-secret");
      const response = await GET(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe("Pod scaler cron is disabled");
    });

    it("should proceed normally when cronEnabled is set to 1 in DB", async () => {
      await upsertTestPlatformConfig(POD_SCALER_CONFIG_KEYS.cronEnabled, "1");
      const request = createMockRequest("Bearer test-scaler-secret");
      const response = await GET(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("success");
      expect(body).toHaveProperty("swarmsProcessed");
    });

    it("should proceed normally when no cronEnabled record exists (default enabled)", async () => {
      // No DB record → default enabled
      const request = createMockRequest("Bearer test-scaler-secret");
      const response = await GET(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("success");
      expect(body).toHaveProperty("swarmsProcessed");
    });
  });

  describe("Deleted workspace filtering", () => {
    it("should exclude swarms whose workspace has been soft-deleted", async () => {
      const user = await createTestUser({ email: "deleted-ws@example.com" });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "deleted-workspace-scaler",
      });

      // Soft-delete the workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true },
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        poolApiKey: "test-pool-key",
      });

      const request = createMockRequest("Bearer test-scaler-secret");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      // Swarm for deleted workspace must not be processed
      expect(body.swarmsProcessed).toBe(0);
      // No Pool Manager scale call should be made
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Stale task filtering", () => {
    it("should exclude tasks with updatedAt older than 30 days from overQueuedCount", async () => {
      const user = await createTestUser({ email: "stale-task@example.com" });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "stale-task-workspace",
      });
      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        poolApiKey: "test-pool-key",
      });

      const thirtyOneDaysAgo = new Date(
        Date.now() - 31 * 24 * 60 * 60 * 1000
      );
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      // Create a stale task: all filters pass except updatedAt is > 30 days old
      await db.task.create({
        data: {
          title: "Stale coordinator task",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          status: "TODO",
          systemAssigneeType: "TASK_COORDINATOR",
          deleted: false,
          archived: false,
          sourceType: "SYSTEM",
          createdAt: thirtyOneDaysAgo,
          updatedAt: thirtyOneDaysAgo,
        },
      });

      const request = createMockRequest("Bearer test-scaler-secret");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.swarmsProcessed).toBe(1);

      // Verify swarm state in DB: minimumVms should equal floor (minimumPods or minimumVms),
      // meaning the stale task was NOT counted and no scale-up occurred.
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });
      // deployedPods is set to targetVms which should be the floor (not floor + overQueuedCount + 2)
      // overQueuedCount must be 0 since stale task is excluded
      const floor = updatedSwarm?.minimumPods ?? updatedSwarm?.minimumVms ?? 0;
      expect(updatedSwarm?.minimumVms).toBe(Math.min(floor, 20));

      // No scale call to Pool Manager since targetVms === swarm.minimumVms (no change)
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should count tasks with updatedAt within 30 days", async () => {
      const user = await createTestUser({ email: "fresh-task@example.com" });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "fresh-task-workspace",
      });
      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        poolApiKey: "test-pool-key",
        minimumVms: 1,
        minimumPods: 1,
      });

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

      // Create two fresh tasks so rawDemand=2 > floor=1 → triggers scale-up
      for (let i = 0; i < 2; i++) {
        await db.task.create({
          data: {
            title: `Fresh coordinator task ${i}`,
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            status: "TODO",
            systemAssigneeType: "TASK_COORDINATOR",
            deleted: false,
            archived: false,
            sourceType: "SYSTEM",
            // createdAt must be > 5 min ago (lt: fiveMinutesAgo means created before fiveMinutesAgo)
            createdAt: tenMinutesAgo,
            updatedAt: tenMinutesAgo,
          },
        });
      }

      const request = createMockRequest("Bearer test-scaler-secret");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.swarmsProcessed).toBe(1);
      // Two fresh tasks → overQueuedCount=2, rawDemand=2 > floor=1 → scale up
      expect(body.swarmsScaled).toBe(1);
      // Pool Manager was called to scale up
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("Active swarm processing", () => {
    it("should process swarms with valid non-deleted workspaces normally", async () => {
      const user = await createTestUser({ email: "active-swarm@example.com" });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "active-swarm-workspace",
      });
      await createTestSwarm({
        workspaceId: workspace.id,
        poolApiKey: "test-pool-key",
      });

      const request = createMockRequest("Bearer test-scaler-secret");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.swarmsProcessed).toBe(1);
    });

    it("should return properly structured response", async () => {
      const request = createMockRequest("Bearer test-scaler-secret");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("success");
      expect(body).toHaveProperty("swarmsProcessed");
      expect(body).toHaveProperty("swarmsScaled");
      expect(body).toHaveProperty("errors");
      expect(body).toHaveProperty("timestamp");
      expect(Array.isArray(body.errors)).toBe(true);
      expect(typeof body.swarmsProcessed).toBe("number");
      expect(typeof body.swarmsScaled).toBe("number");
      expect(typeof body.timestamp).toBe("string");
    });
  });
});
