import { CreateUserRequest, CreatePoolRequest, DeletePoolRequest, DeleteUserRequest, Pool, PoolUserResponse } from "@/types";
import { HttpClient } from "@/lib/http-client";
import { config } from "@/lib/env";

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

export async function deleteUserApi(
  client: HttpClient,
  user: DeleteUserRequest,
  serviceName: string,
): Promise<void> {
  // First, authenticate with the Pool Manager admin credentials
  const authResponse = await fetch(`${config.POOL_MANAGER_BASE_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: config.POOL_MANAGER_API_USERNAME!,
      password: config.POOL_MANAGER_API_PASSWORD!,
    }),
  });

  if (!authResponse.ok) {
    throw new Error(`Pool Manager authentication failed: ${authResponse.status}`);
  }

  const authData = await authResponse.json();
  if (!authData.success || !authData.token) {
    throw new Error("Pool Manager authentication failed");
  }

  // Delete the user using the admin token
  const deleteResponse = await fetch(`${config.POOL_MANAGER_BASE_URL}/users/${user.username}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${authData.token}`,
      "Content-Type": "application/json",
    },
  });

  if (!deleteResponse.ok) {
    throw new Error(`Failed to delete pool user ${user.username}: ${deleteResponse.status}`);
  }
}
