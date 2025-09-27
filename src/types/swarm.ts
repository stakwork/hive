// Swarm-specific types and interfaces

export interface CreateSwarmRequest {
  // name: string;
  instance_type: string;
  password?: string;
}

export interface StopSwarmRequest {
  instance_id: string;
}

export interface Swarm {
  swarm_id: string;
  name: string;
  vanity_address: string;
  instance_type: string;
  env?: Record<string, string>;
}

export interface CreateSwarmResponse {
  success: boolean;
  message: string;
  data: {
    swarm_id: string;
    address: string;
    x_api_key: string;
    ec2_id: string;
  };
}

export interface StopSwarmResponse {
  success: boolean;
  message: string;
}

export interface ValidateUriResponse {
  success: boolean;
  message: string;
  data: {
    domain_exists: boolean;
    swarm_name_exist: boolean;
  } | null;
}

export interface SwarmSelectResult {
  id: string;
  name: string;
  swarmUrl: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  workspaceId: string;
  instanceType: string;
  repositoryName: string;
  repositoryDescription: string;
  repositoryUrl: string;
  swarmSecretAlias: string;
  swarmApiKey: string | null;
  poolName: string;
  poolCpu: string;
  poolMemory: string;
  environmentVariables: Record<string, string>[];
  services: ServicesConfig[] | string; // string if not parsed yet
  containerFiles: Record<string, string>;
  defaultBranch: string;
}

export interface ServicesConfig {
  name: string;
  port: number;
  interpreter?: string;
  scripts: {
    start: string;
    install?: string;
    build?: string;
    test?: string;
  };
}
