import { config } from "@/lib/env";
import { AuthBody, PoolManagerAuthResponse } from "@/types/pool-manager";
import { EncryptionService } from "@/lib/encryption";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function getPoolManagerApiKey(): Promise<string> {
  const url = `${config.POOL_MANAGER_BASE_URL}/auth/login`;
  const body: AuthBody = {
    username: config.POOL_MANAGER_API_USERNAME!,
    password: config.POOL_MANAGER_API_PASSWORD!,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Unexpected status code: ${response.status}`);
  }

  const data = (await response.json()) as PoolManagerAuthResponse;
  if (!data.success) {
    throw new Error("Authentication failed");
  }
  return JSON.stringify(
    encryptionService.encryptField("poolApiKey", data.token),
  );
}
