import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Agent } from "undici";

// Mock fetch globally before importing
const mockFetch = vi.fn();
global.fetch = mockFetch;

const { getSwarmCmdJwt, swarmCmdRequest, SwarmCmdConfigError } = await import("@/services/swarm/cmd");

const swarmUrl = "https://swarm42.sphinx.chat";
const swarmPassword = "secret-password";
const jwt = "test-jwt-token";
const cmd = { type: "Swarm" as const, data: { cmd: "GetBoltwallAccessibility" as const } };

describe("getSwarmCmdJwt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("uses 'admin' as username by default", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: "jwt-token-abc" }),
    });

    await getSwarmCmdJwt(swarmUrl, swarmPassword);

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.username).toBe("admin");
    expect(body.password).toBe(swarmPassword);
  });

  test("uses the provided username when specified", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: "jwt-token-xyz" }),
    });

    await getSwarmCmdJwt(swarmUrl, swarmPassword, "super");

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.username).toBe("super");
    expect(body.password).toBe(swarmPassword);
  });

  test("calls the correct login URL derived from swarmUrl", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: "jwt-token" }),
    });

    await getSwarmCmdJwt(swarmUrl, swarmPassword);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://swarm42.sphinx.chat:8800/api/login");
  });

  test("returns the token from the response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: "my-jwt" }),
    });

    const jwt = await getSwarmCmdJwt(swarmUrl, swarmPassword);
    expect(jwt).toBe("my-jwt");
  });

  test("accepts jwt field as token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jwt: "my-jwt-field" }),
    });

    const jwt = await getSwarmCmdJwt(swarmUrl, swarmPassword);
    expect(jwt).toBe("my-jwt-field");
  });

  test("accepts access_token field as token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "my-access-token" }),
    });

    const jwt = await getSwarmCmdJwt(swarmUrl, swarmPassword);
    expect(jwt).toBe("my-access-token");
  });

  test("throws when login response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Unauthorized",
    });

    await expect(getSwarmCmdJwt(swarmUrl, swarmPassword)).rejects.toThrow("Swarm login failed (401)");
  });

  test("throws when response does not include a token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ message: "ok" }),
    });

    await expect(getSwarmCmdJwt(swarmUrl, swarmPassword)).rejects.toThrow(
      "Swarm login response did not include token/jwt"
    );
  });
});

describe("swarmCmdRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("parses normal (single-encoded) JSON correctly", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ isPublic: true }),
    });

    const result = await swarmCmdRequest({ swarmUrl, jwt, cmd });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ isPublic: true });
    expect(result.rawText).toBeUndefined();
  });

  test("unwraps double-encoded JSON object (string wrapping a JSON object)", async () => {
    // sphinx-swarm returns a JSON string whose value is another JSON string
    const innerJson = JSON.stringify({ isPublic: false });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(innerJson), // double-encoded
    });

    const result = await swarmCmdRequest({ swarmUrl, jwt, cmd });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ isPublic: false });
    expect(result.rawText).toBeUndefined();
  });

  test("unwraps double-encoded JSON array", async () => {
    const innerJson = JSON.stringify([{ id: 1, route: "v2/search", status: true }]);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(innerJson),
    });

    const listCmd = { type: "Swarm" as const, data: { cmd: "ListPaidEndpoint" as const } };
    const result = await swarmCmdRequest({ swarmUrl, jwt, cmd: listCmd });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([{ id: 1, route: "v2/search", status: true }]);
  });

  test("returns rawText when response is non-JSON text", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const result = await swarmCmdRequest({ swarmUrl, jwt, cmd });

    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.rawText).toBe("Internal Server Error");
  });

  test("calls correct cmd endpoint URL with encoded query params", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    });

    await swarmCmdRequest({ swarmUrl, jwt, cmd });

    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain("https://swarm42.sphinx.chat:8800/api/cmd");
    expect(calledUrl).toContain("txt=");
    expect(calledUrl).toContain("tag=SWARM");
  });

  test("sends x-jwt header", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    });

    await swarmCmdRequest({ swarmUrl, jwt, cmd });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["x-jwt"]).toBe(jwt);
  });
});

