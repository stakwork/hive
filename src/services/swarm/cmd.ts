export type SwarmCmd =
  | { type: "Swarm"; data: { cmd: "UpdateNeo4jConfig"; content: Record<string, unknown> } }
  | { type: "Swarm"; data: { cmd: "RestartContainer"; content: string } }
  | { type: "Swarm"; data: { cmd: "UpdateEnv"; content: { container_id: string; vars: Record<string, string> } } }
  | { type: "Swarm"; data: { cmd: "ListContainers" } }
  | { type: "Swarm"; data: { cmd: "StartContainer"; content: string } }
  | { type: "Swarm"; data: { cmd: "StopContainer"; content: string } }
  | { type: "Swarm"; data: { cmd: "GetContainerLogs"; content: string } }
  | { type: "Swarm"; data: { cmd: "UpdateSwarm" } }
  | { type: "Swarm"; data: { cmd: "GetConfig" } }
  | { type: "Swarm"; data: { cmd: "UpdateNode"; content: Record<string, unknown> } }
  | { type: "Swarm"; data: { cmd: "ListVersions"; content: Record<string, unknown> } }
  | { type: "Swarm"; data: { cmd: "GetAllImageActualVersion" } }
  | { type: "Swarm"; data: { cmd: "GetBoltwallAccessibility" } }
  | { type: "Swarm"; data: { cmd: "UpdateBoltwallAccessibility"; content: boolean } }
  | { type: "Swarm"; data: { cmd: "ListPaidEndpoint" } }
  | { type: "Swarm"; data: { cmd: "UpdatePaidEndpoint"; content: { id: number; status: boolean } } }
  | { type: "Swarm"; data: { cmd: "UpdateEndpointPrice"; content: { id: number; price: number } } }
  | { type: "Swarm"; data: { cmd: "GetBotBalance" } }
  | { type: "Swarm"; data: { cmd: "CreateBotInvoice"; content: { amt_msat: number } } }
  | { type: "Swarm"; data: { cmd: "GetBoltwallSuperAdmin" } }
  | { type: "Swarm"; data: { cmd: "AddBoltwallAdminPubkey"; content: { pubkey: string; name: string } } }
  | { type: "Swarm"; data: { cmd: "AddBoltwallUser"; content: { pubkey: string; name: string; role: number } } }
  | { type: "Swarm"; data: { cmd: "ListAdmins" } }
  | { type: "Swarm"; data: { cmd: "DeleteSubAdmin"; content: string } }
  | { type: "Swarm"; data: { cmd: "UpdateUser"; content: { id: number; pubkey: string; name: string; role: number } } }
  | { type: "Swarm"; data: { cmd: "GetEnrichedBoltwallUsers" } }
  | { type: "Swarm"; data: { cmd: "GetSecondBrainAboutDetails" } }
  | { type: "Swarm"; data: { cmd: "UpdateSecondBrainAbout"; content: { title: string; description: string } } };

export interface SwarmCmdResponse {
  ok: boolean;
  status: number;
  data?: unknown;
  rawText?: string;
}

function getCmdBaseUrlFromSwarmUrl(swarmUrl: string): string {
  if (process.env.USE_MOCKS === "true") {
    const mockBase = process.env.NEXTAUTH_URL || "http://localhost:3000";
    return `${mockBase}/api/mock/swarm-super-admin`;
  }
  const url = new URL(swarmUrl);
  return `${url.protocol}//${url.hostname}:8800`;
}

/**
 * Get x-jwt by logging in to sphinx-swarm with username "admin" and the swarm password.
 * Login uses the same host:port as the cmd API (port 8800), e.g. https://swarm40.sphinx.chat:8800/api/login.
 */
export async function getSwarmCmdJwt(swarmUrl: string, swarmPassword: string, username = "admin"): Promise<string> {
  const baseUrl = getCmdBaseUrlFromSwarmUrl(swarmUrl);
  const loginUrl = `${baseUrl}/api/login`;
  // Note: in mock mode (USE_MOCKS=true) loginUrl points to the mock login endpoint

  const allowInsecure = process.env.SWARM_CMD_ALLOW_INSECURE === "true";
  const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (allowInsecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  try {
    const res = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: swarmPassword }),
    });

    const rawText = await res.text();
    let data: { token?: string; jwt?: string; access_token?: string } = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      // ignore
    }

    if (!res.ok) {
      throw new Error(`Swarm login failed (${res.status}): ${rawText || res.statusText}`);
    }

    const jwt = data.token ?? data.jwt ?? data.access_token;
    if (!jwt || typeof jwt !== "string") {
      throw new Error("Swarm login response did not include token/jwt");
    }
    return jwt;
  } finally {
    if (allowInsecure) {
      if (previousTlsSetting === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
      }
    }
  }
}

export async function swarmCmdRequest({
  swarmUrl,
  jwt,
  cmd,
  tag = "SWARM",
}: {
  swarmUrl: string;
  jwt: string;
  cmd: SwarmCmd;
  tag?: string;
}): Promise<SwarmCmdResponse> {
  const baseUrl = getCmdBaseUrlFromSwarmUrl(swarmUrl);
  // Use string concatenation so the path from baseUrl (e.g. mock path) is preserved.
  // new URL("/api/cmd", base) would strip the base path for root-relative paths.
  const url = new URL(`${baseUrl}/api/cmd`);
  url.searchParams.set("txt", JSON.stringify(cmd));
  url.searchParams.set("tag", tag);

  const allowInsecure = process.env.SWARM_CMD_ALLOW_INSECURE === "true";
  const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (allowInsecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-jwt": jwt,
      },
    });

    const rawText = await res.text();
    let data: unknown = undefined;
    try {
      data = rawText ? JSON.parse(rawText) : undefined;
      // Handle sphinx-swarm double-encoded JSON responses (string wrapping a JSON object/array)
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { /* leave as string */ }
      }
    } catch {
      data = undefined;
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      rawText: data === undefined ? rawText : undefined,
    };
  } finally {
    if (allowInsecure) {
      if (previousTlsSetting === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
      }
    }
  }
}

