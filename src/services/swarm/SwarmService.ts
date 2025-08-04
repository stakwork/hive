import { ServiceConfig } from "@/types";
import { CreateSwarmRequest, CreateSwarmResponse } from "@/types";
import { createSwarmApi } from "./api/swarm";
import { BaseServiceClass } from "@/lib/base-service";

export class SwarmService extends BaseServiceClass {
  public readonly serviceName = "swarm";

  constructor(config: ServiceConfig) {
    super(config);
  }

  async createSwarm(swarm: CreateSwarmRequest): Promise<CreateSwarmResponse> {
    return createSwarmApi(this.getClient(), swarm, this.serviceName);
  }
}
