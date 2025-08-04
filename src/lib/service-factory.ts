import { BaseServiceClass } from "./base-service";
import { StakworkService } from "@/services/stakwork";
import { PoolManagerService } from "@/services/pool-manager";
import { WizardService } from "@/services/wizard";
import { getServiceConfig } from "@/config/services";

// Service registry type
export type ServiceName = "stakwork" | "poolManager" | "wizard";

// Service factory class
export class ServiceFactory {
  private static instances = new Map<ServiceName, BaseServiceClass>();

  static getService<T extends BaseServiceClass>(serviceName: ServiceName): T {
    if (!this.instances.has(serviceName)) {
      const config = getServiceConfig(serviceName);

      console.log(
        "--------------------------------config--------------------------------",
      );
      console.log(config);
      console.log(
        "--------------------------------config--------------------------------",
      );

      switch (serviceName) {
        case "stakwork":
          this.instances.set(serviceName, new StakworkService(config));
          break;
        case "poolManager":
          this.instances.set(serviceName, new PoolManagerService(config));
          break;
        case "wizard":
          this.instances.set(serviceName, new WizardService(config));
          break;
        default:
          throw new Error(`Unknown service: ${serviceName}`);
      }
    }

    return this.instances.get(serviceName)! as T;
  }

  static getStakworkService(): StakworkService {
    return this.getService<StakworkService>("stakwork");
  }

  static getPoolManagerService(): PoolManagerService {
    return this.getService<PoolManagerService>("poolManager");
  }

  static getWizardService(): WizardService {
    return this.getService<WizardService>("wizard");
  }

  static updateServiceApiKey(serviceName: ServiceName, apiKey: string): void {
    const service = this.getService(serviceName);
    service.updateApiKey(apiKey);
  }

  static clearInstances(): void {
    this.instances.clear();
  }

  static getAllServices(): Record<ServiceName, BaseServiceClass> {
    return {
      stakwork: this.getStakworkService(),
      poolManager: this.getPoolManagerService(),
      wizard: this.getWizardService(),
    };
  }
}

// Convenience exports
export const stakworkService = () => ServiceFactory.getStakworkService();
export const poolManagerService = () => ServiceFactory.getPoolManagerService();
export const wizardService = () => ServiceFactory.getWizardService();
