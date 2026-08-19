import { SignJWT, jwtVerify, decodeJwt } from "jose";

const WEBHOOK_TOKEN_EXPIRY = "10m";

interface WebhookTokenPayload {
  taskId: string;
}

/**
 * Create a JWT for webhook authentication
 * @param taskId - The task ID (also used as session ID)
 * @param secret - The per-task webhook secret
 * @returns Signed JWT string
 */
export async function createWebhookToken(taskId: string, secret: string): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);

  return new SignJWT({ taskId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(WEBHOOK_TOKEN_EXPIRY)
    .sign(secretKey);
}

/**
 * Verify a webhook JWT and extract payload
 * @param token - The JWT to verify
 * @param secret - The per-task webhook secret
 * @returns Payload if valid, null if invalid/expired
 */
export async function verifyWebhookToken(token: string, secret: string): Promise<WebhookTokenPayload | null> {
  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey);
    return { taskId: payload.taskId as string };
  } catch {
    return null;
  }
}

/**
 * Decode a webhook JWT without verification (to extract taskId for secret lookup)
 * @param token - The JWT to decode
 * @returns Payload if decodable, null if invalid format
 */
export function decodeWebhookToken(token: string): WebhookTokenPayload | null {
  try {
    const decoded = decodeJwt(token);
    const taskId = decoded.taskId as string;
    if (!taskId) return null;
    return { taskId };
  } catch {
    return null;
  }
}

/**
 * Create a JWT for the code-change webhook.
 *
 * Long-lived by design: the swarm's terminal webhook can arrive well after
 * dispatch (retry ladder, boot-time orphan sweep after a container restart),
 * and the reconcile cron may still be resolving the claim days later. The
 * per-claim secret — generated fresh for every claim Task and stored
 * encrypted — is the real credential; the expiry is a backstop, not the
 * security boundary.
 *
 * @param taskId - The claim Task id
 * @param secret - The per-claim webhook secret
 */
export async function createCodeChangeWebhookToken(taskId: string, secret: string): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);

  return new SignJWT({ taskId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey);
}

/**
 * Generate a random webhook secret
 * @returns 32-byte hex string
 */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
