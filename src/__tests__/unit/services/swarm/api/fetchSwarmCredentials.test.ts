import { describe, test, expect, beforeEach, vi } from "vitest";

// Mock config and env before importing the module under test
vi.mock("@/config/env", () => ({
  env: {
    SWARM_SUPERADMIN_API_KEY: "test-super-token",
  },
  config: {
    SWARM_SUPER_ADMIN_URL: "https://swarm-admin.example.com",
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_, v) => v),
    })),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { fetchSwarmCredentials } = await import("@/services/swarm/api/swarm");

describe("fetchSwarmCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("calls the correct URL with instance_id query param", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { username: "super", password: "mock-password" },
      }),
    });

    await fetchSwarmCredentials("i-1234567890abcdef0");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://swarm-admin.example.com/api/super/swarm_credentials?instance_id=i-1234567890abcdef0"
    );
  });

  test("sends x-super-token header with the API key", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { username: "super", password: "mock-password" },
      }),
    });

    await fetchSwarmCredentials("i-abc");

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["x-super-token"]).toBe("test-super-token");
  });

  test("uses GET method", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { username: "super", password: "mock-password" },
      }),
    });

    await fetchSwarmCredentials("i-abc");

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("GET");
  });

  test("returns username and password on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { username: "super", password: "s3cr3t" },
      }),
    });

    const result = await fetchSwarmCredentials("i-abc");
    expect(result).toEqual({ username: "admin", password: "s3cr3t" });
  });

  test("always returns 'admin' as username regardless of API response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { username: "super", password: "s3cr3t" },
      }),
    });

    const result = await fetchSwarmCredentials("i-abc");
    expect(result.username).toBe("admin");
  });

  test("returns 'admin' as username even when API returns no username", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { password: "s3cr3t" },
      }),
    });

    const result = await fetchSwarmCredentials("i-abc");
    expect(result).toEqual({ username: "admin", password: "s3cr3t" });
  });

  test("throws when success is false", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({
        success: false,
        message: "instance_id required",
      }),
    });

    await expect(fetchSwarmCredentials("")).rejects.toThrow(
      "Failed to fetch swarm credentials: instance_id required"
    );
  });

  test("throws when password is missing from response data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { username: "super" },
      }),
    });

    await expect(fetchSwarmCredentials("i-abc")).rejects.toThrow(
      "Swarm credentials response is missing password"
    );
  });

  test("URL-encodes the instance_id", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { username: "super", password: "pw" },
      }),
    });

    await fetchSwarmCredentials("i-abc def+xyz");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("instance_id=i-abc%20def%2Bxyz");
  });
});
