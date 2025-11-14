import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";

export async function getSwarmConfig(workspaceSlug: string, userId: string) {
  const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, userId);
  if (!workspaceAccess.hasAccess) {
    return { error: "Workspace not found or access denied", status: 403 };
  }

  const swarm = await db.swarm.findFirst({
    where: {
      workspaceId: workspaceAccess.workspace?.id,
    },
  });

  if (!swarm) {
    return { error: "Swarm not found for this workspace", status: 404 };
  }

  if (!swarm.swarmUrl) {
    return { error: "Swarm URL not configured", status: 404 };
  }

  const encryptionService: EncryptionService = EncryptionService.getInstance();
  const decryptedSwarmApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey || "");

  const swarmUrlObj = new URL(swarm.swarmUrl);
  let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
  if (swarm.swarmUrl.includes("localhost")) {
    baseSwarmUrl = `http://localhost:3355`;
  }

  return { baseSwarmUrl, decryptedSwarmApiKey };
}
