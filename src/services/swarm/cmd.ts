export type SwarmCmd =
  | { type: "Swarm"; data: { cmd: "UpdateNeo4jConfig"; content: Record<string, unknown> } }
  | { type: "Swarm"; data: { cmd: "RestartContainer"; content: string } };

export interface SwarmCmdResponse {
  ok: boolean;
  status: number;
  data?: unknown;
  rawText?: string;
}

function getCmdBaseUrlFromSwarmUrl(swarmUrl: string): string {
  const url = new URL(swarmUrl);
  return `${url.protocol}//${url.hostname}:8800`;
}

/**
 * Get x-jwt by logging in to sphinx-swarm with username "admin" and the swarm password.
 * swarmUrl is the stored swarm base URL (e.g. https://swarm40.sphinx.chat/api).
 */
export async function getSwarmCmdJwt(swarmUrl: string, swarmPassword: string): Promise<string> {
  const origin = new URL(swarmUrl).origin;
  const loginUrl = `${origin}/api/login`;

  const allowInsecure = process.env.SWARM_CMD_ALLOW_INSECURE === "true";
  const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (allowInsecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  try {
    const res = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: swarmPassword }),
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
  const url = new URL("/api/cmd", baseUrl);
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

