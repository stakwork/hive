import { 
  JanitorType,
  JanitorStatus,
  JanitorTrigger,
  RecommendationStatus,
  Priority
} from "@prisma/client";


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
      metadata?: Record<string, unknown>;
    }>;
  };
  error?: string;
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

export interface CronConfiguration {
  enabled: boolean;
  schedule: string;
  secret: string;
}

export interface CronExecutionResult {
  success: boolean;
  workspacesProcessed: number;
  runsCreated: number;
  errorCount: number;
  errors: Array<{
    workspaceSlug: string;
    janitorType: JanitorType;
    error: string;
  }>;
  timestamp: string;
}

export interface CronHealthCheck {
  enabled: boolean;
  schedule: string;
  scheduleValid: boolean;
  timestamp: string;
}

export { JanitorType, JanitorStatus, JanitorTrigger, RecommendationStatus };