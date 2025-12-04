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
interface CreateStakworkTestWorkspaceOptions {
  webhookSecret?: string;
  workspaceName?: string;
  workspaceSlug?: string;
}

/**
 * Creates a test workspace with Stakwork webhook secret configured
 */
export async function createStakworkTestWorkspace(
  options?: CreateStakworkTestWorkspaceOptions
) {
  const {
    webhookSecret = "test-stakwork-webhook-secret-123",
    workspaceName,
    workspaceSlug,
  } = options || {};

  return await db.$transaction(async (tx) => {
    // Create user first (required by foreign key constraint)
    const ownerId = generateUniqueId("user");
    const user = await tx.user.create({
      data: {
        id: ownerId,
        name: "Test User",
        email: `${ownerId}@example.com`,
      },
    });

    // Encrypt webhook secret
    const encryptedSecret = await encryptionService.encryptField(
      "stakworkWebhookSecret",
      webhookSecret
    );

    // Create workspace with webhook secret
    const workspace = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: workspaceName || `Test Workspace ${generateUniqueId()}`,
        slug: workspaceSlug || generateUniqueSlug("test-workspace"),
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

    return {
      workspace,
      user,
      webhookSecret, // Return plain secret for test signature generation
    };
  });
}

/**
 * Options for creating test task
 */
interface CreateStakworkTestTaskOptions {
  workspaceId?: string;
  userId?: string;
  status?: TaskStatus;
  workflowStatus?: WorkflowStatus;
  title?: string;
}

/**
 * Creates a test task within a workspace
 */
export async function createStakworkTestTask(
  options?: CreateStakworkTestTaskOptions
) {
  const {
    workspaceId,
    userId,
    status = TaskStatus.TODO,
    workflowStatus = WorkflowStatus.PENDING,
    title = "Test Task for Webhook",
  } = options || {};

  // If workspace/user not provided, create them with webhook secret
  if (!workspaceId || !userId) {
    const { workspace, user, webhookSecret } = await createStakworkTestWorkspace();
    
    const task = await db.task.create({
      data: {
        title,
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status,
        workflowStatus,
      },
    });

    return { task, workspace, user, webhookSecret };
  }

  // Use provided workspace/user
  const task = await db.task.create({
    data: {
      title,
      workspaceId,
      createdById: userId,
      updatedById: userId,
      status,
      workflowStatus,
    },
  });

  // Fetch workspace to get webhook secret
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
  });

  const user = await db.user.findUnique({
    where: { id: userId },
  });

  // Decrypt webhook secret for testing
  let webhookSecret: string | null = null;
  if (workspace?.stakworkWebhookSecret) {
    webhookSecret = await encryptionService.decryptField(
      "stakworkWebhookSecret",
      workspace.stakworkWebhookSecret
    );
  }

  return { task, workspace, user, webhookSecret };
}

/**
 * Stakwork webhook payload structure
 */
export interface StakworkWebhookPayload {
  task_id?: string;
  run_id?: string;
  project_status: string;
  project_id?: string;
}

/**
 * Creates a valid Stakwork webhook payload
 */
export function createStakworkWebhookPayload(
  taskId: string,
  projectStatus: string = "completed",
  projectId?: string
): StakworkWebhookPayload {
  const payload: StakworkWebhookPayload = {
    task_id: taskId,
    project_status: projectStatus,
  };

  if (projectId) {
    payload.project_id = projectId;
  }

  return payload;
}

/**
 * Computes a valid Stakwork webhook signature for testing
 * Returns the signature in the format expected by the webhook handler
 */
export function computeStakworkWebhookSignature(
  secret: string,
  body: string
): string {
  return computeHmacSha256Hex(secret, body);
}

/**
 * Creates a complete webhook request with valid signature
 */
export function createStakworkWebhookRequest(
  url: string,
  payload: StakworkWebhookPayload,
  webhookSecret: string
): Request {
  const body = JSON.stringify(payload);
  const signature = computeStakworkWebhookSignature(webhookSecret, body);

  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-stakwork-signature": signature,
    },
    body,
  });
}
