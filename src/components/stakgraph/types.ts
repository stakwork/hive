import { EnvironmentVariable } from "@/types/wizard";

export interface ServiceDataConfig {
  name: string;
  port: number;
  env: Record<string, string>;
  scripts: {
    start: string;
    install?: string;
    build?: string;
    test?: string;
  };
}

export interface StakgraphSettings {
  name: string;
  description: string;
  repositoryUrl: string;
  swarmUrl: string;
  swarmSecretAlias: string;
  poolName: string;
  poolApiKey: string;
  environmentVariables: EnvironmentVariable[];
  services: ServiceDataConfig[];
  status?: string;
  lastUpdated?: string;
}

// Form section data types
export interface ProjectInfoData {
  name: string;
  description: string;
}

export interface RepositoryData {
  repositoryUrl: string;
}

export interface SwarmData {
  swarmUrl: string;
  swarmSecretAlias: string;
  poolApiKey: string;
}

export interface EnvironmentData {
  poolName: string;
  poolApiKey: string;
  environmentVariables: EnvironmentVariable[];
}

export interface ServicesData {
  services: ServiceDataConfig[];
}

// Form props interface
export interface FormSectionProps<T> {
  data: T;
  errors: Record<string, string>;
  loading: boolean;
  onChange: (data: Partial<T>) => void;
  onValidationChange?: (errors: Record<string, string>) => void;
} 