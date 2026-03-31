import { describe, test, expect, beforeEach, vi } from "vitest";

// Mock fetch globally before importing
const mockFetch = vi.fn();
global.fetch = mockFetch;

const { getSwarmCmdJwt } = await import("@/services/swarm/cmd");

describe("getSwarmCmdJwt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
