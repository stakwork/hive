import { describe, test, expect, beforeEach, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock("@/services/swarm/cmd", () => ({
  getSwarmCmdJwt: vi.fn(),
  swarmCmdRequest: vi.fn(),
}));

// Mock retry to avoid real delays in tests
vi.mock("@/lib/utils/retry", () => ({
  retryWithExponentialBackoff: vi.fn(async (fn, opts) => {
    // Execute the function up to maxAttempts times, same as the real implementation
    const maxAttempts = opts?.maxAttempts ?? 8;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;
      }
    }
    throw lastError;
  }),
}));

const { setGraphTitle } = await import("@/services/swarm/graph-title");
const { getSwarmCmdJwt, swarmCmdRequest } = await import("@/services/swarm/cmd");

// ── Tests ────────────────────────────────────────────────────────────────────

const SWARM_URL = "https://swarm42.sphinx.chat";
const SWARM_PASSWORD = "secret-password";
const TITLE = "my-workspace-slug";
const JARVIS_STATS_URL = "https://swarm42.sphinx.chat:8444/stats";

describe("setGraphTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSwarmCmdJwt).mockResolvedValue("mock-jwt");
    vi.mocked(swarmCmdRequest).mockResolvedValue({ ok: true, status: 200, data: { success: true } });
  });

  test("calls UpdateSecondBrainAbout with correct title and empty description after stats returns 200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE);

    expect(mockFetch).toHaveBeenCalledWith(
      JARVIS_STATS_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    expect(getSwarmCmdJwt).toHaveBeenCalledWith(SWARM_URL, SWARM_PASSWORD);
    expect(swarmCmdRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        swarmUrl: SWARM_URL,
        jwt: "mock-jwt",
        cmd: {
          type: "Swarm",
          data: {
            cmd: "UpdateSecondBrainAbout",
            content: { title: TITLE, description: "" },
          },
        },
      }),
    );
  });

  test("retries when :8444/stats returns non-200", async () => {
    // Fail twice, succeed on third
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(swarmCmdRequest).toHaveBeenCalledTimes(1);
  });

  test("does NOT call getSwarmCmdJwt until stats probe succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE);

    // jwt should only be fetched after stats succeeds
    expect(getSwarmCmdJwt).toHaveBeenCalledTimes(1);
    // fetch was called twice (once fail, once succeed) before jwt
    expect(mockFetch.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getSwarmCmdJwt).mock.invocationCallOrder[0],
    );
  });

  test("throws after max retries if stats never succeeds", async () => {
    // Always fail
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE)).rejects.toThrow(
      "Jarvis not ready: 503",
    );

    // swarmCmdRequest should never be called
    expect(swarmCmdRequest).not.toHaveBeenCalled();
    expect(getSwarmCmdJwt).not.toHaveBeenCalled();
  });

  test("throws if fetch rejects (network error) after max retries", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    await expect(setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE)).rejects.toThrow("Network error");

    expect(swarmCmdRequest).not.toHaveBeenCalled();
  });
});
