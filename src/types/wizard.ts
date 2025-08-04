import { ServiceDataConfig } from "@/components/stakgraph";

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  stargazers_count: number;
  watchers_count: number;
  language: string | null;
  default_branch: string;
  updated_at: string;
}

export interface EnvironmentVariable {
  name: string;
  value: string;
  show?: boolean;
}

export interface User {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  github?: {
    username?: string;
    publicRepos?: number;
    followers?: number;
  };
}

export interface CodeGraphWizardProps {
  user: User;
}

export interface WizardState {
  step: number;
  repositories: Repository[];
  selectedRepo: Repository | null;
  searchTerm: string;
  loading: boolean;
  parsedRepoName: string;
  workspaceName: string;
  envVars: EnvironmentVariable[];
}

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// Canonical wizard step keys for backend/frontend sync
export type WizardStepKey =
  | "WELCOME"
  | "REPOSITORY_SELECT"
  | "PROJECT_NAME"
  | "GRAPH_INFRASTRUCTURE"
  | "INGEST_CODE"
  | "ADD_SERVICES"
  | "ENVIRONMENT_SETUP"
  | "REVIEW_POOL_ENVIRONMENT"
  | "STAKWORK_SETUP";

// API Response Types

export type WizardStateData = {
  wizardStep: string;
  stepStatus: string;
  wizardData: Record<string, unknown>;
  swarmId?: string;
  swarmName?: string;
  swarmStatus?: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  ingestRefId?: string;
  poolName?: string;
  services: ServiceDataConfig[];
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

export interface WizardStateResponse {
  success: boolean;
  data: WizardStateData;
  message?: string;
}

export interface WizardStateError {
  success: false;
  message: string;
  error?: string;
}

// Wizard Progress API Types
export interface WizardProgressRequest {
  workspaceSlug: string;
  wizardStep?: WizardStepKey;
  stepStatus?: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";
  wizardData?: Record<string, unknown>;
}

export interface WizardProgressResponse {
  success: boolean;
  data?: {
    wizardStep: WizardStepKey;
    stepStatus: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";
    wizardData: Record<string, unknown>;
  };
  message?: string;
  error?: string;
}

// Wizard Reset API Types
export interface WizardResetRequest {
  workspaceSlug: string;
}

export interface WizardResetResponse {
  success: boolean;
  data?: {
    wizardStep: WizardStepKey;
    stepStatus: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";
    wizardData: Record<string, unknown>;
  };
  message?: string;
  error?: string;
}

// Step mapping from wizard step keys to numbers
export const STEP_MAPPING = {
  WELCOME: 1,
  REPOSITORY_SELECT: 2,
  PROJECT_NAME: 3,
  GRAPH_INFRASTRUCTURE: 4,
  INGEST_CODE: 5,
  ADD_SERVICES: 6,
  ENVIRONMENT_SETUP: 7,
  REVIEW_POOL_ENVIRONMENT: 8,
  STAKWORK_SETUP: 9,
};

export const REVERSE_STEP_MAPPING = {
  1: "WELCOME",
  2: "REPOSITORY_SELECT",
  3: "PROJECT_NAME",
  4: "GRAPH_INFRASTRUCTURE",
  5: "INGEST_CODE",
  6: "ADD_SERVICES",
  7: "ENVIRONMENT_SETUP",
  8: "REVIEW_POOL_ENVIRONMENT",
  9: "STAKWORK_SETUP",
};
