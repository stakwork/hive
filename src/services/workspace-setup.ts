import { getServiceConfig } from "@/config/services";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { SWARM_DEFAULT_INSTANCE_TYPE, getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService, encryptEnvVars } from "@/lib/encryption";
import { parseEnv } from "@/lib/env-parser";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { logger } from "@/lib/logger";
import { stakworkService, poolManagerService } from "@/lib/service-factory";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { generateSecurePassword } from "@/lib/utils/password";
import { SwarmService } from "@/services/swarm";
import { swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
import { triggerIngestAsync } from "@/services/swarm/stakgraph-actions";
import { pollAgentProgress } from "@/services/swarm/stakgraph-services";
import { devcontainerJsonContent, extractEnvVarsFromPM2Config, parsePM2Content } from "@/utils/devContainerUtils";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { RepositoryStatus, SwarmStatus } from "@prisma/client";
import { randomUUID } from "crypto";

const P = "[workspace-setup]";
const enc = EncryptionService.getInstance();

function logErr(msg: string, error: unknown) {
  logger.error(`${P} ${msg}: ${error instanceof Error ? error.message : String(error)}`);
}

/**
 * Runs full workspace setup async (fire-and-forget).
 * 1. Create swarm → 2. Parallel: ingest + stakwork customer + services agent → 3. Create pool
 */
export async function runWorkspaceSetup(workspaceId: string, userId: string): Promise<void> {
  try {
    logger.info(`${P} Starting setup for workspace ${workspaceId}`);

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true, repositoryDraft: true },
    });
    if (!workspace?.repositoryDraft) {
      logger.error(`${P} Workspace ${workspaceId} not found or missing repositoryDraft`);
      return;
    }

    const { slug, repositoryDraft: repoUrl } = workspace;

    // Step 1: Link org + create swarm
    await linkSourceControlOrg(workspaceId, repoUrl);
    const swarm = await createSwarm(workspaceId, repoUrl);
    if (!swarm) return;

    await updateDefaultBranch(workspaceId, repoUrl, userId, slug);

    // Step 2: Parallel tasks
    const [, , agentResult] = await Promise.allSettled([
      runIngestion(workspaceId, userId, slug, repoUrl),
      setupStakworkCustomer(workspaceId),
      runServicesAgent(workspaceId, swarm.swarmUrl, swarm.encryptedApiKey, repoUrl, userId, slug),
    ]);

    // Step 3: Pool (only if services agent succeeded)
    if (agentResult.status === "fulfilled") {
      await createPool(workspaceId, userId, slug);
    } else {
      logErr("Services agent failed, skipping pool", agentResult.reason);
    }

    logger.info(`${P} Setup completed for workspace ${workspaceId}`);
  } catch (error) {
    logErr(`Setup failed for workspace ${workspaceId}`, error);
  }
}

async function linkSourceControlOrg(workspaceId: string, repoUrl: string): Promise<void> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: { sourceControlOrg: true },
  });
  if (ws?.sourceControlOrg) return;

  const match = repoUrl.match(/github\.com[\/:]([^\/]+)/);
  if (!match) return;

  const org = await db.sourceControlOrg.findUnique({ where: { githubLogin: match[1] } });
  if (org) {
    await db.workspace.update({ where: { id: workspaceId }, data: { sourceControlOrgId: org.id } });
  }
}

function buildStakgraphUrl(swarmUrl: string): string {
  const clean = swarmUrl.replace("/api", "");
  return swarmUrl.includes("localhost") ? "http://localhost:3355" : `${clean}:3355`;
}

