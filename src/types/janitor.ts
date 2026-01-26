import { JanitorType, JanitorStatus, JanitorTrigger, RecommendationStatus, Priority } from "@prisma/client";

export interface JanitorConfigUpdate {
  unitTestsEnabled?: boolean;
  integrationTestsEnabled?: boolean;
  e2eTestsEnabled?: boolean;
  securityReviewEnabled?: boolean;
  mockGenerationEnabled?: boolean;
  generalRefactoringEnabled?: boolean;
  taskCoordinatorEnabled?: boolean;
  recommendationSweepEnabled?: boolean;
  ticketSweepEnabled?: boolean;
  // PR Monitor settings
  prMonitorEnabled?: boolean;
  prConflictFixEnabled?: boolean;
  prCiFailureFixEnabled?: boolean;
  prOutOfDateFixEnabled?: boolean;
  prUseRebaseForUpdates?: boolean;
}

/**
 * PR Monitor configuration fields from JanitorConfig
 */
export interface PRMonitorConfigFields {
  prMonitorEnabled: boolean;
  prConflictFixEnabled: boolean;
  prCiFailureFixEnabled: boolean;
  prOutOfDateFixEnabled: boolean;
  prUseRebaseForUpdates: boolean;
}

export interface AcceptRecommendationRequest {
  assigneeId?: string;
  repositoryId?: string;
  autoMergePr?: boolean;
}

export interface DismissRecommendationRequest {
  reason?: string;
}

export interface StakworkWebhookPayload {
  projectId: number;
  status: string;
  workspaceId?: string; // For external workflows without janitor run
  autoCreateTasks?: boolean; // Auto-create task from first recommendation
  autoMergePr?: boolean; // Auto-merge PR when autoCreateTasks is true
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

export interface CronExecutionResult {
  success: boolean;
  workspacesProcessed: number;
  runsCreated: number;
  skipped: number; // Number of janitor runs skipped due to active tasks
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
  scheduleSource: string;
  timestamp: string;
}

export { JanitorType, JanitorStatus, JanitorTrigger, RecommendationStatus };
