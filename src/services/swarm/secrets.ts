// lib/secrets/swarms.ts
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { env } from "@/lib/env";
import { generateSecurePassword } from "@/lib/utils/password";
import { PoolManagerService } from "../pool-manager";

const encryptionService: EncryptionService = EncryptionService.getInstance();

// TO-DO add role check
export async function getSwarmPoolApiKeyFor(id: string): Promise<string> {
  const swarm = await db.swarm.findFirst({
    where: { id },
    select: { id: true, poolApiKey: true } as { id: true; poolApiKey: true },
  });

  if (!swarm?.poolApiKey) {
    return "";
  }

  return swarm.poolApiKey;
}

export async function updateSwarmPoolApiKeyFor(id: string) {
  const loginResponse = await fetch("https://workspaces.sphinx.chat/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "admin",
      password: env.POOL_MANAGER_API_PASSWORD,
    }),
  });

  const swarm = await db.swarm.findFirst({
    where: { id },
    select: { swarmId: true } as { swarmId: true },
  });
  console.log(">>>> swarm", swarm);

  const loginData = await loginResponse.json();

  const poolManager = new PoolManagerService({
    baseURL: "https://workspaces.sphinx.chat/api",
    apiKey: JSON.stringify(encryptionService.encryptField("poolApiKey", loginData.token)),
    headers: {
      Authorization: `Bearer ${loginData.token}`,
    },
  });

  if (!swarm?.swarmId) {
    console.log("swarm.swarmId not found");
    return;
  }

  const password = generateSecurePassword(12);

  try {
    const { user: poolUser } = await poolManager.createUser({
      email: `${swarm.swarmId.toLowerCase()}@stakwork.com`,
      password,
      username: `${swarm.swarmId.toLowerCase()}`,
    });

    const poolApiKey = JSON.stringify(encryptionService.encryptField("poolApiKey", poolUser.authentication_token));

    await db.swarm.update({
      where: { id },
      data: { poolApiKey },
    });
  } catch (error) {
    console.log("updateSwarmPoolApiKeyFor");
    console.log(error);
    console.log("updateSwarmPoolApiKeyFor");
    console.error(error);
  }
}