async function createSwarm(workspaceId: string, repoUrl: string) {
  const existing = await db.swarm.findFirst({ where: { workspaceId }, orderBy: { createdAt: "desc" } });

  if (existing?.status === SwarmStatus.ACTIVE && existing.swarmUrl && existing.swarmApiKey) {
    return { swarmUrl: buildStakgraphUrl(existing.swarmUrl), encryptedApiKey: existing.swarmApiKey };
  }

  const repoName = repoUrl.split("/").pop()?.replace(/\.git$/, "") || "repository";
  const placeholder = await db.$transaction(async (tx) => {
    const s = await tx.swarm.create({
      data: { workspaceId, name: randomUUID(), instanceType: SWARM_DEFAULT_INSTANCE_TYPE, status: SwarmStatus.PENDING },
    });
    await tx.repository.create({
      data: { name: repoName, repositoryUrl: repoUrl, branch: "main", workspaceId, status: RepositoryStatus.PENDING },
    });
    return s;
  });

  const swarmService = new SwarmService(getServiceConfig("swarm"));
  const password = generateSecurePassword(20);

  try {
    const res = await swarmService.createSwarm({ instance_type: SWARM_DEFAULT_INSTANCE_TYPE, password });
    const { swarm_id, address, x_api_key, ec2_id } = res?.data ?? {};

    await saveOrUpdateSwarm({
      workspaceId, name: swarm_id, status: SwarmStatus.ACTIVE,
      swarmUrl: `https://${address}/api`, ec2Id: ec2_id, swarmApiKey: x_api_key,
      swarmSecretAlias: swarm_id ? `{{${swarm_id}_API_KEY}}` : undefined,
      swarmId: swarm_id, swarmPassword: password,
    });

    logger.info(`${P} Swarm created: ${swarm_id}`);
    const saved = await db.swarm.findUnique({ where: { workspaceId } });
    return { swarmUrl: buildStakgraphUrl(`https://${address}/api`), encryptedApiKey: saved!.swarmApiKey! };
  } catch (error) {
    await db.swarm.update({ where: { id: placeholder.id }, data: { status: SwarmStatus.FAILED } });
    logErr("Swarm creation failed", error);
    return null;
  }
}

async function updateDefaultBranch(workspaceId: string, repoUrl: string, userId: string, slug: string): Promise<void> {
  try {
    const creds = await getGithubUsernameAndPAT(userId, slug);
    if (!creds?.token) return;

    const { owner, repo } = parseGithubOwnerRepo(repoUrl);
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `token ${creds.token}`, Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) return;

    const { default_branch } = await res.json();
    if (default_branch) {
      await db.repository.updateMany({ where: { workspaceId, repositoryUrl: repoUrl }, data: { branch: default_branch } });
    }
  } catch (error) {
    logErr("Failed to fetch default branch", error);
  }
}

async function runIngestion(workspaceId: string, userId: string, slug: string, repoUrl: string): Promise<void> {
  try {
    const swarm = await db.swarm.findUnique({ where: { workspaceId }, select: { swarmApiKey: true, name: true } });
    if (!swarm?.swarmApiKey) return;

    const creds = await getGithubUsernameAndPAT(userId, slug);
    if (!creds?.username || !creds?.token) return;

    const apiKey = enc.decryptField("swarmApiKey", swarm.swarmApiKey);
    await saveOrUpdateSwarm({ workspaceId, ingestRequestInProgress: true });

    const result = await triggerIngestAsync(
      getSwarmVanityAddress(swarm.name), apiKey, repoUrl,
      { username: creds.username, pat: creds.token },
      getStakgraphWebhookCallbackUrl(), false,
    );

    if (result?.data && typeof result.data === "object" && "request_id" in result.data) {
      await saveOrUpdateSwarm({ workspaceId, ingestRefId: (result.data as { request_id: string }).request_id });
    }
    await saveOrUpdateSwarm({ workspaceId, ingestRequestInProgress: false });
  } catch (error) {
    await saveOrUpdateSwarm({ workspaceId, ingestRequestInProgress: false }).catch(() => {});
    logErr("Ingestion failed", error);
  }
}

async function setupStakworkCustomer(workspaceId: string): Promise<void> {
  try {
    const res = await stakworkService().createCustomer(workspaceId);
    const token = (res as { data?: { token?: string } })?.data?.token;
    if (!token) return;

    await db.workspace.update({
      where: { id: workspaceId },
      data: { stakworkApiKey: JSON.stringify(enc.encryptField("stakworkApiKey", token)) },
    });

    const swarm = await db.swarm.findFirst({ where: { workspaceId } });
    if (!swarm?.swarmSecretAlias || !swarm.swarmApiKey) return;

    const alias = swarm.swarmSecretAlias.replace(/{{(.*?)}}/g, "$1");
    if (alias) {
      const apiKey = enc.decryptField("swarmApiKey", swarm.swarmApiKey);
      await stakworkService().createSecret(alias, apiKey, token);
    }
  } catch (error) {
    logErr("Stakwork customer creation failed", error);
  }
}

