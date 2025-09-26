import { EncryptionService } from "@/lib/encryption";
import { env } from "@/lib/env";
import { HttpClient } from "@/lib/http-client";
import {
  CreateSwarmRequest,
  CreateSwarmResponse,
  ValidateUriResponse,
  StopSwarmRequest,
  StopSwarmResponse,
} from "@/types";
const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function createSwarmApi(
  client: HttpClient,
  swarm: CreateSwarmRequest,
  serviceName: string,
): Promise<CreateSwarmResponse> {
  return client.post<CreateSwarmResponse>(
    `/api/super/new_swarm`,
    swarm,
    { "x-super-token": env.SWARM_SUPERADMIN_API_KEY as string },
    serviceName,
  );
}

export async function stopSwarmApi(
  client: HttpClient,
  swarm: StopSwarmRequest,
  serviceName: string,
): Promise<StopSwarmResponse> {
  return client.post<StopSwarmResponse>(
    `/api/super/stop_swarm`,
    swarm,
    { "x-super-token": env.SWARM_SUPERADMIN_API_KEY as string },
    serviceName,
  );
}

export async function validateUriApi(client: HttpClient, domain: string): Promise<ValidateUriResponse> {
  return client.get<ValidateUriResponse>(`/api/super/check-domain?domain=${domain}`, {
    "x-super-token": env.SWARM_SUPERADMIN_API_KEY as string,
  });
}

export async function fetchSwarmDetails(swarmId: string): Promise<{ ok: boolean; data?: unknown; status: number }> {
  const maxRetries = 10;
  const retryDelay = 1000; // 1 second
  let lastError: { ok: boolean; data?: unknown; status: number } | undefined = undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`Attempt: ${attempt + 1}/${maxRetries} for swarm ${swarmId}`);
      const url = `${env.SWARM_SUPER_ADMIN_URL}/api/super/details?id=${encodeURIComponent(swarmId)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-super-token": env.SWARM_SUPERADMIN_API_KEY as string,
        },
      });
      const data = await response.json();

      if (response.ok) {
        // Return immediately on success
        return { ok: true, data, status: response.status };
      } else if (response.status === 400) {
        // For 400 errors, retry after delay
        lastError = { ok: false, data, status: response.status };
        console.log(`Got 400 error, will retry in ${retryDelay}ms...`);
      } else {
        // For other errors, return immediately (don't retry)
        return { ok: false, data, status: response.status };
      }
    } catch (error) {
      console.error("fetchSwarmDetails network error:", error);
      lastError = { ok: false, status: 500 };
    }

    // Only delay and retry if we have more attempts and got a 400
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
  return lastError || { ok: false, status: 500 };
}

export async function swarmApiRequest({
  swarmUrl,
  endpoint,
  method = "GET",
  apiKey,
  data,
}: {
  swarmUrl: string;
  endpoint: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  apiKey: string;
  data?: unknown;
}): Promise<{
  ok: boolean;
  data?: unknown;
  status: number;
}> {
  try {
    const url = `${swarmUrl.replace(/\/$/, "")}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

    console.log("swarmhRequestStart");

    const headers: Record<string, string> = {
      Authorization: `Bearer ${encryptionService.decryptField("swarmApiKey", apiKey).toString()}`,
      "x-api-token": encryptionService.decryptField("swarmApiKey", apiKey),
      "Content-Type": "application/json",
    };

    console.log(url, headers, data, method, apiKey);

    const response = await fetch(url, {
      method,
      headers,
      ...(data ? { body: JSON.stringify(data) } : {}),
    });

    console.log("swarmhRequestEnd", response);

    let responseData: unknown = undefined;
    // Get the text first, then try to parse as JSON
    const responseText = await response.text();
    try {
      responseData = JSON.parse(responseText);
      console.log("API Response:", responseData);
    } catch (error) {
      console.error("swarmApiRequest JSON error", responseText, error);
      responseData = undefined;
    }
    return {
      ok: response.ok,
      data: responseData,
      status: response.status,
    };
  } catch (error) {
    console.error("swarmApiRequest", error);
    return { ok: false, status: 500 };
  }
}

export async function swarmApiRequestAuth({
  swarmUrl,
  endpoint,
  method = "GET",
  apiKey,
  data,
  params,
}: {
  swarmUrl: string;
  endpoint: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  apiKey: string;
  data?: unknown;
  params?: Record<string, string | number | boolean | null>; // 👈 added
}): Promise<{ ok: boolean; data?: unknown; status: number }> {
  try {
    // build query string if params provided
    const queryString = params
      ? "?" +
        new URLSearchParams(
          Object.entries(params).reduce(
            (acc, [k, v]) => (v !== undefined ? { ...acc, [k]: String(v) } : acc),
            {} as Record<string, string>,
          ),
        ).toString()
      : "";

    const url =
      `${swarmUrl.replace(/\/$/, "")}` + `${endpoint.startsWith("/") ? "" : "/"}` + `${endpoint}${queryString}`;

    const headers: Record<string, string> = {
      "x-api-token": encryptionService.decryptField("swarmApiKey", apiKey),
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      ...(data ? { body: JSON.stringify(data) } : {}),
    });

    let responseData: unknown;
    try {
      responseData = await response.json();
    } catch (error) {
      console.error("swarmApiRequest error parsing JSON", error);
    }

    return { ok: response.ok, data: responseData, status: response.status };
  } catch (error) {
    console.error("swarmApiRequest", error);
    return { ok: false, status: 500 };
  }
}
