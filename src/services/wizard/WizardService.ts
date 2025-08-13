import { BaseServiceClass } from "@/lib/base-service";
import {
  WizardProgressRequest,
  WizardProgressResponse,
  WizardResetResponse,
  WizardStateResponse,
} from "@/types/wizard";

export class WizardService extends BaseServiceClass {
  public readonly serviceName = "wizard";

  async getWizardState(workspaceSlug: string): Promise<WizardStateResponse> {
    return this.handleRequest(async () => {
      const response: { data: WizardStateResponse } = await this.client.get(
        `/api/code-graph/wizard-state?workspace=${encodeURIComponent(workspaceSlug)}`,
      );
      return response.data;
    }, "getWizardState");
  }

  async updateWizardProgress(
    data: WizardProgressRequest,
  ): Promise<WizardProgressResponse> {
    return this.handleRequest(async () => {
      const response: { data: WizardProgressResponse } = await this.client.put(
        "/api/code-graph/wizard-progress",
        data,
      );
      return response.data;
    }, "updateWizardProgress");
  }

  async resetWizard(workspaceSlug: string): Promise<WizardResetResponse> {
    return this.handleRequest(async () => {
      const response: { data: WizardResetResponse } = await this.client.post(
        "/api/code-graph/wizard-reset",
        { workspaceSlug },
      );
      return response.data;
    }, "resetWizard");
  }

  async createSwarm(): Promise<{ success: boolean; data?: { id: string } }> {
    return this.handleRequest(async () => {
      const response: { data: { success: boolean; data?: { id: string } } } =
        await this.client.post("/api/swarm");
      return response.data;
    }, "createSwarm");
  }

  async pollSwarm(
    swarmId: string,
  ): Promise<{ success: boolean; status: string }> {
    return this.handleRequest(async () => {
      const response: { data: { success: boolean; status: string } } =
        await this.client.get(`/api/swarm/poll?id=${swarmId}`);
      return response.data;
    }, "pollSwarm");
  }
}
