// Stakwork-specific types and interfaces
export interface StakworkResponse {
  success: boolean;
  data: {
    project_id: number;
  };
}

// Payload for creating a Stakwork project
export interface StakworkProjectPayload {
  name: string;
  workflow_id: number;
  workflow_params: Record<string, unknown>;
}

export interface CreateProjectRequest {
  title: any;
  description: any;
  budget: any;
  skills: any;
  name: string;
  workflow_id: number;
  workflow_params: { set_var: { attributes: { vars: unknown } } };
}

export interface StakworkProject {
  success: boolean;
  data: {
    project_id: number;
  };
}

export interface StakworkStatusPayload {
  project_output?: Record<string, unknown>;
  workflow_id: number;
  workflow_version_id: number;
  workflow_version: number;
  project_status: string;
  task_id?: string;
}
