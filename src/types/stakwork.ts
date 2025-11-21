import { z } from "zod";
import { StakworkRunType, StakworkRunDecision, WorkflowStatus } from "@prisma/client";

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

// Payload for Stakwork workflow with webhook support
export interface StakworkWorkflowPayload {
  name: string;
  workflow_id: number;
  webhook_url?: string;
  workflow_params: {
    set_var: {
      attributes: {
        vars: Record<string, unknown>;
      };
    };
  };
}

export interface CreateProjectRequest {
  title: any;
  description: any;
  budget: any;
  skills: any;
  name: string;
  workflow_id: number;
  workflow_params: { set_var: { attributes: { vars: unknown } } };
}

export interface StakworkProject {
  success: boolean;
  data: {
    project_id: number;
  };
}

export interface StakworkStatusPayload {
  project_output?: Record<string, unknown>;
  workflow_id: number;
  workflow_version_id: number;
  workflow_version: number;
  project_status: string;
  task_id?: string;
}

// =============================================
// STAKWORK RUN TYPES & SCHEMAS
// =============================================

// Zod schemas for validation
export const CreateStakworkRunSchema = z.object({
  type: z.nativeEnum(StakworkRunType),
  workspaceId: z.string().cuid(),
  featureId: z.string().cuid().optional().nullable(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const StakworkRunWebhookSchema = z.object({
  result: z.unknown(),
  project_status: z.string().optional(),
  project_id: z.number().optional(),
  project_output: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateStakworkRunDecisionSchema = z.object({
  decision: z.nativeEnum(StakworkRunDecision),
  feedback: z.string().optional(),
  featureId: z.string().cuid().optional(),
});

export const StakworkRunQuerySchema = z.object({
  workspaceId: z.string().cuid(),
  type: z.nativeEnum(StakworkRunType).optional(),
  featureId: z.string().cuid().optional(),
  status: z.nativeEnum(WorkflowStatus).optional(),
  limit: z.number().int().positive().max(100).optional().default(20),
  offset: z.number().int().nonnegative().optional().default(0),
});

// Type inference from Zod schemas
export type CreateStakworkRunInput = z.infer<typeof CreateStakworkRunSchema>;
export type StakworkRunWebhookPayload = z.infer<typeof StakworkRunWebhookSchema>;
export type UpdateStakworkRunDecisionInput = z.infer<typeof UpdateStakworkRunDecisionSchema>;
export type StakworkRunQuery = z.infer<typeof StakworkRunQuerySchema>;

// API Response types
export interface StakworkRunResponse {
  id: string;
  webhookUrl: string;
  projectId: number | null;
  type: StakworkRunType;
  featureId: string | null;
  workspaceId: string;
  status: WorkflowStatus;
  result: string | null;
  dataType: string;
  feedback: string | null;
  decision: StakworkRunDecision | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StakworkRunListResponse {
  runs: StakworkRunResponse[];
  total: number;
  limit: number;
  offset: number;
}

// Helper type for determining data type
export type DataType = "string" | "number" | "boolean" | "json" | "array" | "null";
