import { BaseServiceClass } from "@/lib/base-service";
import { PoolUserResponse, ServiceConfig, PoolStatusResponse } from "@/types";
import { CreateUserRequest, CreatePoolRequest, DeletePoolRequest, DeleteUserRequest, Pool } from "@/types";
import { fetchPoolEnvVars, updatePoolDataApi } from "@/services/pool-manager/api/envVars";
import { createUserApi, createPoolApi, deletePoolApi, deleteUserApi } from "@/services/pool-manager/api/pool";
import { DevContainerFile } from "@/utils/devContainerUtils";
import { EncryptionService } from "@/lib/encryption";

const encryptionService: EncryptionService = EncryptionService.getInstance();

interface IPoolManagerService {
  createUser: (user: CreateUserRequest) => Promise<PoolUserResponse>;
  deleteUser: (user: DeleteUserRequest) => Promise<void>;
  createPool: (pool: CreatePoolRequest) => Promise<Pool>;
  deletePool: (pool: DeletePoolRequest) => Promise<Pool>;
  getPoolEnvVars: (poolName: string, poolApiKey: string) => Promise<Array<{ key: string; value: string }>>;
  updatePoolData: (
    poolName: string,
    poolApiKey: string,
    envVars: Array<{ name: string; value: string }>,
    currentEnvVars: Array<{ name: string; value: string; masked?: boolean }>,
    containerFiles: Record<string, DevContainerFile>,
    poolCpu: string,
    poolMemory: string,
    github_pat: string,
    github_username: string,
  ) => Promise<void>;
  getPoolStatus: (poolId: string, poolApiKey: string) => Promise<PoolStatusResponse>;
}

export class PoolManagerService extends BaseServiceClass implements IPoolManagerService {
  public readonly serviceName = "poolManager";

  constructor(config: ServiceConfig) {
    super(config);
  }

  async createPool(pool: CreatePoolRequest): Promise<Pool> {
    return createPoolApi(this.getClient(), pool, this.serviceName);
  }

  async createUser(user: CreateUserRequest): Promise<PoolUserResponse> {
    return createUserApi(this.getClient(), user, this.serviceName);
  }

  async deleteUser(user: DeleteUserRequest): Promise<void> {
    return deleteUserApi(this.getClient(), user, this.serviceName);
  }

  async deletePool(pool: DeletePoolRequest): Promise<Pool> {
    return deletePoolApi(this.getClient(), pool, this.serviceName);
  }

  async getPoolEnvVars(poolName: string, poolApiKey: string): Promise<Array<{ key: string; value: string }>> {
    return fetchPoolEnvVars(poolName, encryptionService.decryptField("poolApiKey", poolApiKey));
  }

  async updatePoolData(
    poolName: string,
    poolApiKey: string,
    envVars: Array<{ name: string; value: string }>,
    currentEnvVars: Array<{ name: string; value: string; masked?: boolean }>,
    containerFiles: Record<string, DevContainerFile>,
    poolCpu: string | undefined,
    poolMemory: string | undefined,
    github_pat: string,
    github_username: string,
  ): Promise<void> {
    return updatePoolDataApi(
      poolName,
      encryptionService.decryptField("poolApiKey", poolApiKey),
      envVars,
      currentEnvVars,
      containerFiles,
      poolCpu,
      poolMemory,
      github_pat,
      github_username,
    );
  }

  async getPoolStatus(poolId: string, poolApiKey: string): Promise<PoolStatusResponse> {
    const decryptedApiKey = encryptionService.decryptField("poolApiKey", poolApiKey);
    const response = await this.getClient().get(`/pools/${poolId}`, {
      headers: {
        Authorization: `Bearer ${decryptedApiKey}`,
      },
    });

    const data = response.data;
    return {
      status: {
        runningVms: data.status.running_vms,
        pendingVms: data.status.pending_vms,
        failedVms: data.status.failed_vms,
        lastCheck: data.status.last_check,
      },
    };
  }
}
