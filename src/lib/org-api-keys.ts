import * as crypto from "crypto";
import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/api-keys";

/**
 * Org API key format: hiveorg_{randomBytes}
 *
 * Org-scoped counterpart of the workspace `hive_…` keys (src/lib/api-keys.ts).
 * Issued to external systems (e.g. strut) acting on behalf of a whole
 * SourceControlOrg; valid for every workspace in that org. Sent in the
 * `x-api-token` header. Only the SHA-256 hash is stored.
 */

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const ORG_KEY_PREFIX = "hiveorg_";
const DISPLAY_PREFIX_LENGTH = 12; // "hiveorg_" + 4 chars

export function isOrgApiKey(key: string | null | undefined): key is string {
  return !!key && key.startsWith(ORG_KEY_PREFIX);
}

export function generateOrgApiKey(): string {
  let encoded = "";
  for (const byte of crypto.randomBytes(32)) {
    encoded += ALPHABET[byte % 62];
  }
  return `${ORG_KEY_PREFIX}${encoded}`;
}

export interface ValidatedOrgApiKey {
  apiKey: { id: string; name: string; createdById: string };
  orgId: string;
}

/**
 * Validate an org API key. Returns null if unknown, revoked, or expired.
 */
export async function validateOrgApiKey(key: string): Promise<ValidatedOrgApiKey | null> {
  if (!isOrgApiKey(key)) return null;

  const apiKey = await db.orgApiKey.findUnique({
    where: { keyHash: hashApiKey(key) },
  });

  if (!apiKey) return null;
  if (apiKey.revokedAt) return null;
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

  db.orgApiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {
      // Non-critical
    });

  return {
    apiKey: { id: apiKey.id, name: apiKey.name, createdById: apiKey.createdById },
    orgId: apiKey.sourceControlOrgId,
  };
}

/**
 * Create an org API key. The raw key is returned only here.
 */
export async function createOrgApiKey(params: {
  orgId: string;
  name: string;
  createdById: string;
  expiresAt?: Date | null;
}) {
  const rawKey = generateOrgApiKey();

  const apiKey = await db.orgApiKey.create({
    data: {
      sourceControlOrgId: params.orgId,
      name: params.name,
      keyPrefix: rawKey.slice(0, DISPLAY_PREFIX_LENGTH),
      keyHash: hashApiKey(rawKey),
      createdById: params.createdById,
      expiresAt: params.expiresAt ?? null,
    },
  });

  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    key: rawKey,
    createdAt: apiKey.createdAt,
    expiresAt: apiKey.expiresAt,
  };
}

/**
 * Revoke an org API key. Scoped to the org so a keyId from another org is a no-op.
 * @returns true if a live key was revoked
 */
export async function revokeOrgApiKey(params: {
  orgId: string;
  keyId: string;
  revokedById: string;
}): Promise<boolean> {
  const { count } = await db.orgApiKey.updateMany({
    where: { id: params.keyId, sourceControlOrgId: params.orgId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: params.revokedById },
  });
  return count > 0;
}

export async function listOrgApiKeys(orgId: string) {
  const keys = await db.orgApiKey.findMany({
    where: { sourceControlOrgId: orgId },
    include: { createdBy: { select: { id: true, name: true } } },
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
