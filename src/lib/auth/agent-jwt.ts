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
