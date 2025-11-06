/**
 * Test fixtures and factories for Stakwork webhook endpoint tests
 */
import { db } from "@/lib/db";
import { EncryptionService, computeHmacSha256Hex } from "@/lib/encryption";
import { generateUniqueId, generateUniqueSlug } from "@/__tests__/support/helpers";
import { WorkflowStatus, TaskStatus } from "@prisma/client";

const encryptionService = EncryptionService.getInstance();

/**
 * Options for creating test workspace with Stakwork webhook configuration
 */
interface CreateTestWorkspaceWithWebhookOptions {
  webhookSecret?: string;
  workflowStatus?: WorkflowStatus;
  taskStatus?: TaskStatus;
}

/**
 * Creates a test workspace with task and webhook secret configuration
 */
export async function createTestWorkspaceWithWebhook(
  options?: CreateTestWorkspaceWithWebhookOptions
) {
  const {
    webhookSecret = "test_stakwork_webhook_secret_123",
    workflowStatus = WorkflowStatus.PENDING,
    taskStatus = TaskStatus.TODO,
  } = options || {};

  return await db.$transaction(async (tx) => {
    // Create user
    const userId = generateUniqueId("user");
    const user = await tx.user.create({
      data: {
        id: userId,
        name: "Test User",
        email: `${userId}@example.com`,
      },
    });

    // Encrypt webhook secret
    const encryptedSecret = encryptionService.encryptField(
      "stakworkWebhookSecret",
      webhookSecret
    );

    // Create workspace with webhook secret
    const workspace = await tx.workspace.create({
      data: {
        name: `Test Workspace ${generateUniqueId()}`,
        slug: generateUniqueSlug("test-workspace"),
        ownerId: user.id,
        stakworkWebhookSecret: JSON.stringify(encryptedSecret),
      },
    });

    // Create workspace member
    await tx.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    // Create task
    const task = await tx.task.create({
      data: {
        title: "Test Task for Webhook",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status: taskStatus,
        workflowStatus,
      },
    });

    return {
      user,
      workspace,
      task,
      webhookSecret, // Return plain secret for test signature generation
    };
  });
}

/**
 * Computes a valid webhook signature for testing
 */
export function computeStakworkSignature(
  secret: string,
  body: string
): string {
  return computeHmacSha256Hex(secret, body);
}

/**
 * Creates a Request with signature header for webhook testing
 */
export function createStakworkWebhookRequest(
  url: string,
  payload: Record<string, unknown>,
  signature: string
): Request {
  const body = JSON.stringify(payload);

  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-stakwork-signature": `sha256=${signature}`,
    },
    body,
  });
}

/**
 * Creates a Request without signature for testing validation
 */
export function createStakworkWebhookRequestWithoutSignature(
  url: string,
  payload: Record<string, unknown>
): Request {
  const body = JSON.stringify(payload);

  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });
}

/**
 * Creates a Request with invalid signature for testing validation
 */
export function createStakworkWebhookRequestWithInvalidSignature(
  url: string,
  payload: Record<string, unknown>
): Request {
  const body = JSON.stringify(payload);

  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-stakwork-signature": "sha256=invalid_signature_123",
    },
    body,
  });
}
