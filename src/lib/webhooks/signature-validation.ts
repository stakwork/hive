import crypto from "crypto";

/**
 * Computes HMAC-SHA256 signature for webhook payload
 */
export function computeHmacSha256Hex(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validates webhook signature with support for different header formats
 */
export interface WebhookValidationOptions {
  secret: string;
  payload: string;
  signature: string;
  algorithm?: "sha256" | "sha1";
  prefix?: string; // e.g., "sha256=" for GitHub-style headers
}

export function validateWebhookSignature({
  secret,
  payload,
  signature,
  algorithm = "sha256",
  prefix,
}: WebhookValidationOptions): boolean {
  // Remove prefix if present
  const signatureValue = prefix && signature.startsWith(prefix)
    ? signature.slice(prefix.length)
    : signature;

  // Compute expected signature
  let expectedSignature: string;
  if (algorithm === "sha256") {
    expectedSignature = computeHmacSha256Hex(secret, payload);
  } else {
    expectedSignature = crypto
      .createHmac("sha1", secret)
      .update(payload)
      .digest("hex");
  }

  // Timing-safe comparison
  return timingSafeEqual(expectedSignature, signatureValue);
}