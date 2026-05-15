import { describe, it, expect, vi, beforeEach } from "vitest";
import { BifrostClient, BifrostHttpError } from "@/services/bifrost/BifrostClient";

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BifrostClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  function makeClient() {
    return new BifrostClient({
      baseUrl: "http://bifrost.test:8181",
      adminUser: "admin",
      adminPassword: "secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
  }

  it("sends Basic auth + JSON content-type", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        customers: [],
        count: 0,
        total_count: 0,
        limit: 10,
        offset: 0,
      }),
    );

    const client = makeClient();
    await client.listCustomers({ search: "u_alice", limit: 10 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "http://bifrost.test:8181/api/governance/customers?search=u_alice&limit=10",
    );
    const expectedToken = Buffer.from("admin:secret", "utf-8").toString("base64");
    expect((init as RequestInit).method).toBe("GET");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${expectedToken}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("trims a trailing slash on baseUrl", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        customers: [],
        count: 0,
        total_count: 0,
        limit: 10,
        offset: 0,
      }),
    );

    const client = new BifrostClient({
      baseUrl: "http://bifrost.test:8181/",
      adminUser: "u",
      adminPassword: "p",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await client.listCustomers();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://bifrost.test:8181/api/governance/customers",
    );
  });

  it("createCustomer POSTs the full body", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        message: "Customer created successfully",
        customer: {
          id: "cust-1",
          name: "u_alice",
          created_at: "2026-05-14T00:00:00Z",
        },
      }),
    );

    const client = makeClient();
    const out = await client.createCustomer({
      name: "u_alice",
      budget: { max_limit: 1000, reset_duration: "1d" },
      rate_limit: {
        request_max_limit: 1000,
        request_reset_duration: "1m",
        token_max_limit: 5_000_000,
        token_reset_duration: "1m",
      },
    });

    expect(out.customer.id).toBe("cust-1");
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.name).toBe("u_alice");
    expect(body.budget.max_limit).toBe(1000);
    expect(body.rate_limit.request_max_limit).toBe(1000);
  });

  it("listVirtualKeys includes customer_id in the query string", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        virtual_keys: [],
        count: 0,
        total_count: 0,
        limit: 10,
        offset: 0,
      }),
    );

    const client = makeClient();
    await client.listVirtualKeys({
      search: "u_alice",
      customer_id: "cust-1",
      limit: 10,
    });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("customer_id=cust-1");
    expect(url).toContain("search=u_alice");
    expect(url).toContain("limit=10");
  });

  it("createVirtualKey sends provider_configs and customer_id", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        message: "Virtual key created successfully",
        virtual_key: {
          id: "vk-1",
          name: "u_alice",
          value: "sk-bf-XYZ",
          customer_id: "cust-1",
          created_at: "2026-05-14T00:00:01Z",
        },
      }),
    );

    const client = makeClient();
    const out = await client.createVirtualKey({
      name: "u_alice",
      customer_id: "cust-1",
      provider_configs: [
        { provider: "anthropic", allowed_models: ["*"] },
        { provider: "openai", allowed_models: ["*"] },
      ],
    });

    expect(out.virtual_key.value).toBe("sk-bf-XYZ");
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.customer_id).toBe("cust-1");
    expect(body.provider_configs).toHaveLength(2);
    expect(body.provider_configs[0]).toEqual({
      provider: "anthropic",
      allowed_models: ["*"],
    });
  });

  it("throws BifrostHttpError with detail on non-2xx", async () => {
    fetchMock.mockResolvedValue(
      makeResponse(400, { error: "Customer name is required" }),
    );

    const client = makeClient();
    const err = (await client
      .createCustomer({ name: "" })
      .catch((e) => e)) as BifrostHttpError;
    expect(err.name).toBe("BifrostHttpError");
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/Customer name is required/);
  });

  it("returns a network BifrostHttpError when fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const client = makeClient();
    const err = (await client
      .listCustomers()
      .catch((e) => e)) as BifrostHttpError;
    expect(err).toBeInstanceOf(BifrostHttpError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/network error/);
  });
});
