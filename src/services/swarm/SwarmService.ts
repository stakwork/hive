import { BaseServiceClass } from "@/lib/base-service";
import {
  CreateSwarmRequest,
  CreateSwarmResponse,
  ServiceConfig,
  ValidateUriResponse,
  StopSwarmResponse,
  StopSwarmRequest,
} from "@/types";
import { createSwarmApi, validateUriApi, stopSwarmApi } from "./api/swarm";

export class SwarmService extends BaseServiceClass {
  public readonly serviceName = "swarm";

  constructor(config: ServiceConfig) {
    super(config);
  }

  async createSwarm(swarm: CreateSwarmRequest): Promise<CreateSwarmResponse> {
    return createSwarmApi(this.getClient(), swarm, this.serviceName);
  }

  async stopSwarm(swarm: StopSwarmRequest): Promise<StopSwarmResponse> {
    return stopSwarmApi(this.getClient(), swarm, this.serviceName);
  }

  async validateUri(uri: string): Promise<ValidateUriResponse> {
    return validateUriApi(this.getClient(), uri);
  }
}
