import { EnvironmentVariable } from "@/types/wizard";

export interface ServiceDataConfig {
  name: string;
  port: number;
  env: Record<string, string>;
  interpreter?: string;
  scripts: {
    start: string;
    install?: string;
    build?: string;
    test?: string;
    preStart?: string;
    postStart?: string;
    rebuild?: string;
  };
}

export interface StakgraphSettings {
  name: string;
  description: string;
  repositoryUrl: string;
  swarmUrl: string;
  swarmSecretAlias: string;
  poolName: string;
  environmentVariables: EnvironmentVariable[];
  services: ServiceDataConfig[];
  status?: string;
  lastUpdated?: string;
  containerFiles: Record<string, string>;
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
}

export interface EnvironmentData {
  poolName: string;
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
  onChange: T extends Array<infer U>
    ? (data: U[]) => void
    : (data: Partial<T>) => void;
  onValidationChange?: (errors: Record<string, string>) => void;
}
