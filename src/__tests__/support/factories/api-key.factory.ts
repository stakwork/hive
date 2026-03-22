import { db } from "@/lib/db";
import { generateApiKey, hashApiKey, getKeyPrefix } from "@/lib/api-keys";
import type { WorkspaceApiKey } from "@prisma/client";

export async function createTestApiKey(params: {
  workspaceId: string;
  createdById: string;
  name?: string;
  revokedAt?: Date;
  expiresAt?: Date;
}): Promise<{ record: WorkspaceApiKey; rawKey: string }> {
  const rawKey = generateApiKey(params.workspaceId);
  const record = await db.workspaceApiKey.create({
    data: {
      workspaceId: params.workspaceId,
      createdById: params.createdById,
      name: params.name ?? "Test API Key",
      keyHash: hashApiKey(rawKey),
      keyPrefix: getKeyPrefix(rawKey),
      revokedAt: params.revokedAt ?? null,
      expiresAt: params.expiresAt ?? null,
    },
  });
  return { record, rawKey };
}
