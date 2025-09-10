import { CreateUserRequest, CreatePoolRequest, DeletePoolRequest, Pool, PoolUserResponse } from "@/types";
import { HttpClient } from "@/lib/http-client";

export async function createPoolApi(client: HttpClient, pool: CreatePoolRequest, serviceName: string): Promise<Pool> {
  return client.post<Pool>("/pools", pool, undefined, serviceName);
}

export async function createUserApi(
  client: HttpClient,
  user: CreateUserRequest,
  serviceName: string,
): Promise<PoolUserResponse> {
  return client.post<PoolUserResponse>("/users", user, undefined, serviceName);
}

export async function deletePoolApi(client: HttpClient, pool: DeletePoolRequest, serviceName: string): Promise<Pool> {
  return client.delete<Pool>(`/pools/${pool.name}`, undefined, serviceName);
}
