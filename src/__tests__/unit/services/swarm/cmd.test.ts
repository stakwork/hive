import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

// Mock fetch globally before importing
const mockFetch = vi.fn();
global.fetch = mockFetch;

const { getSwarmCmdJwt, swarmCmdRequest } = await import("@/services/swarm/cmd");

describe("getSwarmCmdJwt", () => {
  let savedUseMocks: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure production routing (no mocks) for getSwarmCmdJwt tests
    savedUseMocks = process.env.USE_MOCKS;
    delete process.env.USE_MOCKS;
  });

  afterEach(() => {
    if (savedUseMocks !== undefined) {
      process.env.USE_MOCKS = savedUseMocks;
    } else {
      delete process.env.USE_MOCKS;
    }
  });

  const swarmUrl = "https://swarm42.sphinx.chat";
  const swarmPassword = "secret-password";

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

// ---------------------------------------------------------------------------
// swarmCmdRequest — USE_MOCKS routing + double-encoded JSON (handled in cmd.ts ticket)
// ---------------------------------------------------------------------------

describe("swarmCmdRequest", () => {
  const swarmUrl = "https://swarm42.sphinx.chat";
  const jwt = "test-jwt-token";
  const cmd = { type: "Swarm" as const, data: { cmd: "GetBoltwallAccessibility" as const } };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USE_MOCKS;
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  test("routes to host:8800 in production (no USE_MOCKS)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ isPublic: false }),
    });

    await swarmCmdRequest({ swarmUrl, jwt, cmd });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("swarm42.sphinx.chat:8800/api/cmd");
  });

  test("routes to NEXTAUTH_URL mock endpoint when USE_MOCKS=true", async () => {
    process.env.USE_MOCKS = "true";
    process.env.NEXTAUTH_URL = "http://localhost:3000";

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ isPublic: false }),
    });

    await swarmCmdRequest({ swarmUrl, jwt, cmd });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("localhost:3000/api/mock/swarm-super-admin/api/cmd");
  });

  test("returns parsed object for single-encoded JSON response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ isPublic: false }),
    });

    const result = await swarmCmdRequest({ swarmUrl, jwt, cmd });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ isPublic: false });
    expect(result.rawText).toBeUndefined();
  });

  test("handles double-encoded JSON (string wrapping a JSON object)", async () => {
    // sphinx-swarm returns: "\"{\\"isPublic\\":false}\"" — a string that is itself valid JSON
    const inner = JSON.stringify({ isPublic: false });
    const doubleEncoded = JSON.stringify(inner); // produces `"\"{\\"isPublic\\":false}\""`

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => doubleEncoded,
    });

    const result = await swarmCmdRequest({ swarmUrl, jwt, cmd });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ isPublic: false });
  });

  test("handles double-encoded JSON array", async () => {
    const inner = JSON.stringify([{ id: 1, route: "v2/search" }]);
    const doubleEncoded = JSON.stringify(inner);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => doubleEncoded,
    });

    const result = await swarmCmdRequest({ swarmUrl, jwt, cmd });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([{ id: 1, route: "v2/search" }]);
  });

  test("returns rawText when response is not valid JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });

    const result = await swarmCmdRequest({ swarmUrl, jwt, cmd });

    expect(result.ok).toBe(false);
    expect(result.rawText).toBe("Service Unavailable");
    expect(result.data).toBeUndefined();
  });
});
