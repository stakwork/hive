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

export interface CreateCustomerResponse {
  success: boolean;
  data: {
    id: number;
    name: string;
    token: string;
  };
};