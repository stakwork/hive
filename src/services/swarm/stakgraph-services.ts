import { swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { ServiceConfig } from "@/services/swarm/db";

// Helper to call stakgraph services endpoint
export async function fetchStakgraphServices(
  swarmUrl: string,
  decryptedApiKey: string,
  params: {
    clone?: string;
    repo_url?: string;
    username?: string;
    pat?: string;
  }
): Promise<{ services: ServiceConfig[]; environmentVariables?: Array<{ name: string; value: string }> }> {
  const apiResult = await swarmApiRequestAuth({
    swarmUrl: swarmUrl,
    endpoint: "/services",
    method: "GET",
    params,
    apiKey: decryptedApiKey,
  });

  const services = Array.isArray(apiResult.data)
    ? apiResult.data as ServiceConfig[]
    : (apiResult.data as { services: ServiceConfig[] }).services;

  // Extract environment variables from stakgraph services[].env if present
  let environmentVariables: Array<{ name: string; value: string }> | undefined;
  if (services?.[0]?.env) {
    const envObj = services[0].env as Record<string, string>;
    environmentVariables = Object.entries(envObj).map(([name, value]) => ({
      name,
      value
    }));
  }

  return { services, environmentVariables };
}

// Poll agent progress endpoint
export async function pollAgentProgress(
  swarmUrl: string,
  requestId: string,
  apiKey: string,
  maxAttempts = 100,
  delayMs = 2000
): Promise<{ ok: boolean; data?: unknown; status: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const progressResult = await swarmApiRequestAuth({
      swarmUrl: swarmUrl,
      endpoint: "/progress",
      method: "GET",
      params: { request_id: requestId },
      apiKey,
    });

    if (!progressResult.ok) {
      console.error(`Progress check failed:`, progressResult);
      return progressResult;
    }

    const progressData = progressResult.data as { status: string; result?: Record<string, string> };

    if (progressData.status === "completed" && progressData.result) {
      return {
        ok: true,
        data: progressData.result,
        status: 200
      };
    } else if (progressData.status === "failed") {
      return {
        ok: false,
        data: progressData,
        status: 500
      };
    }

    // Still in progress, wait before next attempt
    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return {
    ok: false,
    data: { error: "Agent timeout - took too long to complete" },
    status: 408
  };
}