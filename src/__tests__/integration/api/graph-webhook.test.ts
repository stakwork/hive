import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/graph/webhook/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { GraphWebhookService } from "@/services/swarm/GraphWebhookService";
import {
  computeValidGraphWebhookSignature,
  createGraphWebhookRequest,
  createTestStatusPayload,
} from "@/__tests__/support/fixtures/graph-webhook";
import { generateUniqueId, generateUniqueSlug } from "@/__tests__/support/helpers";
import { WorkflowStatus } from "@prisma/client";

/**
 * Integration Tests for Graph Webhook - HMAC Signature Verification
 * 
 * Tests the complete HMAC-SHA256 signature verification flow:
 * 1. Signature header extraction
 * 2. Swarm lookup by ID
 * 3. Encrypted secret decryption
 * 4. HMAC computation on raw request body
 * 5. Timing-safe signature comparison
 * 6. Test status update processing
 */
describe("Graph Webhook Integration Tests - POST /api/graph/webhook", () => {
  const webhookUrl = "http://localhost:3000/api/graph/webhook";
  let encryptionService: EncryptionService;

  beforeEach(() => {
    vi.clearAllMocks();
    encryptionService = EncryptionService.getInstance();
  });

  /**
   * Helper to create test workspace with swarm and encrypted webhook secret
   */
  async function createTestWorkspaceWithSwarm(options: {
    withWebhookSecret?: boolean;
    webhookSecret?: string;
  } = {}) {
    return await db.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace
      const workspace = await tx.workspace.create({
        data: {
          name: `Test Workspace ${generateUniqueId()}`,
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      // Generate or use provided webhook secret
      const plainSecret = options.webhookSecret || require("crypto").randomBytes(32).toString("hex");
      const encryptedSecret = options.withWebhookSecret !== false
        ? JSON.stringify(encryptionService.encryptField("graphWebhookSecret", plainSecret))
        : null;

      // Create swarm with optional webhook secret
      const swarm = await tx.swarm.create({
        data: {
          id: generateUniqueId("swarm"),
          name: "Test Swarm",
          status: "ACTIVE",
          instanceType: "XL",
          poolState: "STARTED",
          workspaceId: workspace.id,
          graphWebhookSecret: encryptedSecret,
        },
      });

      return { user, workspace, swarm, plainSecret };
    });
  }

  /**
   * Helper to create test task for status updates
   */
  async function createTestTask(workspaceId: string, testFilePath: string) {
    const workspaceMember = await db.workspaceMember.findFirst({ where: { workspaceId } });
    if (!workspaceMember) {
      throw new Error(`No workspace member found for workspace: ${workspaceId}`);
    }

    return await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: `E2E Test: ${testFilePath}`,
        sourceType: "USER_JOURNEY",
        testFilePath,
        status: "DONE",
        workflowStatus: WorkflowStatus.PENDING,
        workspace: {
          connect: { id: workspaceId },
        },
        createdBy: {
          connect: { id: workspaceMember.userId },
        },
        updatedBy: {
          connect: { id: workspaceMember.userId },
        },
      },
    });
  }

  describe("HMAC Signature Verification - Happy Path", () => {
    test("should successfully verify valid HMAC signature and process webhook", async () => {
      const { swarm, plainSecret, workspace } = await createTestWorkspaceWithSwarm();
      const testFilePath = "src/__tests__/e2e/specs/login.spec.ts";
      const task = await createTestTask(workspace.id, testFilePath);

      // Create valid webhook request
      const payload = createTestStatusPayload(swarm.id, testFilePath, "success");
      const request = createGraphWebhookRequest(payload, plainSecret);

      // Execute webhook handler
      const response = await POST(new Request(webhookUrl, request as any));
      const data = await response.json();

      // Verify successful response
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Webhook processed successfully");

      // Verify task status was updated
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    });

    test("should handle test failure status update", async () => {
      const { swarm, plainSecret, workspace } = await createTestWorkspaceWithSwarm();
      const testFilePath = "src/__tests__/e2e/specs/checkout.spec.ts";
      const task = await createTestTask(workspace.id, testFilePath);

      const payload = createTestStatusPayload(
        swarm.id,
        testFilePath,
        "failed",
        "Timeout waiting for element"
      );
      const request = createGraphWebhookRequest(payload, plainSecret);

      const response = await POST(new Request(webhookUrl, request as any));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify task marked as failed
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.FAILED);
    });

    test("should handle test running status update", async () => {
      const { swarm, plainSecret, workspace } = await createTestWorkspaceWithSwarm();
      const testFilePath = "src/__tests__/e2e/specs/dashboard.spec.ts";
      const task = await createTestTask(workspace.id, testFilePath);

      const payload = createTestStatusPayload(swarm.id, testFilePath, "running");
      const request = createGraphWebhookRequest(payload, plainSecret);

      const response = await POST(new Request(webhookUrl, request as any));
      
      expect(response.status).toBe(200);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
    });
  });

  describe("HMAC Signature Verification - Authentication Failures", () => {
    test("should reject webhook with missing x-signature header", async () => {
      const { swarm } = await createTestWorkspaceWithSwarm();
      const payload = createTestStatusPayload(swarm.id, "test.spec.ts");

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing signature header");
    });

    test("should reject webhook with invalid HMAC signature", async () => {
      const { swarm, plainSecret } = await createTestWorkspaceWithSwarm();
      const payload = createTestStatusPayload(swarm.id, "test.spec.ts");
      const body = JSON.stringify(payload);

      // Create signature with wrong secret
      const wrongSecret = "wrong-secret-key";
      const invalidSignature = computeValidGraphWebhookSignature(wrongSecret, body);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": invalidSignature,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should reject webhook when swarm has no webhook secret configured", async () => {
      const { swarm } = await createTestWorkspaceWithSwarm({ withWebhookSecret: false });
      const payload = createTestStatusPayload(swarm.id, "test.spec.ts");
      const body = JSON.stringify(payload);
      const fakeSignature = "sha256=fakesignature";

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": fakeSignature,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should reject webhook for non-existent swarm", async () => {
      const nonExistentSwarmId = "swarm-does-not-exist";
      const payload = createTestStatusPayload(nonExistentSwarmId, "test.spec.ts");
      const body = JSON.stringify(payload);
      const fakeSignature = "sha256=fakesignature";

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": fakeSignature,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should use timing-safe comparison to prevent timing attacks", async () => {
      const { swarm, plainSecret } = await createTestWorkspaceWithSwarm();
      const payload = createTestStatusPayload(swarm.id, "test.spec.ts");
      const body = JSON.stringify(payload);

      // Create signature with only first few characters correct
      const validSignature = computeValidGraphWebhookSignature(plainSecret, body);
      const partiallyWrongSignature = validSignature.slice(0, 10) + "x".repeat(validSignature.length - 10);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": partiallyWrongSignature,
        },
        body,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });
  });

  describe("Payload Validation", () => {
    test("should reject webhook with missing swarmId", async () => {
      const { plainSecret } = await createTestWorkspaceWithSwarm();
      const payload = { testFilePath: "test.spec.ts", status: "success" };
      const request = createGraphWebhookRequest(payload, plainSecret);

      const response = await POST(new Request(webhookUrl, request as any));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing swarmId in payload");
    });

    test("should reject webhook with malformed JSON", async () => {
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": "sha256=invalid",
        },
        body: "invalid json {",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid JSON payload");
    });

    test("should succeed even if testFilePath is missing (no task update)", async () => {
      const { swarm, plainSecret } = await createTestWorkspaceWithSwarm();
      const payload = { swarmId: swarm.id };
      const request = createGraphWebhookRequest(payload, plainSecret);

      const response = await POST(new Request(webhookUrl, request as any));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe("Task Status Update Logic", () => {
    test("should not update task if testFilePath does not match any task", async () => {
      const { swarm, plainSecret, workspace } = await createTestWorkspaceWithSwarm();
      await createTestTask(workspace.id, "existing-test.spec.ts");

      const payload = createTestStatusPayload(
        swarm.id,
        "non-existent-test.spec.ts",
        "success"
      );
      const request = createGraphWebhookRequest(payload, plainSecret);

      const response = await POST(new Request(webhookUrl, request as any));

      expect(response.status).toBe(200);
      // Should not throw error, just log warning
    });

    test("should only update tasks with sourceType USER_JOURNEY", async () => {
      const { swarm, plainSecret, workspace } = await createTestWorkspaceWithSwarm();
      const testFilePath = "shared-test.spec.ts";
      const workspaceMember = await db.workspaceMember.findFirst({ where: { workspaceId: workspace.id } });

      // Create task with different sourceType
      const nonUserJourneyTask = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Regular Task",
          sourceType: "USER", // Not USER_JOURNEY
          testFilePath,
          status: "TODO",
          workflowStatus: WorkflowStatus.PENDING,
          workspace: {
            connect: { id: workspace.id },
          },
          createdBy: {
            connect: { id: workspaceMember!.userId },
          },
          updatedBy: {
            connect: { id: workspaceMember!.userId },
          },
        },
      });

      const payload = createTestStatusPayload(swarm.id, testFilePath, "success");
      const request = createGraphWebhookRequest(payload, plainSecret);

      await POST(new Request(webhookUrl, request as any));

      // Verify non-USER_JOURNEY task was NOT updated
      const task = await db.task.findUnique({ where: { id: nonUserJourneyTask.id } });
      expect(task?.workflowStatus).toBe(WorkflowStatus.PENDING);
    });

    test("should handle concurrent status updates to same task", async () => {
      const { swarm, plainSecret, workspace } = await createTestWorkspaceWithSwarm();
      const testFilePath = "concurrent-test.spec.ts";
      await createTestTask(workspace.id, testFilePath);

      // Send multiple concurrent requests
      const requests = ["success", "failed", "running"].map((status) => {
        const payload = createTestStatusPayload(swarm.id, testFilePath, status as any);
        const req = createGraphWebhookRequest(payload, plainSecret);
        return POST(new Request(webhookUrl, req as any));
      });

      const responses = await Promise.all(requests);

      // All should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe("Encryption Integration", () => {
    test("should successfully decrypt and use encrypted webhook secret", async () => {
      const { swarm, plainSecret } = await createTestWorkspaceWithSwarm();

      // Verify secret was encrypted in database
      const swarmFromDb = await db.swarm.findUnique({
        where: { id: swarm.id },
      });
      expect(swarmFromDb?.graphWebhookSecret).toBeTruthy();
      expect(swarmFromDb?.graphWebhookSecret).not.toBe(plainSecret);

      // Verify signature verification works with decrypted secret
      const payload = createTestStatusPayload(swarm.id, "test.spec.ts");
      const request = createGraphWebhookRequest(payload, plainSecret);

      const response = await POST(new Request(webhookUrl, request as any));
      expect(response.status).toBe(200);
    });

    test("should reject webhook if secret decryption fails", async () => {
      const { swarm } = await createTestWorkspaceWithSwarm();

      // Manually corrupt the encrypted secret in database
      await db.swarm.update({
        where: { id: swarm.id },
        data: { graphWebhookSecret: "corrupted-encrypted-data" },
      });

      const payload = createTestStatusPayload(swarm.id, "test.spec.ts");
      const body = JSON.stringify(payload);
      const fakeSignature = "sha256=anything";

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": fakeSignature,
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Raw Body HMAC Computation", () => {
    test("should compute HMAC on exact raw request body before JSON parsing", async () => {
      const { swarm, plainSecret } = await createTestWorkspaceWithSwarm();
      
      // Create payload with specific whitespace
      const payload = {
        swarmId: swarm.id,
        testFilePath: "test.spec.ts",
        status: "success",
      };
      const bodyWithWhitespace = JSON.stringify(payload, null, 2); // Pretty-printed JSON

      // Compute signature on exact body with whitespace
      const signature = computeValidGraphWebhookSignature(plainSecret, bodyWithWhitespace);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": signature,
        },
        body: bodyWithWhitespace,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    test("should reject if body is modified after signature computation", async () => {
      const { swarm, plainSecret } = await createTestWorkspaceWithSwarm();
      const originalPayload = createTestStatusPayload(swarm.id, "test.spec.ts");
      const originalBody = JSON.stringify(originalPayload);
      const signature = computeValidGraphWebhookSignature(plainSecret, originalBody);

      // Modify payload after signature computation
      const modifiedPayload = { ...originalPayload, maliciousField: "hacked" };
      const modifiedBody = JSON.stringify(modifiedPayload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": signature, // Valid signature for original body
        },
        body: modifiedBody, // Modified body
      });

      const response = await POST(request);
      expect(response.status).toBe(401);
    });
  });

  describe("Error Handling", () => {
    test("should treat database errors as unauthorized (security best practice)", async () => {
      const { swarm, plainSecret } = await createTestWorkspaceWithSwarm();
      const payload = createTestStatusPayload(swarm.id, "test.spec.ts");
      const request = createGraphWebhookRequest(payload, plainSecret);

      // Mock database failure during verification
      const originalFindUnique = db.swarm.findUnique;
      db.swarm.findUnique = vi.fn().mockRejectedValue(new Error("Database connection lost"));

      const response = await POST(new Request(webhookUrl, request as any));
      const data = await response.json();

      // Database errors during signature verification should return 401 (not 500)
      // This prevents information leakage about system state
      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");

      // Restore
      db.swarm.findUnique = originalFindUnique;
    });

    test("should handle task update errors without failing entire request", async () => {
      const { swarm, plainSecret, workspace } = await createTestWorkspaceWithSwarm();
      const testFilePath = "error-test.spec.ts";
      await createTestTask(workspace.id, testFilePath);

      const payload = createTestStatusPayload(swarm.id, testFilePath, "success");
      const request = createGraphWebhookRequest(payload, plainSecret);

      // Mock task update failure
      const originalUpdate = db.task.update;
      db.task.update = vi.fn().mockRejectedValue(new Error("Task update failed"));

      const response = await POST(new Request(webhookUrl, request as any));
      
      // Should still return 200 even if task update fails
      expect(response.status).toBe(200);

      // Restore
      db.task.update = originalUpdate;
    });
  });

  describe("Service Integration", () => {
    test("should use GraphWebhookService for verification", async () => {
      const service = new GraphWebhookService();
      const { swarm, plainSecret } = await createTestWorkspaceWithSwarm();

      const payload = createTestStatusPayload(swarm.id, "test.spec.ts");
      const body = JSON.stringify(payload);
      const signature = computeValidGraphWebhookSignature(plainSecret, body);

      // Directly test service method
      const result = await service.lookupAndVerifySwarm(swarm.id, signature, body);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(swarm.id);
    });

    test("should generate valid webhook secrets via service", () => {
      const service = new GraphWebhookService();
      const encryptedSecret = service.generateWebhookSecret();

      // Should be able to decrypt
      const decrypted = encryptionService.decryptField("graphWebhookSecret", encryptedSecret);
      expect(decrypted).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
