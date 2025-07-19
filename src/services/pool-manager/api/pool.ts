import { CreateUserRequest, CreatePoolRequest, GetPoolRequest, DeletePoolRequest, UpdatePoolRequest, Pool, PoolUser } from '@/types';
import { HttpClient } from '@/lib/http-client';

export async function createPoolApi(
  client: HttpClient,
  pool: CreatePoolRequest,
  serviceName: string
): Promise<Pool> {
  return client.post<Pool>('/workspaces', pool, undefined, serviceName);
} 

export async function createUserApi(
  client: HttpClient,
  user: CreateUserRequest,
  serviceName: string
): Promise<PoolUser> {
  return client.post<PoolUser>('/users', user, undefined, serviceName);
} 

export async function getPoolApi(
  client: HttpClient,
  pool: GetPoolRequest,
  serviceName: string
): Promise<Pool> {
  return client.get<Pool>(`/workspaces/${pool.name}`, undefined, serviceName);
} 

export async function updatePoolApi(
  client: HttpClient,
  pool: UpdatePoolRequest,
  serviceName: string
): Promise<Pool> {
  return client.put<Pool>(`/workspaces/${pool.name}`, pool, undefined, serviceName);
} 

export async function deletePoolApi(
  client: HttpClient,
  pool: DeletePoolRequest,
  serviceName: string
): Promise<Pool> {
  return client.delete<Pool>(`/workspaces/${pool.name}`, undefined, serviceName);
} 