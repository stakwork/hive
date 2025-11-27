import { computeHmacSha256Hex } from "@/lib/encryption";
import { StakworkStatusPayload } from "@/types";

/**
 * Generate valid HMAC-SHA256 signature for Stakwork webhook payload
 * 
 * @param secret - Webhook secret (decrypted)
 * @param payload - Webhook payload object
 * @returns Signature in format: sha256=<hex>
 */
export function generateStakworkSignature(
  secret: string,
  payload: StakworkStatusPayload | Record<string, unknown>
): string {
  const body = JSON.stringify(payload);
  const hmac = computeHmacSha256Hex(secret, body);
  return `sha256=${hmac}`;
}

/**
 * Generate signature without sha256= prefix (for testing invalid formats)
 */
export function generateStakworkSignatureRaw(
  secret: string,
  payload: StakworkStatusPayload | Record<string, unknown>
): string {
  const body = JSON.stringify(payload);
  return computeHmacSha256Hex(secret, body);
}

/**
 * Create sample Stakwork webhook payload for testing
 */
export function createStakworkWebhookPayload(
  overrides: Partial<StakworkStatusPayload> = {}
): StakworkStatusPayload {
  return {
    task_id: overrides.task_id || "task-123",
    project_status: overrides.project_status || "completed",
    ...overrides,
  };
}

/**
 * Create a Request object for webhook testing with signature
 * 
 * @param webhookUrl - Full URL to webhook endpoint
 * @param payload - Webhook payload
 * @param secret - Webhook secret for signature generation (null to omit signature)
 * @param signatureFormat - 'with-prefix' (default) or 'raw' (no sha256= prefix)
 * @returns Request object ready for testing
 */
export function createStakworkWebhookRequest(
  webhookUrl: string,
  payload: StakworkStatusPayload | Record<string, unknown>,
  secret: string | null = null,
  signatureFormat: 'with-prefix' | 'raw' = 'with-prefix'
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (secret !== null) {
    const signature = signatureFormat === 'with-prefix'
      ? generateStakworkSignature(secret, payload)
      : generateStakworkSignatureRaw(secret, payload);
    headers["x-stakwork-signature"] = signature;
  }

  return new Request(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}