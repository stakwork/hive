import { BIFROST_HTTP_TIMEOUT_MS } from "./constants";
import type {
  CreateCustomerResponse,
  CreateVirtualKeyResponse,
  GetVirtualKeyResponse,
  ListCustomersResponse,
  ListProvidersResponse,
  ListVirtualKeysResponse,
  UpdateVirtualKeyResponse,
  BifrostProvider,
  BifrostBudget,
  BifrostRateLimit,
} from "./types";

/**
 * Thin HTTP client for Bifrost's admin API. Authenticates with Basic
 * admin creds. Only what the VK reconciler needs is implemented:
 * Customer + VK list/create, `GET /api/providers` (so grants can be
 * narrowed to what the gateway has configured), and VK get + update
 * for provider-grant top-ups. Offboarding and Customer drift repair
 * (`PUT customers/<id>`) stay deferred to phase 2 per
 * `phase-1-reconciler.md`.
 */

export class BifrostHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "BifrostHttpError";
  }
}

export interface BifrostClientOptions {
  baseUrl: string;
  adminUser: string;
  adminPassword: string;
  /** Override the fetch implementation (for tests). */
  fetchImpl?: typeof fetch;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
}

interface CreateCustomerInput {
  name: string;
  budget?: BifrostBudget;
  rate_limit?: BifrostRateLimit;
}

interface CreateVirtualKeyInput {
  name: string;
  description?: string;
  customer_id: string;
  provider_configs: Array<{
    provider: BifrostProvider;
    allowed_models: string[];
    /**
     * `["*"]` -> Bifrost sets `allow_all_keys: true` on the resulting
     * provider_config. A list of UUIDs attaches those specific provider
     * keys. Omitted = no keys attached = inference fails with
     * "no keys found for provider: …". See types.ts and the Go handler
     * (`KeyIDs json:"key_ids"`).
     */
    key_ids?: string[];
  }>;
}

interface UpdateVirtualKeyInput {
  /**
   * Bifrost REPLACES the VK's provider_configs with this set: entries
   * carrying an `id` update that config in place, entries without one
   * are created, and any existing config missing from the list is
   * deleted. Always send the full set. Budgets and rate limits are
   * left untouched when omitted.
   */
  provider_configs: Array<{
    id?: number;
    provider: string;
    allowed_models: string[];
    blacklisted_models?: string[];
    weight?: number | null;
    key_ids?: string[];
  }>;
}

interface ListCustomersParams {
  search?: string;
  limit?: number;
  offset?: number;
}

interface ListVirtualKeysParams {
  search?: string;
  customer_id?: string;
  limit?: number;
  offset?: number;
}

export class BifrostClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: BifrostClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    const token = Buffer.from(
      `${opts.adminUser}:${opts.adminPassword}`,
      "utf-8",
    ).toString("base64");
    this.authHeader = `Basic ${token}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? BIFROST_HTTP_TIMEOUT_MS;
  }

  async listCustomers(
    params: ListCustomersParams = {},
  ): Promise<ListCustomersResponse> {
    const qs = buildQuery({ ...params });
    return this.request<ListCustomersResponse>(
      "GET",
      `/api/governance/customers${qs}`,
    );
  }

  async createCustomer(
    input: CreateCustomerInput,
  ): Promise<CreateCustomerResponse> {
    return this.request<CreateCustomerResponse>(
      "POST",
      `/api/governance/customers`,
      input,
    );
  }

  async listVirtualKeys(
    params: ListVirtualKeysParams = {},
  ): Promise<ListVirtualKeysResponse> {
    const qs = buildQuery({ ...params });
    return this.request<ListVirtualKeysResponse>(
      "GET",
      `/api/governance/virtual-keys${qs}`,
    );
  }

  async createVirtualKey(
    input: CreateVirtualKeyInput,
  ): Promise<CreateVirtualKeyResponse> {
    return this.request<CreateVirtualKeyResponse>(
      "POST",
      `/api/governance/virtual-keys`,
      input,
    );
  }

  async getVirtualKey(vkId: string): Promise<GetVirtualKeyResponse> {
    return this.request<GetVirtualKeyResponse>(
      "GET",
      `/api/governance/virtual-keys/${encodeURIComponent(vkId)}`,
    );
  }

  async updateVirtualKey(
    vkId: string,
    input: UpdateVirtualKeyInput,
  ): Promise<UpdateVirtualKeyResponse> {
    return this.request<UpdateVirtualKeyResponse>(
      "PUT",
      `/api/governance/virtual-keys/${encodeURIComponent(vkId)}`,
      input,
    );
  }

  /** The providers this gateway has configured (`GET /api/providers`). */
  async listProviders(): Promise<ListProvidersResponse> {
    return this.request<ListProvidersResponse>("GET", `/api/providers`);
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
          `Bifrost ${method} ${path} timed out after ${this.timeoutMs}ms`,
        );
      }
      throw new BifrostHttpError(
        0,
        undefined,
        `Bifrost ${method} ${path} network error: ${
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
        // Non-JSON body; leave `parsed` undefined.
      }
    }

    if (!response.ok) {
      const detail = extractErrorMessage(parsed) ?? text.slice(0, 200);
      throw new BifrostHttpError(
        response.status,
        parsed,
        `Bifrost ${method} ${path} failed: ${response.status} ${detail}`,
      );
    }

    return parsed as T;
  }
}

function buildQuery(
  params: Record<string, string | number | undefined | null>,
): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of entries) usp.set(k, String(v));
  return `?${usp.toString()}`;
}

function extractErrorMessage(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body) {
    const v = (body as { error: unknown }).error;
    if (typeof v === "string") return v;
  }
  return undefined;
}
