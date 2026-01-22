import { db } from "@/lib/db";
import { EncryptionService, decryptEnvVars } from "@/lib/encryption";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { PoolManagerService } from "@/services/pool-manager";
import { getServiceConfig } from "@/config/services";
import { ServiceConfig, RepositoryConfig } from "@/types";
import { DevContainerFile, getDevContainerFilesFromBase64 } from "@/utils/devContainerUtils";

const encryptionService = EncryptionService.getInstance();

export interface SyncPoolManagerParams {
  workspaceId: string;
  workspaceSlug: string;
  swarmId: string;
  poolApiKey: string; // encrypted
  poolCpu?: string | null;
  poolMemory?: string | null;
  environmentVariables?: Array<{ name: string; value: string }>;
  containerFiles?: Record<string, string>; // base64 encoded files
  userId?: string; // optional - for getting GitHub credentials
}

export interface SyncPoolManagerResult {
  success: boolean;
  error?: string;
}

/**
 * Sync pool settings to Pool Manager
 * Extracted from stakgraph route for reuse in memory bump and other scenarios
 */
export async function syncPoolManagerSettings(
  params: SyncPoolManagerParams
): Promise<SyncPoolManagerResult> {
  const {
    workspaceId,
    workspaceSlug,
    swarmId,
    poolApiKey,
    poolCpu,
    poolMemory,
    environmentVariables,
    containerFiles,
    userId,
  } = params;

  try {
    // Decrypt pool API key
    const decryptedPoolApiKey = encryptionService.decryptField(
      "poolApiKey",
      poolApiKey
    );

    const config = getServiceConfig("poolManager");
    const poolManager = new PoolManagerService(config as unknown as ServiceConfig);

    // Get current env vars from Pool Manager (returns { key, value } format)
    const currentEnvVarsRaw = await poolManager.getPoolEnvVars(
      swarmId,
      decryptedPoolApiKey
    );

    // Transform to expected format { name, value, masked }
    const currentEnvVars = currentEnvVarsRaw.map((env) => ({
      name: env.key,
      value: env.value,
      masked: true, // Existing vars are masked
    }));

    // Get container files - either from params or fetch from swarm
    let files: Record<string, DevContainerFile>;
    if (containerFiles) {
      files = getDevContainerFilesFromBase64(containerFiles);
    } else {
      // Fetch from swarm if not provided
      const swarm = await db.swarm.findUnique({
        where: { id: swarmId },
        select: { containerFiles: true },
      });

      if (!swarm?.containerFiles) {
        return {
          success: false,
          error: "No container files found for swarm",
        };
      }

      files = getDevContainerFilesFromBase64(
        swarm.containerFiles as Record<string, string>
      );
    }

    // Get environment variables - either from params or fetch from swarm
    let envVars: Array<{ name: string; value: string }>;
    if (environmentVariables) {
      envVars = environmentVariables;
    } else {
      const swarm = await db.swarm.findUnique({
        where: { id: swarmId },
        select: { environmentVariables: true },
      });

      // Decrypt env vars from database (they are stored encrypted)
      const rawEnvVars = (swarm?.environmentVariables as Array<{ name: string; value: unknown }>) || [];
      envVars = rawEnvVars.length > 0 ? decryptEnvVars(rawEnvVars) : [];
    }

    // Get GitHub credentials - use provided userId or fall back to workspace owner
    let effectiveUserId = userId;
    if (!effectiveUserId) {
      const workspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { ownerId: true },
      });
      effectiveUserId = workspace?.ownerId;
    }

    const githubCreds = effectiveUserId
      ? await getGithubUsernameAndPAT(effectiveUserId, workspaceSlug)
      : null;

    // Get primary repo branch
    const primaryRepo = await getPrimaryRepository(workspaceId);

    // Get all repositories for multi-repo support
    const allRepositories = await db.repository.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    });

    // Build repositories config for multi-repo support (only if more than 1 repo)
    const repositoriesConfig: RepositoryConfig[] | undefined =
      allRepositories.length > 1
        ? allRepositories.map((repo) => ({
            url: repo.repositoryUrl,
            branch: repo.branch || "",
          }))
        : undefined;

    // Call Pool Manager update API - only pass GitHub credentials if available
    await poolManager.updatePoolData(
      swarmId,
      decryptedPoolApiKey,
      envVars,
      currentEnvVars,
      files,
      poolCpu || undefined,
      poolMemory || undefined,
      githubCreds?.token,
      githubCreds?.username,
      primaryRepo?.branch || "",
      repositoriesConfig
    );

    console.log(
      `[PoolManagerSync] Successfully synced settings for workspace ${workspaceSlug}`
    );

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[PoolManagerSync] Failed to sync settings for workspace ${workspaceSlug}:`,
      errorMessage
    );
    return { success: false, error: errorMessage };
  }
}
