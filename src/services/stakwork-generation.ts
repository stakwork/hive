import { BaseServiceClass } from "@/lib/base-service";
import type { ServiceConfig } from "@/types";
import type { StakworkRunType, StakworkRunDecision } from "@prisma/client";

interface StakworkRun {
  id: string;
  type: StakworkRunType;
  status: string;
  result: string | null;
  dataType: string;
  decision: StakworkRunDecision | null;
  feedback: string | null;
  featureId: string | null;
  projectId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateRunInput {
  type: StakworkRunType;
  featureId: string;
  workspaceId: string;
}

interface GetRunsParams {
  workspaceId: string;
  featureId: string;
  type: StakworkRunType;
  limit?: string;
}

interface UpdateDecisionInput {
  decision: StakworkRunDecision;
  featureId?: string;
  feedback?: string;
}

export class StakworkGenerationService extends BaseServiceClass {
  readonly serviceName = "stakwork-generation";

  async createRun(input: CreateRunInput): Promise<{ run: StakworkRun }> {
    return this.handleRequest(async () => {
      const response = await this.client.post<{ success: boolean; run: StakworkRun }>(
        "/api/stakwork/ai/generate",
        input,
      );
      return { run: response.run };
    }, "createRun");
  }

  async getRuns(params: GetRunsParams): Promise<{ runs: StakworkRun[] }> {
    return this.handleRequest(async () => {
      // Build query string from params
      const queryString = new URLSearchParams(
        Object.entries(params).reduce(
          (acc, [key, value]) => {
            if (value !== undefined) {
              acc[key] = String(value);
            }
            return acc;
          },
          {} as Record<string, string>,
        ),
      ).toString();

      const endpoint = `/api/stakwork/runs?${queryString}`;
      const response = await this.client.get<{ success: boolean; runs: StakworkRun[] }>(endpoint);
      return { runs: response.runs };
    }, "getRuns");
  }

  async updateDecision(runId: string, decision: UpdateDecisionInput): Promise<{ run: StakworkRun }> {
    return this.handleRequest(async () => {
      const response = await this.client.patch<{ success: boolean; run: StakworkRun }>(
        `/api/stakwork/runs/${runId}/decision`,
        decision,
      );
      return { run: response.run };
    }, "updateDecision");
  }
}
