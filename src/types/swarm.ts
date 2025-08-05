// Swarm-specific types and interfaces

export interface CreateSwarmRequest {
  vanity_address: string;
  name: string;
  instance_type: string;
  env?: Record<string, string>;
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
  };
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
  poolName: string;
  environmentVariables: Record<string, string>[];
  services: ServicesConfig[] | string; // string if not parsed yet
  containerFiles: Record<string, string>;
  defaultBranch: string;
}

export interface ServicesConfig {
  name: string;
  port: number;
  scripts: {
    start: string;
    install?: string;
    build?: string;
    test?: string;
  };
}
