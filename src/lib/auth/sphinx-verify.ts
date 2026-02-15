import { sha256 } from "@noble/hashes/sha256";
import { Signature } from "@noble/secp256k1";
import { timingSafeEqual } from "crypto";
import { logger } from "@/lib/logger";

// Maximum age for token timestamp (5 minutes)
const MAX_TOKEN_AGE_SECONDS = 300;

/**
 * Parse a base64-encoded Lightning token into timestamp and signature components.
 *
 * @param base64Token - Base64-encoded token string
 * @returns Object with timestamp, timestampBytes (Buffer) and signature (Buffer), or null if invalid
 */
function parseTokenString(base64Token: string): {
  timestamp: number;
  timestampBytes: Buffer;
  signature: Buffer;
} | null {
  try {
    // Decode base64 token (handle URL-safe base64)
    const normalizedToken = base64Token
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const tokenBuffer = Buffer.from(normalizedToken, "base64");

    // Validate token length (4 bytes timestamp + 65 bytes signature = 69 bytes)
    if (tokenBuffer.length !== 69) {
      logger.warn("Invalid token length", "SPHINX_AUTH", {
        expected: 69,
        actual: tokenBuffer.length,
      });
      return null;
    }

    // Extract timestamp bytes (first 4 bytes) and parse as big-endian uint32
    const timestampBytes = tokenBuffer.subarray(0, 4);
    const timestamp = timestampBytes.readUInt32BE(0);

    // Extract signature (remaining 65 bytes)
    const signature = tokenBuffer.subarray(4);

    return { timestamp, timestampBytes, signature };
  } catch (error) {
    logger.error("Failed to parse token", "SPHINX_AUTH", { error });
    return null;
  }
}

/**
 * Verify a Lightning-signed Sphinx token against a claimed public key.
 *
 * This function implements the Lightning Network signature verification protocol:
 * 1. Parse the token to extract timestamp and signature
 * 2. Optionally validate the timestamp is recent (within 5 minutes)
 * 3. Construct the message with "Lightning Signed Message:" prefix
 * 4. Double SHA-256 hash the message
 * 5. Recover the public key from the signature
 * 6. Compare recovered key with claimed key using timing-safe comparison
 *
 * @param token - Base64-encoded token (69 bytes: 4 timestamp + 65 signature)
 * @param claimedPubkey - The public key claimed by the client (66-char hex string)
 * @param checkTimestamp - Whether to validate the timestamp is recent (default: true)
 * @returns true if signature is valid and matches claimed pubkey, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = verifySphinxToken(
 *   "AAABjYPQ1ZE...", // base64 token
 *   "02a1b2c3..."     // claimed pubkey (66 hex chars)
 * );
 * ```
 */
export function verifySphinxToken(
  token: string,
  claimedPubkey: string,
  checkTimestamp: boolean = true
): boolean {
  try {
    // Parse token into timestamp and signature components
    const parsed = parseTokenString(token);
    if (!parsed) {
      return false;
    }

    const { timestamp, timestampBytes, signature } = parsed;

    // Validate timestamp if requested
    if (checkTimestamp) {
      const now = Math.floor(Date.now() / 1000);

      // Check if timestamp is in the future
      if (timestamp > now) {
        logger.warn("Token timestamp is in the future", "SPHINX_AUTH", {
          timestamp,
          now,
          diff: timestamp - now,
        });
        return false;
      }

      // Check if timestamp is too old
      if (timestamp < now - MAX_TOKEN_AGE_SECONDS) {
        logger.warn("Token timestamp is too old", "SPHINX_AUTH", {
          timestamp,
          now,
          diff: now - timestamp,
          maxAge: MAX_TOKEN_AGE_SECONDS,
        });
        return false;
      }
    }

    // Construct message: "Lightning Signed Message:" prefix + timestamp bytes
    const prefix = Buffer.from("Lightning Signed Message:");
    const message = Buffer.concat([prefix, timestampBytes]);

    // Compute double SHA-256 hash
    const firstHash = sha256(message);
    const messageHash = sha256(firstHash);

    // Extract recovery ID from first byte of signature
    // Recovery ID is in range 27-30, we need 0-3
    const recoveryId = (signature[0] - 27) & 3;

    // Validate recovery ID is in valid range
    if (recoveryId < 0 || recoveryId > 3) {
      return false;
    }

    // Extract compact signature (remaining 64 bytes after first byte)
    const compactSig = signature.subarray(1, 65);

    // Validate compact signature length
    if (compactSig.length !== 64) {
      return false;
    }

    // Create Signature object from compact bytes and add recovery bit
    const sig = Signature.fromCompact(compactSig).addRecoveryBit(recoveryId);

    // Recover public key from signature
    const recoveredPoint = sig.recoverPublicKey(messageHash);

    // Convert recovered point to compressed hex format (33 bytes = 66 hex chars)
    const recoveredPubkey = recoveredPoint.toHex(true);

    // Convert to buffers for timing-safe comparison
    const claimedBuffer = Buffer.from(claimedPubkey, "hex");
    const recoveredBuffer = Buffer.from(recoveredPubkey, "hex");

    // Validate pubkey lengths match (should both be 33 bytes)
    if (
      claimedBuffer.length !== recoveredBuffer.length ||
      claimedBuffer.length !== 33
    ) {
      return false;
    }

    // Use timing-safe comparison to prevent timing attacks
    return timingSafeEqual(claimedBuffer, recoveredBuffer);
  } catch (error) {
    // Log error but return false for invalid signatures
    logger.error("Sphinx token verification failed", "SPHINX_AUTH", { error });
    return false;
  }
}