async function runServicesAgent(
  workspaceId: string, swarmUrl: string, encryptedApiKey: string,
  repoUrl: string, userId: string, slug: string,
): Promise<void> {
  const creds = await getGithubUsernameAndPAT(userId, slug);
  const { owner, repo } = parseGithubOwnerRepo(repoUrl);

  const initResult = await swarmApiRequestAuth({
    swarmUrl, endpoint: "/services_agent", method: "GET",
    params: { owner, repo, ...(creds?.username ? { username: creds.username } : {}), ...(creds?.token ? { pat: creds.token } : {}) },
    apiKey: encryptedApiKey,
  });
  if (!initResult.ok) throw new Error("Services agent init failed");

  const requestId = (initResult.data as { request_id: string }).request_id;
  if (!requestId) throw new Error("No request_id from services agent");

  const swarm = await db.swarm.findUnique({ where: { workspaceId } });
  if (!swarm) throw new Error("Swarm not found");

  await db.swarm.update({ where: { id: swarm.id }, data: { agentRequestId: requestId, agentStatus: "PROCESSING" } });

  const agentResult = await pollAgentProgress(swarmUrl, requestId, encryptedApiKey);
  if (!agentResult.ok) {
    await db.swarm.update({ where: { id: swarm.id }, data: { agentStatus: "FAILED", agentRequestId: null } });
    throw new Error("Services agent polling failed");
  }

  // Process agent output
  const files = agentResult.data as Record<string, string>;
  const primaryRepo = await getPrimaryRepository(workspaceId);
  if (!primaryRepo?.repositoryUrl) throw new Error("No repository URL found");

  const services = parsePM2Content(files["pm2.config.js"]);

  let envVars: Record<string, string> = {};
  if (files[".env"]) {
    try {
      let text = files[".env"];
      try { const d = Buffer.from(text, "base64").toString("utf-8"); if (d.includes("=")) text = d; } catch {}
      envVars = parseEnv(text);
    } catch {}
  }

  const { repo: repoName } = parseGithubOwnerRepo(primaryRepo.repositoryUrl);
  await saveOrUpdateSwarm({
    workspaceId, services,
    environmentVariables: Object.entries(envVars).map(([name, value]) => ({ name, value })),
    containerFiles: {
      Dockerfile: Buffer.from("FROM ghcr.io/stakwork/staklink-universal:latest").toString("base64"),
      "pm2.config.js": Buffer.from(files["pm2.config.js"] || "").toString("base64"),
      "docker-compose.yml": Buffer.from(files["docker-compose.yml"] || "").toString("base64"),
      "devcontainer.json": Buffer.from(devcontainerJsonContent(repoName)).toString("base64"),
    },
  });

  // Save per-service env vars from PM2 config
  if (files["pm2.config.js"]) {
    try {
      const perService = extractEnvVarsFromPM2Config(files["pm2.config.js"]);
      for (const [svc, vars] of perService) {
        await db.environmentVariable.deleteMany({ where: { swarmId: swarm.id, serviceName: svc } });
        if (vars.length > 0) {
          const encrypted = encryptEnvVars(vars);
          await db.environmentVariable.createMany({
            data: encrypted.map((ev) => ({ swarmId: swarm.id, serviceName: svc, name: ev.name, value: JSON.stringify(ev.value) })),
          });
        }
      }
    } catch {}
  }

  await db.swarm.update({
    where: { id: swarm.id },
    data: { agentStatus: "COMPLETED", agentRequestId: null, containerFilesSetUp: true },
  });
}

async function createPool(workspaceId: string, userId: string, slug: string): Promise<void> {
  try {
    const swarm = await db.swarm.findFirst({ where: { workspaceId } });
    if (!swarm) return;

    let poolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
    if (!poolApiKey) {
      await updateSwarmPoolApiKeyFor(swarm.id);
      poolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
    }
    if (!poolApiKey) return;

    const creds = await getGithubUsernameAndPAT(userId, slug);
    const containerFiles = (swarm.containerFiles && typeof swarm.containerFiles === "object")
      ? swarm.containerFiles as Record<string, string> : {};

    const repos = await db.repository.findMany({ where: { workspaceId } });
    const primary = repos[0];

    const pm = poolManagerService();
    pm.updateApiKey(enc.decryptField("poolApiKey", poolApiKey));

    try {
      await pm.createPool({
        pool_name: swarm.id, minimum_vms: 2,
        repo_name: primary?.repositoryUrl || "", branch_name: primary?.branch || "",
        repositories: repos.length > 1 ? repos.map((r) => ({ url: r.repositoryUrl, branch: r.branch || "" })) : undefined,
        github_pat: creds?.token || "", github_username: creds?.username || "",
        env_vars: [], container_files: containerFiles,
      });
    } catch (error) {
      if (!(error instanceof Error && error.message.toLowerCase().includes("already exists"))) throw error;
    }

    await saveOrUpdateSwarm({ workspaceId, poolName: swarm.swarmId || undefined, poolState: "COMPLETE", podState: "NOT_STARTED" });
  } catch (error) {
    await saveOrUpdateSwarm({ workspaceId, poolState: "FAILED" }).catch(() => {});
    logErr("Pool creation failed", error);
  }
}
