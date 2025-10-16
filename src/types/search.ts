import type { TaskStatus, Priority, FeatureStatus, TicketStatus, PhaseStatus } from "@prisma/client";

export type SearchEntityType = "task" | "feature" | "ticket" | "phase";

export interface SearchResult {
  id: string;
  type: SearchEntityType;
  title: string;
  description: string | null;
  url: string;
  metadata: SearchResultMetadata;
}

export interface SearchResultMetadata {
  status?: TaskStatus | FeatureStatus | TicketStatus | PhaseStatus;
  priority?: Priority;
  assignee?: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null;
  featureTitle?: string; // For tickets/phases
  createdAt?: string;
  updatedAt?: string;
}

export interface SearchResponse {
  success: boolean;
  data: {
    tasks: SearchResult[];
    features: SearchResult[];
    tickets: SearchResult[];
    phases: SearchResult[];
    total: number;
  };
}
