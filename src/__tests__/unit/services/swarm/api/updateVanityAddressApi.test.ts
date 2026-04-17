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

const { updateVanityAddressApi } = await import("@/services/swarm/api/swarm");

describe("updateVanityAddressApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("POSTs to the correct URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: "Vanity address updated" }),
    });

    await updateVanityAddressApi("myswarm.sphinx.chat", "newname.sphinx.chat");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://swarm-admin.example.com/api/super/update_swarm_vanity_address"
    );
  });

  test("uses POST method", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: "Vanity address updated" }),
    });

    await updateVanityAddressApi("myswarm.sphinx.chat", "newname.sphinx.chat");

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("POST");
  });

  test("sends x-super-token header with the API key", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: "Vanity address updated" }),
    });

    await updateVanityAddressApi("myswarm.sphinx.chat", "newname.sphinx.chat");

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["x-super-token"]).toBe("test-super-token");
  });

  test("sends correct body with host and vanity_address", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: "Vanity address updated" }),
    });

    await updateVanityAddressApi("myswarm.sphinx.chat", "newname.sphinx.chat");

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.host).toBe("myswarm.sphinx.chat");
    expect(body.vanity_address).toBe("newname.sphinx.chat");
  });

  test("sends Content-Type application/json header", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: "Vanity address updated" }),
    });

    await updateVanityAddressApi("myswarm.sphinx.chat", "newname.sphinx.chat");

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  test("returns parsed JSON response on success", async () => {
    const expected = { success: true, message: "Vanity address updated" };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => expected,
    });

    const result = await updateVanityAddressApi("myswarm.sphinx.chat", "newname.sphinx.chat");
    expect(result).toEqual(expected);
  });

  test("throws when response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ success: false, message: "Bad gateway" }),
    });

    await expect(
      updateVanityAddressApi("myswarm.sphinx.chat", "newname.sphinx.chat")
    ).rejects.toThrow("Bad gateway");
  });

  test("throws with fallback message when error response has no message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(
      updateVanityAddressApi("myswarm.sphinx.chat", "newname.sphinx.chat")
    ).rejects.toThrow("Request failed with status 500");
  });

  test("throws when fetch throws a network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    await expect(
      updateVanityAddressApi("myswarm.sphinx.chat", "newname.sphinx.chat")
    ).rejects.toThrow("Network error");
  });
});
