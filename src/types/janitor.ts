import { 
  JanitorConfig, 
  JanitorRun, 
  JanitorRecommendation,
  JanitorType,
  JanitorStatus,
  JanitorTrigger,
  RecommendationStatus,
  Priority,
  User,
  Task,
  Repository
} from "@prisma/client";

export type JanitorConfigWithRuns = JanitorConfig & {
  janitorRuns: JanitorRun[];
};

export type JanitorRunWithRecommendations = JanitorRun & {
  recommendations: JanitorRecommendation[];
  janitorConfig?: JanitorConfig;
  _count?: {
    recommendations: number;
  };
};

export type JanitorRecommendationWithRun = JanitorRecommendation & {
  janitorRun: {
    id: string;
    janitorType: JanitorType;
    status: JanitorStatus;
    createdAt: Date;
  };
  acceptedBy?: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  dismissedBy?: {
    id: string;
    name: string | null;
    email: string;
  } | null;
};

export interface JanitorConfigUpdate {
  unitTestsEnabled?: boolean;
  integrationTestsEnabled?: boolean;
}

export interface AcceptRecommendationRequest {
  assigneeId?: string;
  repositoryId?: string;
}

export interface DismissRecommendationRequest {
  reason?: string;
}

export interface StakworkWebhookPayload {
  projectId: number;
  status: string;
  results?: {
    recommendations: Array<{
      title: string;
      description: string;
      priority: string;
      impact?: string;
      metadata?: Record<string, any>;
    }>;
  };
  error?: string;
}

export interface JanitorRunResponse {
  id: string;
  janitorType: JanitorType;
  status: JanitorStatus;
  triggeredBy: JanitorTrigger;
  stakworkProjectId?: number | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
  recommendationCount?: number;
}

export interface JanitorRecommendationResponse {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  impact?: string | null;
  status: RecommendationStatus;
  acceptedAt?: Date | null;
  dismissedAt?: Date | null;
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
  janitorRun: {
    id: string;
    janitorType: JanitorType;
    status: JanitorStatus;
    createdAt: Date;
  };
  acceptedBy?: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  dismissedBy?: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

export interface AcceptRecommendationResponse {
  success: true;
  task: Task & {
    assignee?: {
      id: string;
      name: string | null;
      email: string;
    } | null;
    repository?: {
      id: string;
      name: string;
      repositoryUrl: string;
    } | null;
    createdBy: {
      id: string;
      name: string | null;
      email: string;
    };
  };
  recommendation: {
    id: string;
    status: RecommendationStatus;
    acceptedAt: Date;
  };
}

export interface DismissRecommendationResponse {
  success: true;
  recommendation: {
    id: string;
    status: RecommendationStatus;
    dismissedAt: Date;
    dismissedBy?: {
      id: string;
      name: string | null;
      email: string;
    } | null;
    metadata: any;
  };
}

export interface PaginationResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface JanitorRunsResponse {
  runs: JanitorRunResponse[];
  pagination: PaginationResponse;
}

export interface JanitorRecommendationsResponse {
  recommendations: JanitorRecommendationResponse[];
  pagination: PaginationResponse;
}

export interface WebhookResponse {
  success: true;
  message: string;
  runId: string;
  status: "COMPLETED" | "FAILED" | "RUNNING";
}

export interface JanitorRunFilters {
  type?: JanitorType;
  status?: JanitorStatus;
  limit?: number;
  page?: number;
}

export interface JanitorRecommendationFilters {
  status?: RecommendationStatus;
  janitorType?: JanitorType;
  priority?: Priority;
  limit?: number;
  page?: number;
}

export { JanitorType, JanitorStatus, JanitorTrigger, RecommendationStatus };