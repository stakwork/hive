import { BaseServiceClass } from "@/lib/base-service";

export class WizardService extends BaseServiceClass {
  public readonly serviceName = "wizard";

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
