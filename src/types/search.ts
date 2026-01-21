import type { TaskStatus, Priority, FeaturePriority, FeatureStatus, PhaseStatus } from "@prisma/client";

export type SearchEntityType = "task" | "feature" | "phase";

export interface SearchResult {
  id: string;
  type: SearchEntityType;
  title: string;
  description: string | null;
  url: string;
  metadata: SearchResultMetadata;
}

export interface SearchResultMetadata {
  status?: TaskStatus | FeatureStatus | PhaseStatus;
  priority?: Priority | FeaturePriority;
  assignee?: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null;
  featureTitle?: string; // For roadmap tasks and phases
  stakworkProjectId?: number | null; // For tasks - used to determine navigation
  branch?: string | null; // For tasks - git branch name
  createdAt?: string;
  updatedAt?: string;
}

export interface SearchResponse {
  success: boolean;
  data: {
    tasks: SearchResult[];
    features: SearchResult[];
    phases: SearchResult[];
    total: number;
  };
}
