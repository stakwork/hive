/**
 * Signed URL utilities for secure, time-limited access to resources.
 *
 * Uses HMAC-SHA256 to sign URLs with an expiration timestamp.
 * The signature is verified on the server side before granting access.
 */

import crypto from "node:crypto";

const DEFAULT_EXPIRY_SECONDS = 3600; // 1 hour

/**
 * Get the signing secret from environment variables.
 * Falls back to API_TOKEN if SIGNED_URL_SECRET is not set.
 */
function getSigningSecret(): string {
  const secret = process.env.SIGNED_URL_SECRET || process.env.API_TOKEN;
  if (!secret) {
    throw new Error(
      "SIGNED_URL_SECRET or API_TOKEN environment variable is required for signed URLs"
    );
  }
  return secret;
}

/**
 * Generate a signed URL for accessing a resource.
 *
 * @param baseUrl - The base URL of the application (e.g., "https://hive.example.com")
 * @param path - The path to the resource (e.g., "/api/agent-logs/abc123/content")
 * @param expirySeconds - How long the URL should be valid (default: 1 hour)
 * @returns The full signed URL
 */
export function generateSignedUrl(
  baseUrl: string,
  path: string,
  expirySeconds: number = DEFAULT_EXPIRY_SECONDS
): string {
  const expires = Math.floor(Date.now() / 1000) + expirySeconds;
  const signature = generateSignature(path, expires);

  const url = new URL(path, baseUrl);
  url.searchParams.set("expires", expires.toString());
  url.searchParams.set("sig", signature);

  return url.toString();
}

/**
 * Generate the HMAC signature for a path and expiry timestamp.
 */
export function generateSignature(path: string, expires: number): string {
  const secret = getSigningSecret();
  const message = `${path}:${expires}`;
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * Verify a signed URL's signature and expiration.
 *
 * @param path - The path being accessed (without query params)
 * @param expires - The expiration timestamp from the URL
 * @param signature - The signature from the URL
 * @returns Object with valid boolean and optional error message
 */
export function verifySignedUrl(
  path: string,
  expires: string | number,
  signature: string
): { valid: boolean; error?: string } {
  // Check expiration
  const expiresNum =
    typeof expires === "string" ? parseInt(expires, 10) : expires;
  if (isNaN(expiresNum)) {
    return { valid: false, error: "Invalid expiration timestamp" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > expiresNum) {
    return { valid: false, error: "URL has expired" };
  }

  // Verify signature
  const expectedSignature = generateSignature(path, expiresNum);

  // Use timing-safe comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, error: "Invalid signature" };
  }

  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, error: "Invalid signature" };
  }

  return { valid: true };
}
