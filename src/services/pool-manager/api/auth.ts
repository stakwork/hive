import { config, getServiceUrl } from "@/lib/env";
import { AuthBody, PoolManagerAuthResponse } from "@/types/pool-manager";
import { EncryptionService } from "@/lib/encryption";

export async function getPoolManagerApiKey(): Promise<string> {
  const url = `${getServiceUrl("POOL_MANAGER")}/auth/login`;
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
  
  const encryptionService: EncryptionService = EncryptionService.getInstance();
  return JSON.stringify(
    encryptionService.encryptField("poolApiKey", data.token),
  );
}
