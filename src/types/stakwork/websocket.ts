// WebSocket data structures from Stakwork backend

export interface WorkflowEditData {
  workflow_id: string;
}

export interface WorkflowTransitionData {
  project_id: string;
  status: string;
}
