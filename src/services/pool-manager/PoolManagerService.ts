import { BaseServiceClass } from '@/lib/base-service';
import { ServiceConfig } from '@/types';
import { CreateUserRequest, CreatePoolRequest, GetPoolRequest, DeletePoolRequest, UpdatePoolRequest, Pool, PoolUser } from '@/types';
import { fetchPoolEnvVars, updatePoolEnvVarsApi } from '@/services/pool-manager/api/envVars';
import { createUserApi, createPoolApi, getPoolApi, deletePoolApi, updatePoolApi } from '@/services/pool-manager/api/pool';

export class PoolManagerService extends BaseServiceClass {
  public readonly serviceName = 'poolManager';

  constructor(config: ServiceConfig) {
    super(config);
  }

  async createPool(pool: CreatePoolRequest): Promise<Pool> {
    return createPoolApi(this.getClient(), pool, this.serviceName);
  }

  async createUser(user: CreateUserRequest): Promise<PoolUser> {
    return createUserApi(this.getClient(), user, this.serviceName);
  }

  async getPool(pool: GetPoolRequest): Promise<Pool> {
    return getPoolApi(this.getClient(), pool, this.serviceName);
  }

  async updatePool(pool: UpdatePoolRequest): Promise<Pool> {
    return updatePoolApi(this.getClient(), pool, this.serviceName);
  }

  async deletePool(pool: DeletePoolRequest): Promise<Pool> {
    return deletePoolApi(this.getClient(), pool, this.serviceName);
  }

  async getPoolEnvVars(poolName: string, poolApiKey: string) {
    return fetchPoolEnvVars(poolName, poolApiKey);
  }

  async updatePoolEnvVars(
    poolName: string,
    poolApiKey: string,
    envVars: Array<{ key: string; value: string }>,
    currentEnvVars: Array<{ key: string; value: string; masked?: boolean }>
  ) {
    return updatePoolEnvVarsApi(poolName, poolApiKey, envVars, currentEnvVars);
  }
} 