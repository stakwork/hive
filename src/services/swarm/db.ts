import { db } from "@/lib/db";
import { EncryptionService, encryptEnvVars } from "@/lib/encryption";
import { PoolState, SwarmStatus } from "@prisma/client";

const encryptionService: EncryptionService = EncryptionService.getInstance();

// Add ServiceConfig interface for the services array
export interface ServiceConfig {
  name: string;
  port: number;
  interpreter?: string;
  cwd?: string;
  scripts: {
    start: string;
    install?: string;
    build?: string;
    test?: string;
    preStart?: string;
    postStart?: string;
    rebuild?: string;
    reset?: string;
  };
  env?: Record<string, string>; // Environment variables from stakgraph
}

interface SaveOrUpdateSwarmParams {
  workspaceId: string;
  name?: string; // domain name (vanity_address)
  instanceType?: string;
  environmentVariables?: Record<string, string>[];
  status?: SwarmStatus;
  swarmUrl?: string;
  ec2Id?: string;
  swarmApiKey?: string;
  swarmPassword?: string;
  poolName?: string;
  poolCpu?: string;
  poolMemory?: string;
  services?: ServiceConfig[]; // Use ServiceConfig[]
  swarmId?: string;
  swarmSecretAlias?: string;
  ingestRefId?: string;
  containerFiles?: Record<string, string>;
  poolState?: PoolState;
  ingestRequestInProgress?: boolean;
}

export const select = {
  id: true,
  name: true,
  swarmUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  workspaceId: true,
  instanceType: true,
  ec2Id: true,
  swarmApiKey: true,
  swarmPassword: true,
  graphWebhookSecret: true,
  poolApiKey: true,
  poolName: true,
  poolCpu: true,
  poolMemory: true,
  poolState: true,
  services: true,
  swarmSecretAlias: true,
  swarmId: true,
  ingestRefId: true,
  environmentVariables: true,
  containerFiles: true,
  containerFilesSetUp: true,
  agentRequestId: true,
  agentStatus: true,
  ingestRequestInProgress: true,
};

export async function saveOrUpdateSwarm(params: SaveOrUpdateSwarmParams) {
  let swarm = await db.swarm.findUnique({
    where: { workspaceId: params.workspaceId },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {};
  if (params.name !== undefined) data.name = params.name;
  if (params.instanceType !== undefined) data.instanceType = params.instanceType;
  if (params.environmentVariables !== undefined)
    data.environmentVariables = encryptEnvVars(
      params.environmentVariables as unknown as Array<{
        name: string;
        value: string;
      }>,
    );
  if (params.status !== undefined) data.status = params.status;
  if (params.swarmUrl !== undefined) data.swarmUrl = params.swarmUrl;
  if (params.ec2Id !== undefined) data.ec2Id = params.ec2Id;
  if (params.swarmApiKey !== undefined)
    data.swarmApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", params.swarmApiKey));
  if (params.swarmPassword !== undefined)
    data.swarmPassword = JSON.stringify(encryptionService.encryptField("swarmPassword", params.swarmPassword));
  if (params.poolName !== undefined) data.poolName = params.poolName;
  if (params.poolCpu !== undefined) data.poolCpu = params.poolCpu;
  if (params.poolMemory !== undefined) data.poolMemory = params.poolMemory;
  if (params.swarmId !== undefined) data.swarmId = params.swarmId;
  if (params.swarmSecretAlias !== undefined) data.swarmSecretAlias = params.swarmSecretAlias;
  if (params.poolState !== undefined) data.poolState = params.poolState;

  if (params.services !== undefined) {
    data.services = params.services;
  }
  if (params.containerFiles !== undefined) data.containerFiles = params.containerFiles;
  if (params.ingestRefId !== undefined) data.ingestRefId = params.ingestRefId;
  if (params.ingestRequestInProgress !== undefined) data.ingestRequestInProgress = params.ingestRequestInProgress;
  data.updatedAt = new Date();

  if (swarm) {
    swarm = await db.swarm.update({
      where: { workspaceId: params.workspaceId },
      data,
      select,
    });
  } else {
    const createData = {
      workspaceId: params.workspaceId,
      name: params.name || "",
      instanceType: params.instanceType || "",
      environmentVariables: params.environmentVariables
        ? (encryptEnvVars(
          params.environmentVariables as unknown as Array<{
            name: string;
            value: string;
          }>,
        ) as unknown)
        : [],
      status: params.status || SwarmStatus.PENDING,
      swarmUrl: params.swarmUrl || null,
      ec2Id: params.ec2Id || null,
      swarmApiKey:
        params.swarmApiKey !== undefined
          ? JSON.stringify(encryptionService.encryptField("swarmApiKey", params.swarmApiKey))
          : undefined,
      swarmPassword:
        params.swarmPassword !== undefined
          ? JSON.stringify(encryptionService.encryptField("swarmPassword", params.swarmPassword))
          : undefined,
      poolName: params.poolName || "",
      poolCpu: params.poolCpu || "2",
      poolMemory: params.poolMemory || "4Gi",
      services: params.services ? params.services : [],
      swarmSecretAlias: params.swarmSecretAlias || "",
      containerFiles: params.containerFiles,
      swarmId: params.swarmId,
      ingestRefId: params.ingestRefId,
      poolState: params.poolState || PoolState.NOT_STARTED,
      ingestRequestInProgress: params.ingestRequestInProgress || false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    console.log("[saveOrUpdateSwarm] Create data:", createData);
    swarm = await db.swarm.create({
      data: createData,
      select,
    });
  }
  return swarm;
}
