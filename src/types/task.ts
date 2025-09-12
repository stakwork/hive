import { WorkflowStatus } from "@/lib/chat";

export interface Task {
  id: string;
  title: string;
  createdAt: string;
  hasActionArtifact?: boolean;
  sourceType?: "JANITOR" | string;
  stakworkProjectId?: string;
  workflowStatus: WorkflowStatus | null;
  createdBy: {
    image?: string;
    name?: string;
    email?: string;
    githubAuth?: {
      githubUsername?: string;
    };
  };
  assignee?: {
    name?: string;
    email?: string;
  };
}
