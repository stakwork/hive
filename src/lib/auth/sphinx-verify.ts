import { sha256 } from "@noble/hashes/sha256";
import { Signature } from "@noble/secp256k1";
import { timingSafeEqual } from "crypto";
import { logger } from "@/lib/logger";

// Maximum age for token timestamp (5 minutes)
const MAX_TOKEN_AGE_SECONDS = 300;

/** What a Lightning signed message starts with; the signer adds it (the Sphinx core's `sign_base64`). */
const LIGHTNING_PREFIX = Buffer.from("Lightning Signed Message:");

/**
 * The first line of a bound token's message (docs/plans/sphinx-token-binding.md).
 * A client that signs challenges for other servers must refuse one that starts with it.
 */
export const SPHINX_TOKEN_BOUND_TAG = "hive sphinx token v2";

/** What a bound token is for: `login` on the sign-in routes, `register` on a device's pubkey registration. */
export type SphinxTokenPurpose = "login" | "register";
const PURPOSES: ReadonlySet<string> = new Set<SphinxTokenPurpose>(["login", "register"]);

/** What a bound token names besides its timestamp. The server rebuilds it from what it knows. */
export interface SphinxTokenBinding {
  /** Hive's host, port included when not the default: the `host=` the sign-in QR names. */
  host: string;
  purpose: SphinxTokenPurpose;
  /** The k1 Hive issued for this sign-in, or "" on a route that has none. */
  challenge: string;
}

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

export type VerifyResult = { valid: true } | { valid: false; reason: string };

/** Why a token's timestamp is not within the last five minutes, or null when it is. */
function timestampFailure(timestamp: number): VerifyResult | null {
  const now = Math.floor(Date.now() / 1000);

  // Check if timestamp is in the future
  if (timestamp > now) {
    logger.warn("Token timestamp is in the future", "SPHINX_AUTH", {
      timestamp,
      now,
      diff: timestamp - now,
    });
    return { valid: false, reason: "Token timestamp is in the future" };
  }

  // Check if timestamp is too old
  if (timestamp < now - MAX_TOKEN_AGE_SECONDS) {
    logger.warn("Token timestamp is too old", "SPHINX_AUTH", {
      timestamp,
      now,
      diff: now - timestamp,
      maxAge: MAX_TOKEN_AGE_SECONDS,
    });
    return { valid: false, reason: "Token expired" };
  }

  return null;
}

/**
 * Whether the 65-byte recoverable signature over `message` (the Lightning
 * prefix included) is the claimed key's: double SHA-256, recover, compare.
 */
