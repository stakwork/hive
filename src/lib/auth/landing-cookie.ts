export const LANDING_COOKIE_NAME = "landing_verified";
export const LANDING_COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours in seconds

/**
 * Signs a cookie value with HMAC using Web Crypto API (Edge Runtime compatible)
 * @param value - The value to sign (typically a timestamp)
 * @returns Signed cookie value in format "value.signature"
 */
export async function signCookie(value: string): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;

  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for cookie signing");
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(value);

  // Import key for HMAC
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  // Sign the message
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, messageData);

  // Convert to hex string
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const signature = signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return `${value}.${signature}`;
}

/**
 * Verifies a signed cookie value using Web Crypto API (Edge Runtime compatible)
 * @param signedValue - The signed cookie value to verify
 * @returns true if signature is valid and not expired, false otherwise
 */
export async function verifyCookie(signedValue: string): Promise<boolean> {
  try {
    const secret = process.env.NEXTAUTH_SECRET;

    if (!secret) {
      return false;
    }

    const parts = signedValue.split(".");
    if (parts.length !== 2) {
      return false;
    }

    const [timestamp, signature] = parts;

    // Verify timestamp is a valid number
    const timestampNum = parseInt(timestamp, 10);
    if (isNaN(timestampNum)) {
      return false;
    }

    // Check if cookie has expired (24 hours)
    const now = Date.now();
    const age = (now - timestampNum) / 1000; // Convert to seconds
    if (age > LANDING_COOKIE_MAX_AGE || age < 0) {
      return false;
    }

    // Compute expected signature using Web Crypto API
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(timestamp);

    const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

    const expectedSignatureBuffer = await crypto.subtle.sign("HMAC", key, messageData);
    const expectedSignatureArray = Array.from(new Uint8Array(expectedSignatureBuffer));
    const expectedSignature = expectedSignatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // Constant-time comparison
    return constantTimeCompare(signature, expectedSignature);
  } catch (error) {
    console.error("Error verifying landing cookie:", error);
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 * Works with both equal and unequal length strings
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal, false otherwise
 */
export function constantTimeCompare(a: string, b: string): boolean {
  // If lengths differ, still compare to prevent timing leaks
  const maxLength = Math.max(a.length, b.length);
  const paddedA = a.padEnd(maxLength, "\0");
  const paddedB = b.padEnd(maxLength, "\0");

  let result = 0;
  for (let i = 0; i < maxLength; i++) {
    result |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Checks if landing page password protection is enabled
 * @returns true if landing page is enabled and not in test environment
 */
export function isLandingPageEnabled(): boolean {
  const landingPassword = process.env.LANDING_PAGE_PASSWORD;
  return process.env.NODE_ENV !== "test" && !!landingPassword && landingPassword.trim() !== "";
}
