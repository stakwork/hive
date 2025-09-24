import { serviceConfigs } from "@/config/services";
import { EncryptionService } from "@/lib/encryption";
import { PoolManagerService } from "@/services/pool-manager/PoolManagerService";
import { ServiceConfig } from "@/types";

const encryptionService = EncryptionService.getInstance();

/**
 * Delete a pool in the Pool Manager service
 * @param poolName - The name of the pool to delete
 * @param poolApiKey - The encrypted API key for authentication
 * @returns Promise that resolves when deletion is complete or rejects with error
 */
export async function deletePool(
  poolName: string,
  poolApiKey: string
): Promise<void> {
  try {
    // Decrypt the API key for authentication
    const decryptedApiKey = encryptionService.decryptField("poolApiKey", poolApiKey);

    if (!decryptedApiKey) {
      throw new Error("Failed to decrypt pool API key");
    }

    // Create Pool Manager service instance with authentication
    const poolManager = new PoolManagerService({
      ...serviceConfigs.poolManager,
      headers: {
        Authorization: `Bearer ${decryptedApiKey}`,
      },
    } as ServiceConfig);

    // Call the delete pool API
    await poolManager.deletePool({ name: poolName });
  } catch (error) {
    console.error(`Failed to delete pool ${poolName}:`, error);
    // Re-throw the error so caller can handle it appropriately
    throw error;
  }
}