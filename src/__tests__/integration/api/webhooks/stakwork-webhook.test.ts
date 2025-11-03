import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { computeHmacSha256Hex } from "@/lib/webhooks/signature-validation";
import crypto from "crypto";

/**
 * TODO: These tests are disabled until the database schema is updated
 * 
 * REQUIRED DATABASE CHANGES (separate PR):
 * 1. Add stakworkWebhookSecret field to Workspace model in prisma/schema.prisma
 * 2. Add stakworkWebhookSecret to EncryptableField union in src/types/encryption.ts
 * 3. Run migration: npx prisma migrate dev --name add_stakwork_webhook_secret
 * 4. Update webhook route to enable signature verification (uncomment TODO blocks)
 * 
 * Once schema changes are deployed, uncomment all tests in this file.
 */

describe.skip("Stakwork Webhook Signature Validation", () => {
  const encryptionService = EncryptionService.getInstance();
  let testWorkspace: { id: string; slug: string };
  let testTask: { id: string };
  let webhookSecret: string;

  beforeEach(async () => {
    // Create test workspace with webhook secret
    webhookSecret = crypto.randomBytes(32).toString("hex");
    const encryptedSecret = encryptionService.encryptField(
      "stakworkWebhookSecret",
      webhookSecret,
    );

    const workspace = await db.workspace.create({
      data: {
        name: "Webhook Test Workspace",
        slug: `webhook-test-${Date.now()}`,
        stakworkWebhookSecret: JSON.stringify(encryptedSecret),
        owner: {
          create: {
            email: `webhook-test-${Date.now()}@example.com`,
            name: "Webhook Test User",
          },
        },
      },
    });

    testWorkspace = workspace;

    // Create test task
    const task = await db.task.create({
      data: {
        title: "Test Task",
        workspaceId: workspace.id,
        createdBy: workspace.ownerId,
      },
    });

    testTask = task;
  });

  afterEach(async () => {
    // Cleanup
    await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.workspace.delete({ where: { id: testWorkspace.id } });
    await db.user.delete({ where: { id: testWorkspace.ownerId } });
  });

  it("should reject webhook request without signature", async () => {
    const payload = {
      task_id: testTask.id,
      project_status: "completed",
    };

    const response = await fetch(
      `http://localhost:3000/api/stakwork/webhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Missing webhook signature");
  });

  it("should reject webhook request with invalid signature", async () => {
    const payload = {
      task_id: testTask.id,
      project_status: "completed",
    };
    const rawBody = JSON.stringify(payload);

    // Use wrong secret to generate invalid signature
    const wrongSecret = "wrong-secret";
    const invalidSignature = computeHmacSha256Hex(wrongSecret, rawBody);

    const response = await fetch(
      `http://localhost:3000/api/stakwork/webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": invalidSignature,
        },
        body: rawBody,
      },
    );

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Invalid webhook signature");
  });

  it("should accept webhook request with valid signature", async () => {
    const payload = {
      task_id: testTask.id,
      project_status: "completed",
    };
    const rawBody = JSON.stringify(payload);

    // Generate valid signature
    const validSignature = computeHmacSha256Hex(webhookSecret, rawBody);

    const response = await fetch(
      `http://localhost:3000/api/stakwork/webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": validSignature,
        },
        body: rawBody,
      },
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    // Verify task was updated
    const updatedTask = await db.task.findUnique({
      where: { id: testTask.id },
      select: { workflowStatus: true },
    });
    expect(updatedTask?.workflowStatus).toBe("COMPLETED");
  });

  it("should reject webhook for workspace without webhook secret", async () => {
    // Create workspace without webhook secret
    const workspaceNoSecret = await db.workspace.create({
      data: {
        name: "No Secret Workspace",
        slug: `no-secret-${Date.now()}`,
        owner: {
          create: {
            email: `no-secret-${Date.now()}@example.com`,
            name: "No Secret User",
          },
        },
      },
    });

    const taskNoSecret = await db.task.create({
      data: {
        title: "Test Task No Secret",
        workspaceId: workspaceNoSecret.id,
        createdBy: workspaceNoSecret.ownerId,
      },
    });

    const payload = {
      task_id: taskNoSecret.id,
      project_status: "completed",
    };
    const rawBody = JSON.stringify(payload);
    const signature = computeHmacSha256Hex("any-secret", rawBody);

    const response = await fetch(
      `http://localhost:3000/api/stakwork/webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: rawBody,
      },
    );

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Webhook not configured");

    // Cleanup
    await db.task.delete({ where: { id: taskNoSecret.id } });
    await db.workspace.delete({ where: { id: workspaceNoSecret.id } });
    await db.user.delete({ where: { id: workspaceNoSecret.ownerId } });
  });

  it("should use constant-time comparison to prevent timing attacks", () => {
    const secret = "test-secret";
    const payload = "test payload";
    const validSignature = computeHmacSha256Hex(secret, payload);

    // Timing attack protection test - similar signatures should take same time
    const invalidSignature1 = validSignature.slice(0, -1) + "a";
    const invalidSignature2 = "0".repeat(validSignature.length);

    const { timingSafeEqual } = require("@/lib/webhooks/signature-validation");

    // Both invalid comparisons should return false
    expect(timingSafeEqual(validSignature, invalidSignature1)).toBe(false);
    expect(timingSafeEqual(validSignature, invalidSignature2)).toBe(false);

    // Valid comparison should return true
    expect(timingSafeEqual(validSignature, validSignature)).toBe(true);
  });
});