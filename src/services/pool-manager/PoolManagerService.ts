import { BaseServiceClass } from "@/lib/base-service";
import { PoolUserResponse, ServiceConfig, PoolStatusResponse, PoolWorkspacesResponse, StaklinkStartResponse } from "@/types";
import { RepositoryConfig } from "@/types/pool-manager";
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
    poolCpu: string | undefined,
    poolMemory: string | undefined,
    github_pat: string | undefined,
    github_username: string | undefined,
    branch_name: string,
    repositories?: RepositoryConfig[],
  ) => Promise<void>;
  getPoolStatus: (poolId: string, poolApiKey: string) => Promise<PoolStatusResponse>;
  getPoolWorkspaces: (poolId: string, poolApiKey: string) => Promise<PoolWorkspacesResponse>;
  startStaklink: (poolId: string, podId: string, poolApiKey: string) => Promise<StaklinkStartResponse>;
}

export class PoolManagerService extends BaseServiceClass implements IPoolManagerService {
  public readonly serviceName = "poolManager";

  constructor(config: ServiceConfig) {
    // Config is already resolved by getServiceConfig() - mock URLs are set there if USE_MOCKS=true
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
    github_pat: string | undefined,
    github_username: string | undefined,
    branch_name: string,
    repositories?: RepositoryConfig[],
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
      branch_name,
      repositories,
    );
  }

  async getPoolStatus(poolId: string, poolApiKey: string): Promise<PoolStatusResponse> {
    try {
      const decryptedApiKey = encryptionService.decryptField("poolApiKey", poolApiKey);

      const response = await fetch(`${this.config.baseURL}/pools/${poolId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${decryptedApiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error("Unable to fetch pool metrics at the moment");
      }

      const data = await response.json();

      return {
        status: {
          runningVms: data.status.running_vms,
          pendingVms: data.status.pending_vms,
          failedVms: data.status.failed_vms,
          usedVms: data.status.used_vms,
          unusedVms: data.status.unused_vms,
          lastCheck: data.status.last_check,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("fetch")) {
        throw new Error("Unable to connect to pool service");
      }
      throw error;
    }
  }

  async getPoolWorkspaces(poolId: string, poolApiKey: string): Promise<PoolWorkspacesResponse> {
    try {
      const decryptedApiKey = encryptionService.decryptField("poolApiKey", poolApiKey);

      const response = await fetch(`${this.config.baseURL}/pools/${poolId}/workspaces`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${decryptedApiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error("Unable to fetch workspace data at the moment");
      }

      const data = await response.json();

      return {
        pool_name: data.pool_name,
        workspaces: data.workspaces.map((vm: any) => ({
          id: vm.id,
          subdomain: vm.subdomain,
          state: vm.state,
          internal_state: vm.internal_state,
          usage_status: vm.usage_status,
          user_info: vm.user_info || null,
          resource_usage: vm.resource_usage,
          marked_at: vm.marked_at || null,
          url: vm.url,
          created: vm.created,
          repoName: vm.repoName,
          primaryRepo: vm.primaryRepo,
          repositories: vm.repositories,
          branches: vm.branches,
          password: vm.password,
        })),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("fetch")) {
        throw new Error("Unable to connect to pool service");
      }
      throw error;
    }
  }

  async startStaklink(poolId: string, podId: string, poolApiKey: string): Promise<StaklinkStartResponse> {
    try {
      const decryptedApiKey = encryptionService.decryptField("poolApiKey", poolApiKey);

      const response = await fetch(
        `${this.config.baseURL}/pools/${poolId}/workspaces/${podId}/staklink-start`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${decryptedApiKey}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to start staklink: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error && error.message.includes("fetch")) {
        throw new Error("Unable to connect to pool service");
      }
      throw error;
    }
  }
}
