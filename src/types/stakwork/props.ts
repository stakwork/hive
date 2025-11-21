import { WorkflowSpec } from "./workflow";

// Props passed from Rails/Stakwork to React workflow component
export interface WorkflowAppProps {
  props: {
    workflowData?: WorkflowSpec;
    kflowformdata?: string; // JSON string
    show_only: boolean | string;
    mode: "edit" | "alter" | "project";
    projectId?: string;
    isAdmin: boolean;
    workflowId: string;
    workflowVersion: string;
    defaultZoomLevel?: number;
    useAssistantDimensions?: boolean;
    projectProgress?: string; // JSON string
    rails_env: string;
  };
}
