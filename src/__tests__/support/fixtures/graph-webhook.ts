import { computeHmacSha256Hex } from "@/lib/encryption";
import type { Swarm } from "@prisma/client";

/**
 * Compute a valid HMAC-SHA256 signature for Graph webhook.
 * Uses the same algorithm as the webhook service for verification.
 * 
 * @param secret - Plain text webhook secret
 * @param body - Raw request body string (JSON.stringify of payload)
 * @returns Signature in format: sha256={hex_digest}
 */
export function computeValidGraphWebhookSignature(
  secret: string,
  body: string
): string {
  const digest = computeHmacSha256Hex(secret, body);
  return `sha256=${digest}`;
}

/**
 * Create a test Graph webhook request with valid signature.
 * 
 * @param payload - Webhook payload object
 * @param secret - Plain text webhook secret
 * @returns Object with headers and body for fetch request
 */
export function createGraphWebhookRequest(
  payload: Record<string, unknown>,
  secret: string
) {
  const body = JSON.stringify(payload);
  const signature = computeValidGraphWebhookSignature(secret, body);

  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": signature,
    },
    body,
  };
}

/**
 * Create a test Graph webhook payload for test status update.
 */
export function createTestStatusPayload(
  swarmId: string,
  testFilePath: string,
  status: "success" | "failed" | "running" = "success",
  error?: string
) {
  return {
    swarmId,
    testFilePath,
    status,
    ...(error && { error }),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a minimal Swarm fixture for testing.
 */
export function createTestSwarm(overrides?: Partial<Swarm>): Swarm {
  return {
    id: "test-swarm-id",
    name: "Test Swarm",
    swarmId: null,
    swarmUrl: null,
    status: "PENDING",
    instanceType: "XL",
    ec2Id: null,
    poolState: "NOT_STARTED",
    poolName: null,
    poolApiKey: null,
    poolCpu: null,
    poolMemory: null,
    swarmApiKey: null,
    swarmSecretAlias: null,
    environmentVariables: [],
    services: [],
    ingestRefId: null,
    ingestRequestInProgress: false,
    containerFiles: null,
    containerFilesSetUp: false,
    agentRequestId: null,
    agentStatus: null,
    swarmPassword: null,
    graphWebhookSecret: null,
    workspaceId: "test-workspace-id",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
