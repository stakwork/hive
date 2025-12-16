// Core workflow data structures from Stakwork backend

export interface WorkflowTransition {
  id: string;
  unique_id: string;
  display_id: string;
  display_name: string;
  name: string;
  title: string;
  skill?: {
    type: 'human' | 'automated' | 'api' | 'loop';
    icon?: any;
  };
  skill_icon?: any;
  custom_icon?: string;
  position: { x: number; y: number };
  connections: Record<string, string>;
  step: {
    attributes: any;
    params: any;
  };
  status?: {
    step_state: string;
    workflow_state: string;
    job_statuses: any;
  };
  next_step?: string;
  last_transition_state?: string;
  has_output?: boolean;
  output?: any;
  output_templates?: any;
  connection_edges?: Array<{
    name: string;
    target_id: string;
    condition_eval?: boolean;
    data?: any;
  }>;
  project_step_id?: string;
  needs_human_review?: boolean;
  log?: string;
  wizard_step?: boolean;
}

export interface WorkflowConnection {
  id: string;
  source: string;
  target: string;
  custom_label?: string;
  disable_edge?: boolean;
}

export interface WorkflowDiagram {
  transitions: Record<string, WorkflowTransition>;
  connections?: WorkflowConnection[];
}

export interface WorkflowSpec {
  transitions: Record<string, WorkflowTransition>;
  connections: string | WorkflowConnection[]; // Can be JSON string or array
}

export interface WorkflowResponse {
  success: boolean;
  data: {
    valid: boolean;
    workflow_version_id: string;
    workflow_diagram: WorkflowDiagram;
    workflow_spec: WorkflowSpec;
  };
  error?: {
    message: string;
  };
}

export interface SearchResult {
  unique_id: string;
  workflow_version_id: string;
  id: string;
  workflow_name: string;
  title: string;
  skill: string;
}

// Step type for UI display (extends skill.type with 'condition')
export type StepType = "automated" | "human" | "api" | "loop" | "condition";

// Helper to extract step type from WorkflowTransition
export function getStepType(step: WorkflowTransition): StepType {
  if (step.name === "IfCondition" || step.name === "IfElseCondition") {
    return "condition";
  }

  const skillType = step.skill?.type;
  if (skillType === "human" || skillType === "automated" || skillType === "api" || skillType === "loop") {
    return skillType;
  }

  return "automated";
}

// Step type display labels
export const STEP_TYPE_LABELS: Record<StepType, string> = {
  automated: "Automated",
  human: "Human",
  api: "API",
  loop: "Loop",
  condition: "Condition",
};