describe("swarmCmdRequest — malformed swarmUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("resolves a CONFIG_INVALID result without throwing for an unparseable URL", async () => {
    const result = await swarmCmdRequest({ swarmUrl: "not a url", jwt, cmd });

    expect(result).toEqual({ ok: false, status: 0, data: null, rawText: "", errorCode: "CONFIG_INVALID" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("resolves CONFIG_INVALID for a non-http(s) protocol", async () => {
    const result = await swarmCmdRequest({ swarmUrl: "ftp://swarm42.sphinx.chat", jwt, cmd });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("CONFIG_INVALID");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("getSwarmCmdJwt throws a typed SwarmCmdConfigError for an unparseable URL", async () => {
    await expect(getSwarmCmdJwt("not a url", "pw")).rejects.toThrowError(SwarmCmdConfigError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("swarmCmdRequest — timeoutMs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Simulate real fetch: reject with AbortError when the passed signal fires. */
  function hangingFetch(): ReturnType<typeof vi.fn> {
    return vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("This operation was aborted", "AbortError"));
          });
        }),
    );
  }

  test("resolves a TIMEOUT result when the request exceeds timeoutMs (does not throw)", async () => {
    mockFetch.mockImplementation(hangingFetch());

    const result = await swarmCmdRequest({ swarmUrl, jwt, cmd, timeoutMs: 15 });

    expect(result).toEqual({ ok: false, status: 0, data: null, rawText: "", errorCode: "TIMEOUT" });
  });

  test("passes an AbortSignal to fetch when timeoutMs is set", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });

    await swarmCmdRequest({ swarmUrl, jwt, cmd, timeoutMs: 1000 });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("without timeoutMs, a slow response still resolves normally and no signal is passed (regression)", async () => {
    mockFetch.mockImplementation(
      async () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ ok: true, status: 200, text: async () => JSON.stringify({ slow: true }) }),
            25,
          ),
        ),
    );

    const result = await swarmCmdRequest({ swarmUrl, jwt, cmd });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ slow: true });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.signal).toBeUndefined();
    expect(init.dispatcher).toBeUndefined();
  });
});

describe("getSwarmCmdJwt — timeoutMs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rejects (keeps throwing) when the login hangs past timeoutMs", async () => {
    mockFetch.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("This operation was aborted", "AbortError"));
          });
        }),
    );

    await expect(getSwarmCmdJwt(swarmUrl, swarmPassword, "admin", 15)).rejects.toThrow();
  });

  test("without timeoutMs, a slow login still resolves and no signal is passed (regression)", async () => {
    mockFetch.mockImplementation(
      async () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ ok: true, status: 200, text: async () => JSON.stringify({ token: "slow-jwt" }) }),
            25,
          ),
        ),
    );

    const jwt = await getSwarmCmdJwt(swarmUrl, swarmPassword);

    expect(jwt).toBe("slow-jwt");
    const [, init] = mockFetch.mock.calls[0];
    expect(init.signal).toBeUndefined();
    expect(init.dispatcher).toBeUndefined();
  });
});

describe("swarmCmdRequest / getSwarmCmdJwt — TLS handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  afterEach(() => {
    delete process.env.SWARM_CMD_ALLOW_INSECURE;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  test("passes a per-request undici Agent as dispatcher when SWARM_CMD_ALLOW_INSECURE=true", async () => {
    process.env.SWARM_CMD_ALLOW_INSECURE = "true";
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });

    await swarmCmdRequest({ swarmUrl, jwt, cmd });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.dispatcher).toBeInstanceOf(Agent);
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  test("passes no dispatcher when SWARM_CMD_ALLOW_INSECURE is unset", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });

    await swarmCmdRequest({ swarmUrl, jwt, cmd });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.dispatcher).toBeUndefined();
  });

  test("concurrent interleaved calls never mutate NODE_TLS_REJECT_UNAUTHORIZED", async () => {
    process.env.SWARM_CMD_ALLOW_INSECURE = "true";

    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    // First call: hangs until released (fetch mocked, signal unused).
    mockFetch.mockImplementationOnce(() => slowGate.then(() => ({ ok: true, status: 200, text: async () => "{}" })));
    // Second call: settles immediately.
    mockFetch.mockImplementationOnce(async () => ({ ok: true, status: 200, text: async () => "{}" }));

    const slow = swarmCmdRequest({ swarmUrl, jwt, cmd });
    const fast = swarmCmdRequest({ swarmUrl, jwt, cmd });

    // The fast call settles while the slow one is still open — the historic
    // finally-block would have restored the process-global TLS flag here.
    await fast;
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();

    releaseSlow();
    await slow;
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });
});
