import { Agent } from "undici";

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
  | { type: "Swarm"; data: { cmd: "GetBoltwallUsers" } }
  | { type: "Swarm"; data: { cmd: "DeleteSubAdmin"; content: string } }
  | { type: "Swarm"; data: { cmd: "UpdateUser"; content: { id: number; pubkey: string; name: string; role: number } } }
  | { type: "Swarm"; data: { cmd: "GetSecondBrainAboutDetails" } }
  | { type: "Swarm"; data: { cmd: "UpdateSecondBrainAbout"; content: { title: string; description: string } } }
  | { type: "Swarm"; data: { cmd: "GetHostStorage" } };

export type SwarmCmdErrorCode = "TIMEOUT" | "CONFIG_INVALID";

export interface SwarmCmdResponse {
  ok: boolean;
  status: number;
  data?: unknown;
  rawText?: string;
  /** Present when the request failed without a usable HTTP response (timeout, bad config). */
  errorCode?: SwarmCmdErrorCode;
}

const CMD_PORT = 8800;

/**
 * Thrown by `getSwarmCmdJwt` when `swarmUrl` is not a usable http(s) URL.
 * `swarmCmdRequest` reports the same condition as an `errorCode: "CONFIG_INVALID"`
 * result instead of throwing, because its callers branch on `result.ok`.
 */
export class SwarmCmdConfigError extends Error {
  readonly code: SwarmCmdErrorCode = "CONFIG_INVALID";

  constructor(message = "CONFIG_INVALID: swarmUrl is not a valid http(s) URL") {
    super(message);
    this.name = "SwarmCmdConfigError";
  }
}

/**
 * Parse a swarm URL for the cmd API. `Swarm.swarmUrl` is free-text nullable, so
 * it is validated here rather than letting `new URL()` throw synchronously.
 * Returns null when the value is not a parseable http(s) URL.
 */
function parseCmdUrl(swarmUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(swarmUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  return url;
}

function cmdBaseUrl(url: URL): string {
  return `${url.protocol}//${url.hostname}:${CMD_PORT}`;
}

/**
 * Per-request dispatcher for opt-in insecure TLS (`SWARM_CMD_ALLOW_INSECURE`).
 *
 * This replaces the old process-global `NODE_TLS_REJECT_UNAUTHORIZED` flip,
 * which was racy under concurrency: the first request to settle restored the
 * flag for the whole process while other fetches were still open, silently
 * re-enabling (or disabling) certificate verification for every other
 * outbound call in the process. A per-request Agent scopes the bypass to
 * exactly this connection.
 */
function insecureDispatcher(): Agent | undefined {
  if (process.env.SWARM_CMD_ALLOW_INSECURE !== "true") {
    return undefined;
  }
  return new Agent({ connect: { rejectUnauthorized: false } });
}

async function closeDispatcher(dispatcher: Agent | undefined): Promise<void> {
  if (!dispatcher) return;
  try {
    await dispatcher.close();
  } catch {
    // The agent is per-request and one-shot; close errors are irrelevant.
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ABORT_ERR")
  );
}

/**
 * Get x-jwt by logging in to sphinx-swarm with username "admin" and the swarm password.
 * Login uses the same host:port as the cmd API (port 8800), e.g. https://swarm40.sphinx.chat:8800/api/login.
 *
 * @param timeoutMs opt-in timeout in ms; omit for the historical no-timeout behaviour.
 * On timeout the login fetch throws (as any other login failure always has).
 */
export async function getSwarmCmdJwt(
  swarmUrl: string,
  swarmPassword: string,
  username = "admin",
  timeoutMs?: number,
): Promise<string> {
  const parsedUrl = parseCmdUrl(swarmUrl);
  if (!parsedUrl) {
    throw new SwarmCmdConfigError();
  }

  const loginUrl = `${cmdBaseUrl(parsedUrl)}/api/login`;

  const dispatcher = insecureDispatcher();
  const controller = timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const res = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: swarmPassword }),
      ...(controller ? { signal: controller.signal } : {}),
      ...(dispatcher ? { dispatcher } : {}),
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
    if (timer) clearTimeout(timer);
    await closeDispatcher(dispatcher);
  }
}

/**
 * Send a typed command to the swarm cmd API.
 *
 * @param timeoutMs opt-in timeout in ms; omit for the historical no-timeout
 * behaviour. On timeout the call RESOLVES `{ ok: false, status: 0, data: null,
 * rawText: "", errorCode: "TIMEOUT" }` rather than throwing — callers branch on
 * `result.ok` and do not wrap this call in try/catch.
 */
export async function swarmCmdRequest({
  swarmUrl,
  jwt,
  cmd,
  tag = "SWARM",
  timeoutMs,
}: {
  swarmUrl: string;
  jwt: string;
  cmd: SwarmCmd;
  tag?: string;
  timeoutMs?: number;
}): Promise<SwarmCmdResponse> {
  const parsedUrl = parseCmdUrl(swarmUrl);
  if (!parsedUrl) {
    return { ok: false, status: 0, data: null, rawText: "", errorCode: "CONFIG_INVALID" };
  }

  const url = new URL("/api/cmd", cmdBaseUrl(parsedUrl));
  url.searchParams.set("txt", JSON.stringify(cmd));
  url.searchParams.set("tag", tag);

  const dispatcher = insecureDispatcher();
  const controller = timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-jwt": jwt,
      },
      ...(controller ? { signal: controller.signal } : {}),
      ...(dispatcher ? { dispatcher } : {}),
    });

    const rawText = await res.text();
    let data: unknown = undefined;
    try {
      data = rawText ? JSON.parse(rawText) : undefined;
      // Handle sphinx-swarm double-encoded JSON responses (string wrapping a JSON object)
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { /* leave as-is */ }
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
  } catch (error) {
    if (isAbortError(error)) {
      return { ok: false, status: 0, data: null, rawText: "", errorCode: "TIMEOUT" };
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    await closeDispatcher(dispatcher);
  }
}
