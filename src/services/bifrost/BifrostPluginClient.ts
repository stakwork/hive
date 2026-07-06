import { BIFROST_HTTP_TIMEOUT_MS } from "./constants";
import { BifrostHttpError } from "./BifrostClient";
import type {
  AgentCatalogManifest,
  HiveCallbackPayload,
  HiveCallbackResponse,
  SeedAgentsResponse,
  TrustOrgRow,
  TrustOrgUpsert,
  TrustRealmIDRequest,
  TrustRealmIDResponse,
  TrustStatusResponse,
  TrustUpsertResponse,
} from "./types";

/**
 * Thin HTTP client for Bifrost's plugin admin surface — the
 * `/_plugin/*` routes served by the gateway plugin. Authenticates
 * with **Bearer** + the swarm's provisioning token (=
 * `BIFROST_PROVISIONING_TOKEN` server-side, =
 * `Swarm.swarmApiKey` plaintext Hive-side, encrypted at rest).
 *
 * Why a separate client from `BifrostClient`? The auth model is
 * different (Bearer vs. Basic) and the routes are owned by the
 * gateway plugin, not Bifrost core. Keeping them in their own
 * client makes the auth model unambiguous at the call site — every
 * trust/plugin route goes through this client; every governance
 * route goes through `BifrostClient`.
 *
 * Wire shapes match `gateway/internal/trust/types.go` exactly.
 * See `gateway/plans/phases/phase-5-trust-registry.md` §"Admin
 * HTTP API" for the route reference.
 */

export interface BifrostPluginClientOptions {
  /**
   * Gateway root URL — same value as `BifrostAdminCreds.baseUrl`.
   * No trailing slash; we normalise.
   */
  baseUrl: string;
  /**
   * Plaintext provisioning token. Decrypt `Swarm.swarmApiKey`
   * before passing it in.
   */
  provisioningToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class BifrostPluginClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: BifrostPluginClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.authHeader = `Bearer ${opts.provisioningToken}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? BIFROST_HTTP_TIMEOUT_MS;
  }

  /** GET /_plugin/trust/status — cheap probe, used to decide whether to upsert. */
  async getTrustStatus(): Promise<TrustStatusResponse> {
    return this.request<TrustStatusResponse>("GET", "/_plugin/trust/status");
  }

  /**
   * GET /_plugin/trust/:org_id — read one trust entry. Returns
   * `null` on 404 (org not registered) instead of throwing, so the
   * reconciler can branch cleanly without try/catch around the
   * happy path.
   */
  async getTrustOrg(orgId: string): Promise<TrustOrgRow | null> {
    try {
      return await this.request<TrustOrgRow>(
        "GET",
        `/_plugin/trust/${encodeURIComponent(orgId)}`,
      );
    } catch (err) {
      if (err instanceof BifrostHttpError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * POST /_plugin/trust — register or replace an org. Idempotent on
   * `(org_id, pubkey, issuer_url, revocation_poll_seconds)`. The
   * plugin canonicalises pubkey case on its side.
   */
  async upsertTrust(input: TrustOrgUpsert): Promise<TrustUpsertResponse> {
    return this.request<TrustUpsertResponse>(
      "POST",
      "/_plugin/trust",
      input,
    );
  }

  /**
   * PUT /_plugin/trust/realm_id — set (or clear, with `""`) the
   * swarm's own self-identity. Added in phase 11 so multi-swarm
   * deployments can pin a per-swarm realm-id without redeploying
   * the plugin. Idempotent: re-sending the same value is a no-op.
   */
  async setRealmId(realmId: string): Promise<TrustRealmIDResponse> {
    const body: TrustRealmIDRequest = { realm_id: realmId };
    return this.request<TrustRealmIDResponse>(
      "PUT",
      "/_plugin/trust/realm_id",
      body,
    );
  }

  /**
   * POST /_plugin/agents — seed the gateway's neo4j agent catalog.
   * Whole-fleet, replace-by-source: the manifest is the complete set
   * of agents this `source` knows about, so the plugin replaces that
   * source's existing entries in one transaction. Idempotent — safe to
   * re-send the same manifest (the seed reconciler gates re-sends on a
   * content hash, but the endpoint tolerates duplicates regardless).
   */
  async seedAgentCatalog(
    manifest: AgentCatalogManifest,
  ): Promise<SeedAgentsResponse> {
    return this.request<SeedAgentsResponse>(
      "POST",
      "/_plugin/agents",
      manifest,
    );
  }

  /**
   * POST /_plugin/hive-callback — register Hive's externally-reachable
   * origin and a workspace-scoped API key with the Bifrost gateway so
   * the gateway can delegate eval mutations/runs back to Hive.
   *
   * Request body:
   *   { hive_url: string, api_key: string }
   *   - hive_url  : Externally-reachable Hive origin, e.g.
   *                 "https://hive.example.com". Must NOT end with a
   *                 path segment — the gateway appends
   *                 `/api/gateway/evals/...` itself.
   *   - api_key   : Raw (unhashed) Hive workspace API key minted
   *                 specifically for this gateway callback. The gateway
   *                 stores it and includes it as
   *                 `Authorization: Bearer <key>` on every callback
   *                 request to Hive.
   *
   * Expected gateway response (HiveCallbackResponse):
   *   { ok: boolean }
   *   ok == true  → gateway accepted and persisted the config.
   *   ok == false → gateway received the request but declined it
   *                 (e.g. validation error). The reconciler treats this
   *                 as a failure and does NOT persist gatewayHiveKeyId.
   *
   * Authenticates with Bearer + the swarm's provisioning token
   * (same auth model as `seedAgentCatalog` and `setRealmId`).
   */
  async pushHiveCallback(
    payload: HiveCallbackPayload,
  ): Promise<HiveCallbackResponse> {
    return this.request<HiveCallbackResponse>(
      "POST",
      "/_plugin/hive-callback",
      payload,
    );
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        throw new BifrostHttpError(
          0,
          undefined,
          `Bifrost plugin ${method} ${path} timed out after ${this.timeoutMs}ms`,
        );
      }
      throw new BifrostHttpError(
        0,
        undefined,
        `Bifrost plugin ${method} ${path} network error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    clearTimeout(timer);

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Plugin returns plain-text errors from `http.Error`. Leave
        // `parsed` undefined; surface the raw text via the error.
      }
    }

    if (!response.ok) {
      const detail = extractErrorMessage(parsed) ?? text.slice(0, 200);
      throw new BifrostHttpError(
        response.status,
        parsed,
        `Bifrost plugin ${method} ${path} failed: ${response.status} ${detail}`,
      );
    }

    return parsed as T;
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body) {
    const v = (body as { error: unknown }).error;
    if (typeof v === "string") return v;
  }
  return undefined;
}
