import { config } from "@/config/env";

/**
 * Get the Stakgraph service URL for a swarm
 * 
 * In mock mode: Returns localhost mock endpoint
 * In production: Returns swarm-specific URL with port 7799
 * 
 * @param swarmName - Name of the swarm instance
 * @returns Base URL for Stakgraph service
 */
export function getStakgraphUrl(swarmName: string): string {
  if (config.USE_MOCKS) {
    return `${config.MOCK_BASE}/api/mock/stakgraph`;
  }
  return `https://${swarmName}:7799`;
}