function signedBy(message: Buffer, signature: Buffer, claimedPubkey: string): VerifyResult {
  // Compute double SHA-256 hash
  const messageHash = sha256(sha256(message));

  // Extract recovery ID from first byte of signature
  // Recovery ID is in range 27-30, we need 0-3
  const recoveryId = (signature[0] - 27) & 3;

  // Validate recovery ID is in valid range
  if (recoveryId < 0 || recoveryId > 3) {
    return { valid: false, reason: "Invalid signature" };
  }

  // Extract compact signature (remaining 64 bytes after first byte)
  const compactSig = signature.subarray(1, 65);

  // Validate compact signature length
  if (compactSig.length !== 64) {
    return { valid: false, reason: "Invalid signature" };
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
    return { valid: false, reason: "Invalid signature" };
  }

  // Use timing-safe comparison to prevent timing attacks
  if (!timingSafeEqual(claimedBuffer, recoveredBuffer)) {
    return { valid: false, reason: "Invalid signature" };
  }

  return { valid: true };
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
 * This is the BARE token: the signature covers the timestamp alone, so any
 * signature the key makes over four bytes verifies. `verifySphinxTokenBound`
 * is the form that names Hive, the purpose and the challenge.
 *
 * @param token - Base64-encoded token (69 bytes: 4 timestamp + 65 signature)
 * @param claimedPubkey - The public key claimed by the client (66-char hex string)
 * @param checkTimestamp - Whether to validate the timestamp is recent (default: true)
 * @returns VerifyResult with valid flag and reason on failure
 *
 * @example
 * ```typescript
 * const result = verifySphinxToken(
 *   "AAABjYPQ1ZE...", // base64 token
 *   "02a1b2c3..."     // claimed pubkey (66 hex chars)
 * );
 * if (!result.valid) console.log(result.reason);
 * ```
 */
export function verifySphinxToken(
  token: string,
  claimedPubkey: string,
  checkTimestamp: boolean = true
): VerifyResult {
  try {
    // Parse token into timestamp and signature components
    const parsed = parseTokenString(token);
    if (!parsed) {
      return { valid: false, reason: "Invalid token format" };
    }

    const { timestamp, timestampBytes, signature } = parsed;

    // Validate timestamp if requested
    if (checkTimestamp) {
      const failure = timestampFailure(timestamp);
      if (failure) return failure;
    }

    // Construct message: "Lightning Signed Message:" prefix + timestamp bytes
    return signedBy(Buffer.concat([LIGHTNING_PREFIX, timestampBytes]), signature, claimedPubkey);
  } catch (error) {
    // Log error but return false for invalid signatures
    logger.error("Sphinx token verification failed", "SPHINX_AUTH", { error });
    return { valid: false, reason: "Invalid signature" };
  }
}

/** What is wrong with a binding, or null: a host and a known purpose, every field one line. */
function bindingProblem(binding: SphinxTokenBinding): string | null {
  if (typeof binding.host !== "string" || !binding.host) return "no host";
  if (!PURPOSES.has(binding.purpose)) return "unknown purpose";
  if (typeof binding.challenge !== "string") return "no challenge";
  if (binding.host.includes("\n") || binding.challenge.includes("\n")) return "a field that is not one line";
  return null;
}

/**
 * The bytes a client signs for a bound token — what it hands `sign_base64`,
 * which adds the Lightning prefix:
 *
 *   utf8("hive sphinx token v2\n" + host + "\n" + purpose + "\n" + challenge + "\n") + the 4 timestamp bytes
 *
 * @throws when the host or purpose is missing, or a field is not one line
 */
export function sphinxTokenBoundPayload(binding: SphinxTokenBinding, timestampBytes: Uint8Array): Buffer {
  const problem = bindingProblem(binding);
  if (problem) throw new Error(`Invalid Sphinx token binding: ${problem}`);
  if (timestampBytes.length !== 4) throw new Error("A Sphinx token timestamp is 4 bytes");
  const lines = `${SPHINX_TOKEN_BOUND_TAG}\n${binding.host}\n${binding.purpose}\n${binding.challenge}\n`;
  return Buffer.concat([Buffer.from(lines, "utf8"), Buffer.from(timestampBytes)]);
}

/**
 * Verify a BOUND Sphinx token: the bare token's wire shape (base64 of a
 * 4-byte big-endian timestamp and a 65-byte recoverable signature) and its
 * five-minute window, but the signature covers `sphinxTokenBoundPayload` —
 * Hive's host, the route's purpose and the challenge — rebuilt here from what
 * the server knows. A signature made for anything else, a bare token
 * included, does not verify.
 *
 * @param token - Base64-encoded token (69 bytes: 4 timestamp + 65 signature)
 * @param claimedPubkey - The public key claimed by the client (66-char hex string)
 * @param binding - Hive's host, the purpose, and the challenge ("" where the route has none)
 */
export function verifySphinxTokenBound(
  token: string,
  claimedPubkey: string,
  binding: SphinxTokenBinding
): VerifyResult {
  try {
    const problem = bindingProblem(binding);
    if (problem) {
      logger.error("Invalid Sphinx token binding", "SPHINX_AUTH", { problem, purpose: binding.purpose });
      return { valid: false, reason: "Invalid token binding" };
    }

    const parsed = parseTokenString(token);
    if (!parsed) {
      return { valid: false, reason: "Invalid token format" };
    }

    const { timestamp, timestampBytes, signature } = parsed;
    const failure = timestampFailure(timestamp);
    if (failure) return failure;

    const message = Buffer.concat([LIGHTNING_PREFIX, sphinxTokenBoundPayload(binding, timestampBytes)]);
    return signedBy(message, signature, claimedPubkey);
  } catch (error) {
    logger.error("Sphinx token verification failed", "SPHINX_AUTH", { error });
    return { valid: false, reason: "Invalid signature" };
  }
}
