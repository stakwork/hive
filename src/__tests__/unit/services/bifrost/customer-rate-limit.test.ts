import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hasTokenLimit,
  stripCustomerTokenLimit,
} from "@/services/bifrost/customer-rate-limit";
import {
  BifrostHttpError,
  type BifrostClient,
} from "@/services/bifrost/BifrostClient";

const REQUEST_ONLY = { request_max_limit: 1000, request_reset_duration: "1m" };
const LEGACY = {
  ...REQUEST_ONLY,
  token_max_limit: 5_000_000,
  token_reset_duration: "1m",
};

function customer(extra: Record<string, unknown> = {}) {
  return { id: "cust-1", name: "alice-u_1", created_at: "2026-01-01", ...extra };
}

function makeClient(overrides: Partial<BifrostClient> = {}): BifrostClient {
  return {
    getCustomer: vi.fn(),
    updateCustomer: vi.fn().mockResolvedValue({
      message: "ok",
      customer: customer({ rate_limit: REQUEST_ONLY }),
    }),
    ...overrides,
  } as unknown as BifrostClient;
}

describe("hasTokenLimit", () => {
  it("is false without a rate limit", () => {
    expect(hasTokenLimit(customer())).toBe(false);
    expect(hasTokenLimit(customer({ rate_limit: null }))).toBe(false);
    expect(hasTokenLimit(customer({ rate_limit: {} }))).toBe(false);
  });

  it("is false for a request-only rate limit", () => {
    expect(hasTokenLimit(customer({ rate_limit: REQUEST_ONLY }))).toBe(false);
    expect(
      hasTokenLimit(
        customer({ rate_limit: { ...REQUEST_ONLY, token_max_limit: null } }),
      ),
    ).toBe(false);
  });

  it("is true when a token cap is set", () => {
    expect(hasTokenLimit(customer({ rate_limit: LEGACY }))).toBe(true);
  });
});

describe("stripCustomerTokenLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("leaves a Customer without a rate limit alone", async () => {
    const client = makeClient();
    const input = customer({ rate_limit: null });

    const out = await stripCustomerTokenLimit(client, input);

    expect(out).toEqual({ customer: input, stripped: false });
    expect(client.getCustomer).not.toHaveBeenCalled();
    expect(client.updateCustomer).not.toHaveBeenCalled();
  });

  it("leaves a request-only rate limit alone", async () => {
    const client = makeClient();
    const input = customer({ rate_limit: REQUEST_ONLY });

    const out = await stripCustomerTokenLimit(client, input);

    expect(out).toEqual({ customer: input, stripped: false });
    expect(client.updateCustomer).not.toHaveBeenCalled();
  });

  it("re-sends the request limit verbatim and drops the token fields", async () => {
    const client = makeClient();
    const input = customer({
      rate_limit: { ...LEGACY, request_max_limit: 250, request_reset_duration: "30s" },
    });

    const out = await stripCustomerTokenLimit(client, input);

    expect(out.stripped).toBe(true);
    expect(client.updateCustomer).toHaveBeenCalledTimes(1);
    expect(client.updateCustomer).toHaveBeenCalledWith("cust-1", {
      rate_limit: { request_max_limit: 250, request_reset_duration: "30s" },
    });
    // Absent, not null: Bifrost replaces all four fields on PUT.
    const sent = vi.mocked(client.updateCustomer).mock.calls[0][1].rate_limit;
    expect(sent).not.toHaveProperty("token_max_limit");
    expect(sent).not.toHaveProperty("token_reset_duration");
    // What Bifrost reports back is what the caller gets.
    expect(out.customer.rate_limit).toEqual(REQUEST_ONLY);
  });

  it("sends an empty rate_limit when the token cap was the only limit", async () => {
    const client = makeClient({
      updateCustomer: vi.fn().mockResolvedValue({
        message: "ok",
        customer: customer({ rate_limit: null }),
      }),
    });

    const out = await stripCustomerTokenLimit(
      client,
      customer({
        rate_limit: { token_max_limit: 5_000_000, token_reset_duration: "1m" },
      }),
    );

    expect(out.stripped).toBe(true);
    expect(client.updateCustomer).toHaveBeenCalledWith("cust-1", {
      rate_limit: {},
    });
  });

  it("reads the Customer back when the row didn't hydrate its rate limit", async () => {
    const client = makeClient({
      getCustomer: vi
        .fn()
        .mockResolvedValue({ customer: customer({ rate_limit: LEGACY }) }),
    });

    const out = await stripCustomerTokenLimit(
      client,
      customer({ rate_limit_id: "rl-1" }),
    );

    expect(client.getCustomer).toHaveBeenCalledWith("cust-1");
    expect(out.stripped).toBe(true);
    expect(client.updateCustomer).toHaveBeenCalledWith("cust-1", {
      rate_limit: REQUEST_ONLY,
    });
  });

  it("reads back, then leaves a clean Customer alone", async () => {
    const hydrated = customer({ rate_limit: REQUEST_ONLY });
    const client = makeClient({
      getCustomer: vi.fn().mockResolvedValue({ customer: hydrated }),
    });

    const out = await stripCustomerTokenLimit(
      client,
      customer({ rate_limit_id: "rl-1" }),
    );

    expect(out).toEqual({ customer: hydrated, stripped: false });
    expect(client.updateCustomer).not.toHaveBeenCalled();
  });

  it("does not read back a row with no rate_limit_id either", async () => {
    const client = makeClient();

    const out = await stripCustomerTokenLimit(client, customer());

    expect(out.stripped).toBe(false);
    expect(client.getCustomer).not.toHaveBeenCalled();
  });

  it("propagates a Bifrost error", async () => {
    const client = makeClient({
      updateCustomer: vi
        .fn()
        .mockRejectedValue(
          new BifrostHttpError(500, undefined, "Failed to update customer"),
        ),
    });

    await expect(
      stripCustomerTokenLimit(client, customer({ rate_limit: LEGACY })),
    ).rejects.toBeInstanceOf(BifrostHttpError);
  });
});
