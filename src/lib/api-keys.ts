import * as crypto from "crypto";
import { db } from "@/lib/db";

/**
 * API Key format: hive_{workspaceIdPrefix}_{randomBytes}
 * Example: hive_cm5x_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
 *
 * - hive_ - Static prefix identifying Hive workspace keys
 * - {workspaceIdPrefix} - First 4 chars of workspace ID (for debugging)
 * - {randomBytes} - 32 cryptographically random bytes, base62 encoded
 */

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_PREFIX = "hive_";
const DISPLAY_PREFIX_LENGTH = 8; // Characters shown in UI: "hive_..."

/**
 * Generate a new API key for a workspace
 * @param workspaceId - The workspace ID to include in the key prefix
 * @returns The full API key (only returned once, never stored)
 */
export function generateApiKey(workspaceId: string): string {
  const workspacePrefix = workspaceId.slice(0, 4);
  const randomBytes = crypto.randomBytes(32);

  // Base62 encode the random bytes
  let encoded = "";
  for (const byte of randomBytes) {
    encoded += ALPHABET[byte % 62];
  }

  return `${KEY_PREFIX}${workspacePrefix}_${encoded}`;
}

/**
 * Hash an API key for storage
 * Uses SHA-256 which is suitable for API key hashing
 * @param key - The full API key
 * @returns The hash of the key (stored in database)
 */
export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Get the display prefix for an API key (shown in UI)
 * @param key - The full API key
 * @returns First N characters for display
 */
export function getKeyPrefix(key: string): string {
  return key.slice(0, DISPLAY_PREFIX_LENGTH);
}

/**
 * Timing-safe comparison for hash values
 * Prevents timing attacks when comparing hashes
 */
export function timingSafeHashCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Validate an API key and return workspace info if valid
 * @param key - The API key to validate
 * @returns Workspace and API key info if valid, null otherwise
 */
export async function validateApiKey(key: string): Promise<{
  apiKey: {
    id: string;
    name: string;
    createdById: string;
  };
  workspace: {
    id: string;
    slug: string;
    name: string;
  };
} | null> {
  // Quick format check
  if (!key || !key.startsWith(KEY_PREFIX)) {
    return null;
  }

  const hash = hashApiKey(key);

  const apiKey = await db.workspaceApiKey.findUnique({
    where: { keyHash: hash },
    include: {
      workspace: {
        select: { id: true, slug: true, name: true, deleted: true },
      },
    },
  });

  // Key not found
  if (!apiKey) {
    return null;
  }

  // Key has been revoked
  if (apiKey.revokedAt) {
    return null;
  }

  // Key has expired
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null;
  }

  // Workspace has been deleted
  if (apiKey.workspace.deleted) {
    return null;
  }

  // Update lastUsedAt (fire-and-forget)
  db.workspaceApiKey
    .update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {
      // Ignore errors - this is a non-critical update
    });

  return {
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      createdById: apiKey.createdById,
    },
    workspace: {
      id: apiKey.workspace.id,
      slug: apiKey.workspace.slug,
      name: apiKey.workspace.name,
    },
  };
}

/**
 * Create a new API key for a workspace
 * @returns The created key data including the raw key (only returned once!)
 */
export async function createApiKey(params: {
  workspaceId: string;
  name: string;
  createdById: string;
  expiresAt?: Date | null;
}): Promise<{
  id: string;
  name: string;
  keyPrefix: string;
  key: string; // Full key - only returned once!
  createdAt: Date;
  expiresAt: Date | null;
}> {
  const { workspaceId, name, createdById, expiresAt } = params;

  // Generate the key
  const rawKey = generateApiKey(workspaceId);
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = getKeyPrefix(rawKey);

  // Store in database
  const apiKey = await db.workspaceApiKey.create({
    data: {
      workspaceId,
      name,
      keyPrefix,
      keyHash,
      createdById,
      expiresAt: expiresAt ?? null,
    },
  });

  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    key: rawKey, // Only time the raw key is returned
    createdAt: apiKey.createdAt,
    expiresAt: apiKey.expiresAt,
  };
}

/**
 * Revoke an API key
 * @returns true if revoked, false if not found
 */
export async function revokeApiKey(params: {
  keyId: string;
  revokedById: string;
}): Promise<boolean> {
  const { keyId, revokedById } = params;

  try {
    await db.workspaceApiKey.update({
      where: { id: keyId },
      data: {
        revokedAt: new Date(),
        revokedById,
      },
    });
    return true;
  } catch {
    // Key not found
    return false;
  }
}

/**
 * List all API keys for a workspace (does not include the raw key)
 */
export async function listApiKeys(workspaceId: string) {
  const keys = await db.workspaceApiKey.findMany({
    where: { workspaceId },
    include: {
      createdBy: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return keys.map((key) => ({
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    createdBy: key.createdBy,
    isRevoked: key.revokedAt !== null,
    revokedAt: key.revokedAt,
  }));
}

/**
 * Get a single API key by ID (for permission checks)
 */
export async function getApiKey(keyId: string) {
  return db.workspaceApiKey.findUnique({
    where: { id: keyId },
    select: {
      id: true,
      workspaceId: true,
      createdById: true,
      revokedAt: true,
    },
  });
}
