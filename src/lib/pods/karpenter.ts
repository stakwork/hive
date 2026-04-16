import { config } from "@/config/env";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = EncryptionService.getInstance();

export async function markPodAsUsed(podId: string, poolName: string, poolApiKey: string): Promise<boolean> {
  const baseUrl = config.POOL_MANAGER_BASE_URL;
  const decryptedKey = encryptionService.decryptField("poolApiKey", poolApiKey);
  try {
    const res = await fetch(
      `${baseUrl}/pools/${encodeURIComponent(poolName)}/workspaces/${podId}/mark-used`,
      { method: "POST", headers: { Authorization: `Bearer ${decryptedKey}` } },
    );
    if (!res.ok) {
      console.error(`[karpenter] mark-used failed for pod ${podId}: ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[karpenter] mark-used error for pod ${podId}:`, e);
    return false;
  }
}

export async function markPodAsUnused(podId: string, poolName: string, poolApiKey: string): Promise<void> {
  const baseUrl = config.POOL_MANAGER_BASE_URL;
  const decryptedKey = encryptionService.decryptField("poolApiKey", poolApiKey);
  try {
    const res = await fetch(
      `${baseUrl}/pools/${encodeURIComponent(poolName)}/workspaces/${podId}/mark-unused`,
      { method: "POST", headers: { Authorization: `Bearer ${decryptedKey}` } },
    );
    if (!res.ok) console.error(`[karpenter] mark-unused failed for pod ${podId}: ${res.status}`);
  } catch (e) {
    console.error(`[karpenter] mark-unused error for pod ${podId}:`, e);
  }
}
