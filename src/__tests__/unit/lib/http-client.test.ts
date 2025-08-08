import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient, type ApiError } from "@/lib/http-client";

declare global {
  // eslint-disable-next-line no-var
  var fetch: typeof fetch;
}

describe("HttpClient", () => {
  const baseURL = "https://api.test";
  let client: HttpClient;

  beforeEach(() => {
    client = new HttpClient({ baseURL, defaultHeaders: { A: "a" }, timeout: 50 });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("merges headers with precedence: defaultHeaders < call headers", async () => {
    const json = { ok: true };
    const mockResp = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(json),
    } as unknown as Response;
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(mockResp);

    await client.post("/endpoint", { x: 1 }, { B: "b", A: "override" }, "svc");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const args = fetchSpy.mock.calls[0];
    const init = args[1] as RequestInit;
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      A: "override",
      B: "b",
    });
  });

  it("returns parsed JSON when response ok", async () => {
    const payload = { hello: "world" };
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response);

    const res = await client.get<typeof payload>("/hello", undefined, "svc");
    expect(res).toEqual(payload);
  });

  it("PUT/PATCH/DELETE methods pass through correctly", async () => {
    const payload = { ok: true };
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response);

    await expect(client.put("/p", { a: 1 }, { X: "1" }, "svc")).resolves.toEqual(payload);
    await expect(client.patch("/p", { b: 2 }, { Y: "2" }, "svc")).resolves.toEqual(payload);
    await expect(client.delete("/p", { Z: "3" }, "svc")).resolves.toEqual(payload);
  });

  it("allows caller to override Content-Type header", async () => {
    const payload = { ok: true };
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response);

    await client.post("/override", { a: 1 }, { "Content-Type": "text/plain" }, "svc");
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("text/plain");
  });

  it("throws ApiError with details on non-ok response and non-JSON body", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new Error("no json")),
    } as unknown as Response);

    await expect(client.get("/err", undefined, "svc")).rejects.toMatchObject({
      message: "HTTP error! status: 502",
      status: 502,
      service: "svc",
    } satisfies Partial<ApiError>);
  });

  it("throws timeout ApiError when request exceeds timeout", async () => {
    // Simulate AbortController abort triggering fetch to reject with AbortError
    vi.spyOn(global, "fetch").mockImplementation((input, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise((_, reject) => {
        const onAbort = () => {
          signal?.removeEventListener("abort", onAbort);
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort);
      }) as unknown as Promise<Response>;
    });

    const p = client
      .get("/slow", undefined, "svc")
      .then(() => null)
      .catch((e) => e as ApiError);
    await vi.advanceTimersByTimeAsync(60);
    const caught = await p;
    expect(caught).toMatchObject({
      message: "Request timeout",
      status: 408,
      service: "svc",
    } satisfies Partial<ApiError>);
    // Ensure no leftover timers or microtasks
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("throws network error ApiError on TypeError", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("fail"));

    await expect(client.get("/nw", undefined, "svc")).rejects.toMatchObject({
      message: "Network error - unable to reach the server",
      status: 0,
      service: "svc",
    } satisfies Partial<ApiError>);
  });

  it("updateApiKey augments default headers", async () => {
    client.updateApiKey("NEW");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as Response);

    await client.get("/a", undefined, "svc");
    // No direct accessor for headers; ensure request includes Authorization when adding call headers
    const fetchArgs = (global.fetch as unknown as any).mock.calls[0];
    const init = fetchArgs[1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer NEW" });
  });
});


