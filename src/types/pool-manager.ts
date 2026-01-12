// Pool Manager-specific types and interfaces

import { z } from "zod";
import { EnvironmentVariable } from "./wizard";

//Example Payload
// {
//   "username": "test",
//   "email": "test@test.com",
//   "password": "testasdasd"
// }
export interface CreateUserRequest {
  email: string;
  password: string;
  username: string;
}
//Response:
// {
//   "message": "User 'test' created successfully",
//   "success": true,
//   "user": {
//       "authentication_token": "Ian3duxe8RL-v10fnxTsLLXizMJgVtYRPAta_SLP5_s",
//       "created_at": "2025-07-18T16:20:21.833950",
//       "email": "test@test.com",
//       "is_active": true,
//       "last_login": null,
//       "pool_count": 0,
//       "pools": [],
//       "username": "test"
//   }
// }
// Use authentication_token in the call to CreatePool under Authorization: Bearer ${authentication_token}

//Example payload
// {
//   "pool_name": "my-pool-name",
//   "minimum_vms": 1,
//   "repo_name": "https://github.com/gonzaloaune/ganamos",
//   "branch_name": "main",
//   "github_pat": "ghp_asjidjasdjkasdkjsakjdkja",
//   "github_username": "gonzaloaune",
//   "env_vars": [
//       {
//           "name": "my-env",
//           "value": "my-env-value",
//           "masked": false
//       }
//   ]
// }
export interface CreatePoolRequest {
  pool_name: string;
  minimum_vms: number;
  repo_name: string;
  branch_name: string;
  github_pat: string;
  github_username: string;
  env_vars: EnvironmentVariable[]; //Key value pair of name and value
  container_files: Record<string, string>; // Generated server-side from database services
}
//Response:
// {
//   "message": "Pool 'my-pool-name' created successfully",
//   "owner": "admin",
//   "pool": {
//       "branch_name": "main",
//       "created_at": "2025-07-18T15:33:53.711824",
//       "env_vars": [
//           {
//               "masked": true,
//               "name": "my-env",
//               "value": "my********ue"
//           }
//       ],
//       "github_pat": {
//           "masked": true,
//           "value": "gh************************ja"
//       },
//       "github_username": "gonzaloaune",
//       "minimum_vms": 1,
//       "owner_username": null,
//       "pool_name": "my-pool-name",
//       "repo_name": "https://github.com/gonzaloaune/ganamos"
//   },
//   "success": true
// }

export interface DeletePoolRequest {
  name: string;
}

export interface DeleteUserRequest {
  username: string;
}

export interface PoolUser {
  email: string;
  username: string;
  authentication_token: string;
}

export interface PoolUserResponse {
  user: PoolUser;
}
export interface Pool {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  status: "active" | "archived" | "deleted";
}

export interface AuthBody {
  username: string;
  password: string;
}

export interface PoolManagerAuthResponse {
  success: boolean;
  token: string;
}

export interface PoolStatus {
  runningVms: number;
  pendingVms: number;
  failedVms: number;
  usedVms: number;
  unusedVms: number;
  lastCheck: string;
}

export interface PoolStatusResponse {
  status: PoolStatus;
}

export interface VMResourceUsage {
  available: boolean;
  requests: {
    cpu: string;
    memory: string;
  };
  usage: {
    cpu: string;
    memory: string;
  };
}

export interface VMData {
  id: string;
  subdomain: string;
  state: string;
  internal_state: string;
  usage_status: "used" | "unused";
  user_info: string | null;
  resource_usage: VMResourceUsage;
  marked_at: string | null;
  url?: string;
  created?: string;
  repoName?: string;
  primaryRepo?: string;
  repositories?: string[];
  branches?: string[];
  password?: string;
}

export interface PoolWorkspacesResponse {
  pool_name: string;
  workspaces: VMData[];
}

export interface StaklinkStartResponse {
  success: boolean;
  message: string;
  workspace_id: string;
  namespace?: string;
  output?: string;
  pod_name?: string;
}

// Pod Launch Failure Webhook types

export interface ContainerStatus {
  name: string;
  type: "init" | "container";
  status: "terminated" | "waiting" | "running";
  exitCode: number | null;
  reason: string | null;
  logs: string;
  lastExitCode?: number;
  lastReason?: string;
}

export interface PodLaunchFailureWebhookPayload {
  poolName: string; // Maps to Swarm.id (pool_name in Pool Manager)
  podId: string; // Pod subdomain
  eventMessage: string; // Main failure message
  timestamp: string; // ISO timestamp
  reason: string; // Failure reason (e.g., "BackOff")
  containers: ContainerStatus[]; // Container status details
}

const ContainerStatusSchema = z.object({
  name: z.string(),
  type: z.enum(["init", "container"]),
  status: z.enum(["terminated", "waiting", "running"]),
  exitCode: z.number().nullable(),
  reason: z.string().nullable(),
  logs: z.string(),
  lastExitCode: z.number().optional(),
  lastReason: z.string().optional(),
});

export const PodLaunchFailureWebhookSchema = z.object({
  poolName: z.string().min(1),
  podId: z.string().min(1),
  eventMessage: z.string(),
  timestamp: z.string(),
  reason: z.string(),
  containers: z.array(ContainerStatusSchema),
});

// Ordered list of memory tiers for auto-bump on OOMKilled
export const POOL_MEMORY_TIERS = [
  "1Gi",
  "2Gi",
  "4Gi",
  "6Gi",
  "8Gi",
  "10Gi",
  "12Gi",
  "14Gi",
  "16Gi",
] as const;
export type PoolMemoryTier = (typeof POOL_MEMORY_TIERS)[number];

export function getNextMemoryTier(
  current: string | null | undefined
): PoolMemoryTier | null {
  if (!current) return "2Gi";
  const currentIndex = POOL_MEMORY_TIERS.indexOf(current as PoolMemoryTier);
  if (currentIndex === -1) return "2Gi";
  if (currentIndex >= POOL_MEMORY_TIERS.length - 1) return null;
  return POOL_MEMORY_TIERS[currentIndex + 1];
}
