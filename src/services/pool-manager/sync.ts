import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { PoolManagerService } from "@/services/pool-manager";
import { getServiceConfig } from "@/config/services";
import { ServiceConfig, RepositoryConfig } from "@/types";
import {
  getDevContainerFilesFromBase64,
  generatePM2Apps,
  formatPM2Apps,
  devcontainerJsonContent,
  dockerComposeContent,
  dockerfileContent,
} from "@/utils/devContainerUtils";
import { ServiceDataConfig } from "@/components/stakgraph/types";

const encryptionService = EncryptionService.getInstance();

/**
 * Parse env vars from existing PM2 config content
 * Returns a map of service name -> env vars
 */
function parseEnvVarsFromPM2Config(pm2Content: string): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();

  try {
    // Match each app block with its name and env
    const appBlockRegex = /\{\s*name:\s*["']([^"']+)["'][^}]*env:\s*\{([^}]*)\}/g;
    let match;

    while ((match = appBlockRegex.exec(pm2Content)) !== null) {
      const serviceName = match[1];
      const envBlock = match[2];
      const envVars: Record<string, string> = {};

      // Parse individual env var entries
      const envVarRegex = /(\w+):\s*["']([^"']*)["']/g;
      let envMatch;

      while ((envMatch = envVarRegex.exec(envBlock)) !== null) {
        envVars[envMatch[1]] = envMatch[2];
      }

      if (Object.keys(envVars).length > 0) {
        result.set(serviceName, envVars);
      }
    }
  } catch (error) {
    console.warn("[parseEnvVarsFromPM2Config] Failed to parse PM2 config:", error);
  }

  return result;
}

