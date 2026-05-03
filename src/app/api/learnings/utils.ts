import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

/**
 * Resolve the swarm credentials for a workspace.
 *
 * NOTE: this helper does NOT perform any access control. Callers MUST
 * authorize the request first (e.g. via `resolveWorkspaceAccess` +
 * `requireReadAccess`/`requireMemberAccess`) and only pass the resolved
 * workspaceId here.
 */
export async function getSwarmConfig(workspaceId: string) {
  const swarm = await db.swarm.findFirst({
    where: { workspaceId },
  });

  if (!swarm) {
    return { error: "Swarm not found for this workspace", status: 404 } as const;
  }

  if (!swarm.swarmUrl) {
    return { error: "Swarm URL not configured", status: 404 } as const;
  }

  const encryptionService: EncryptionService = EncryptionService.getInstance();
  const decryptedSwarmApiKey = encryptionService.decryptField(
    "swarmApiKey",
    swarm.swarmApiKey || "",
  );

  const swarmUrlObj = new URL(swarm.swarmUrl);
  let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
  if (swarm.swarmUrl.includes("localhost")) {
    baseSwarmUrl = `http://localhost:3355`;
  }

  return { baseSwarmUrl, decryptedSwarmApiKey } as const;
}
