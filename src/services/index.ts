// Export service classes
export { StakworkService } from "./stakwork";
export { PoolManagerService } from "./pool-manager";

// Export service factory and convenience functions
export {
  ServiceFactory,
  stakworkService,
  poolManagerService,
  wizardService,
  type ServiceName,
} from "@/lib/service-factory";

// Export all types
export * from "@/types";

// Export service configurations
export { serviceConfigs, endpoints, getServiceConfig } from "@/config/services";

// Export HTTP client types
export type { HttpClientConfig, ApiError } from "@/lib/http-client";