export interface SyncPoolManagerParams {
  workspaceId: string;
  workspaceSlug: string;
  swarmId: string;
  poolApiKey: string; // encrypted
  poolCpu?: string | null;
  poolMemory?: string | null;
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
export async function syncPoolManagerSettings(params: SyncPoolManagerParams): Promise<SyncPoolManagerResult> {
  const { workspaceId, workspaceSlug, swarmId, poolApiKey, poolCpu, poolMemory, userId } = params;

  try {
    // Decrypt pool API key
    const decryptedPoolApiKey = encryptionService.decryptField("poolApiKey", poolApiKey);

    const config = getServiceConfig("poolManager");
    const poolManager = new PoolManagerService(config as unknown as ServiceConfig);

    // Get current env vars from Pool Manager (returns { key, value } format)
    const currentEnvVarsRaw = await poolManager.getPoolEnvVars(swarmId, decryptedPoolApiKey);

    // Transform to expected format { name, value, masked }
    const currentEnvVars = currentEnvVarsRaw.map((env) => ({
      name: env.key,
      value: env.value,
      masked: true, // Existing vars are masked
    }));

    // Fetch environment variables from database
    const allEnvVars = await db.environmentVariable.findMany({
      where: { swarmId },
    });

    // Decrypt and separate global vs service-specific env vars
    const globalEnvVars: Array<{ name: string; value: string }> = [];
    const serviceEnvVarsMap = new Map<string, Array<{ name: string; value: string }>>();

    for (const envVar of allEnvVars) {
      const decryptedValue = encryptionService.decryptField("environmentVariables", envVar.value);
      const envEntry = { name: envVar.name, value: decryptedValue };

      if (!envVar.serviceName || envVar.serviceName === "") {
        // Global env var
        globalEnvVars.push(envEntry);
      } else {
        // Service-specific env var
        if (!serviceEnvVarsMap.has(envVar.serviceName)) {
          serviceEnvVarsMap.set(envVar.serviceName, []);
        }
        serviceEnvVarsMap.get(envVar.serviceName)!.push(envEntry);
      }
    }

    // Fetch swarm data for services, containerFiles, and repository info
    const swarm = await db.swarm.findUnique({
      where: { id: swarmId },
    });

    if (!swarm) {
      return {
        success: false,
        error: "Swarm not found",
      };
    }

    // Get repository name for file generation
    const repository = await db.repository.findFirst({
      where: { workspaceId: swarm.workspaceId },
    });
    const repoName = repository?.name || workspaceSlug;

    // Convert swarm services to ServiceDataConfig format
    let services: ServiceDataConfig[] = [];
    if (swarm.services) {
      try {
        const parsedServices = typeof swarm.services === "string" ? JSON.parse(swarm.services) : swarm.services;
        services = Array.isArray(parsedServices) ? parsedServices : [];

        // Merge service-specific env vars into service.env
        services = services.map((service) => {
          const serviceEnvVars = serviceEnvVarsMap.get(service.name);
          if (serviceEnvVars && serviceEnvVars.length > 0) {
            const envObject: Record<string, string> = {};
            serviceEnvVars.forEach(({ name, value }) => {
              envObject[name] = value;
            });
            return {
              ...service,
              env: {
                ...service.env,
                ...envObject,
              },
            };
          }
          return service;
        });
      } catch (error) {
        console.warn("Failed to parse swarm services:", error);
        services = [];
      }
    }

    // Generate container files with merged env vars
    const pm2Apps = generatePM2Apps(repoName, services, globalEnvVars);

    // Parse existing PM2 config to preserve any env vars not in the new config
    const existingContainerFiles = (swarm.containerFiles as Record<string, string>) || {};
    if (existingContainerFiles["pm2.config.js"]) {
      try {
        const existingPM2Content = Buffer.from(existingContainerFiles["pm2.config.js"], "base64").toString("utf-8");
        const existingEnvVarsPerService = parseEnvVarsFromPM2Config(existingPM2Content);

        // Merge existing env vars into new pm2Apps (existing takes precedence)
        for (const app of pm2Apps) {
          const existingEnvVars = existingEnvVarsPerService.get(app.name);
          if (existingEnvVars) {
            // Apply existing env vars on top of new ones (existing wins)
            app.env = { ...app.env, ...existingEnvVars };
          }
        }
      } catch (error) {
        console.warn("[PoolManagerSync] Failed to parse existing PM2 config, proceeding with new config:", error);
      }
    }

    const containerFilesContent = {
      "devcontainer.json": devcontainerJsonContent(repoName),
      "pm2.config.js": `module.exports = {\n  apps: ${formatPM2Apps(pm2Apps)},\n};\n`,
      "docker-compose.yml": dockerComposeContent(),
      Dockerfile: dockerfileContent(),
    };

    // Base64 encode the generated files
    const base64ContainerFiles = Object.entries(containerFilesContent).reduce(
      (acc, [name, content]) => {
        acc[name] = Buffer.from(content).toString("base64");
        return acc;
      },
      {} as Record<string, string>,
    );

    // Save regenerated container files to database
    // Preserve user-modified files (Dockerfile, docker-compose.yml, devcontainer.json)
    // Only regenerate pm2.config.js which is based on services
    const mergedContainerFiles = {
      ...base64ContainerFiles, // defaults first
      ...existingContainerFiles, // user modifications take precedence
      "pm2.config.js": base64ContainerFiles["pm2.config.js"], // always regenerate pm2
    };
    await db.swarm.update({
      where: { id: swarmId },
      data: { containerFiles: mergedContainerFiles },
    });

    // Convert to DevContainerFile format for Pool Manager API
    // Use mergedContainerFiles to preserve user modifications (Dockerfile, docker-compose, etc.)
    const files = getDevContainerFilesFromBase64(mergedContainerFiles);

    // Get GitHub credentials - use provided userId or fall back to workspace owner
    let effectiveUserId = userId;
    if (!effectiveUserId) {
      const workspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { ownerId: true },
      });
      effectiveUserId = workspace?.ownerId;
    }

    const githubCreds = effectiveUserId ? await getGithubUsernameAndPAT(effectiveUserId, workspaceSlug) : null;

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

    // Environment variables are now embedded in PM2 config, pass empty array
    // Call Pool Manager update API - only pass GitHub credentials if available
    await poolManager.updatePoolData(
      swarmId,
      decryptedPoolApiKey,
      globalEnvVars, // Empty array - all env vars now in PM2 config
      currentEnvVars,
      files,
      poolCpu || undefined,
      poolMemory || undefined,
      githubCreds?.token,
      githubCreds?.username,
      primaryRepo?.branch || "",
      repositoriesConfig,
    );

    console.log(`[PoolManagerSync] Successfully synced settings for workspace ${workspaceSlug}`);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[PoolManagerSync] Failed to sync settings for workspace ${workspaceSlug}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}
