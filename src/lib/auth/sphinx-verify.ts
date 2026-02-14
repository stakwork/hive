import { sha256 } from "@noble/hashes/sha256";
import { Signature } from "@noble/secp256k1";
import { timingSafeEqual } from "crypto";

/**
 * Parse a base64-encoded Lightning token into timestamp and signature components.
 *
 * @param base64Token - Base64-encoded token string
 * @returns Object with timestampBytes (Buffer) and signature (Buffer)
 * @throws Error if token format is invalid
 */
function parseTokenString(base64Token: string): {
  timestampBytes: Buffer;
  signature: Buffer;
} {
  try {
    // Decode base64 token
    const tokenBuffer = Buffer.from(base64Token, "base64");

    // Validate token length (4 bytes timestamp + 65 bytes signature = 69 bytes)
    if (tokenBuffer.length !== 69) {
      throw new Error(
        `Invalid token length: expected 69 bytes, got ${tokenBuffer.length}`
      );
    }

    // Extract timestamp bytes (first 4 bytes)
    const timestampBytes = tokenBuffer.subarray(0, 4);

    // Extract signature (remaining 65 bytes)
    const signature = tokenBuffer.subarray(4);

    return { timestampBytes, signature };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse token: ${error.message}`);
    }
    throw new Error("Failed to parse token");
  }
}

/**
 * Verify a Lightning-signed Sphinx token against a claimed public key.
 *
 * This function implements the Lightning Network signature verification protocol:
 * 1. Parse the token to extract timestamp and signature
 * 2. Construct the message with "Lightning Signed Message:" prefix
 * 3. Double SHA-256 hash the message
 * 4. Recover the public key from the signature
 * 5. Compare recovered key with claimed key using timing-safe comparison
 *
 * @param base64Token - Base64-encoded token (69 bytes: 4 timestamp + 65 signature)
 * @param timestamp - Expected timestamp value (for validation)
 * @param claimedPubkey - The public key claimed by the client (66-char hex string)
 * @returns true if signature is valid and matches claimed pubkey, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = verifySphinxToken(
 *   "AAABjYPQ1ZE...", // base64 token
 *   1707876123,       // timestamp
 *   "02a1b2c3..."     // claimed pubkey (66 hex chars)
 * );
 * ```
 */
export function verifySphinxToken(
  base64Token: string,
  timestamp: number,
  claimedPubkey: string
): boolean {
  try {
    // Parse token into timestamp and signature components
    const { timestampBytes, signature } = parseTokenString(base64Token);

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
    // Don't expose internal error details to prevent information leakage
    if (error instanceof Error) {
      // In production, you might want to log this for debugging
      console.error("Sphinx token verification failed:", error.message);
    }
    return false;
  }
}
