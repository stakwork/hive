import { db } from "@/lib/db";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { EncryptionService } from "@/lib/encryption";
import type { JarvisConnectionConfig } from "@/types/jarvis";

/**
 * Resolves a JarvisConnectionConfig for a workspace by its ID.
 * Returns null (never throws) when the workspace has no active swarm configured.
 * Intended for server-side webhook contexts where no slug/userId is available.
 */
export async function getJarvisConfigForWorkspace(
  workspaceId: string,
): Promise<JarvisConnectionConfig | null> {
  try {
    const swarm = await db.swarm.findFirst({
      where: { workspaceId },
      select: { name: true, swarmApiKey: true },
    });

    if (!swarm?.name || !swarm?.swarmApiKey) return null;

    const apiKey = EncryptionService.getInstance().decryptField(
      "swarmApiKey",
      swarm.swarmApiKey,
    );

    return { jarvisUrl: getJarvisUrl(swarm.name), apiKey };
  } catch {
    return null;
  }
}
