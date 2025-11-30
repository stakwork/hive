import { config } from "@/lib/env";

/**
 * Returns the appropriate service URL based on mock mode
 * Services should call this instead of checking USE_MOCKS directly
 */
export function getServiceUrl(
  serviceName: "poolManager" | "stakwork" | "github"
): string {
  if (config.USE_MOCKS) {
    // Return internal mock endpoint URLs
    const mockUrls = {
      poolManager: "/api/mock/pool-manager",
      stakwork: "/api/mock/stakwork",
      github: "/api/mock/github",
    };
    return mockUrls[serviceName];
  }

  // Return real service URLs
  const realUrls = {
    poolManager: config.POOL_MANAGER_BASE_URL,
    stakwork: config.STAKWORK_BASE_URL,
    github: "https://api.github.com",
  };
  return realUrls[serviceName];
}

/**
 * Returns the appropriate API key based on mock mode
 */
export function getServiceApiKey(
  serviceName: "poolManager" | "stakwork"
): string {
  if (config.USE_MOCKS) {
    // Return mock API keys (any value works for mocks)
    return "mock-api-key";
  }

  // Return real API keys
  const realKeys = {
    poolManager: config.POOL_MANAGER_API_KEY,
    stakwork: config.STAKWORK_API_KEY,
  };
  return realKeys[serviceName] || "";
}