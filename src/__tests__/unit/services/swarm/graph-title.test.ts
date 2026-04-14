import { describe, test, expect, beforeEach, vi } from "vitest";

// Mock fetch globally before importing the module under test
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock retryWithExponentialBackoff to actually execute the fn (pass-through by default)
vi.mock("@/lib/utils/retry", () => ({
  retryWithExponentialBackoff: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("@/services/swarm/cmd", () => ({
  getSwarmCmdJwt: vi.fn(),
  swarmCmdRequest: vi.fn(),
}));

import { retryWithExponentialBackoff } from "@/lib/utils/retry";
import { getSwarmCmdJwt, swarmCmdRequest } from "@/services/swarm/cmd";
import { setGraphTitle } from "@/services/swarm/graph-title";

const mockRetry = vi.mocked(retryWithExponentialBackoff);
const mockGetJwt = vi.mocked(getSwarmCmdJwt);
const mockCmdRequest = vi.mocked(swarmCmdRequest);

const SWARM_URL = "https://my-graph.sphinx.chat/api";
const SWARM_PASSWORD = "super-secret";
const TITLE = "my-workspace-slug";

describe("setGraphTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: retry passes through, fetch returns 200, jwt resolves, cmd resolves
    mockRetry.mockImplementation(async (fn) => fn());
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    mockGetJwt.mockResolvedValue("test-jwt");
    mockCmdRequest.mockResolvedValue({ ok: true, status: 200 });
  });

  test("polls :8444/stats before calling the cmd API", async () => {
    await setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE);

    // retryWithExponentialBackoff should be called with correct options
    expect(mockRetry).toHaveBeenCalledWith(
      expect.any(Function),
      { maxAttempts: 8, baseDelayMs: 2000, maxDelayMs: 30000 },
    );

    // fetch should have been called for :8444/stats
    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-graph.sphinx.chat:8444/stats",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("throws when :8444/stats returns non-200 (retry exhausted)", async () => {
    // Override retry to actually run the retry loop and fail
    mockRetry.mockImplementation(async (fn) => {
      // Simulate all retries failing
      await fn(); // this throws because fetch returns non-200
    });
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE)).rejects.toThrow(
      "Jarvis not ready: 503",
    );
  });

  test("only calls getSwarmCmdJwt after :8444/stats returns 200", async () => {
    // Make retry call fn once successfully
    mockRetry.mockImplementation(async (fn) => fn());
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE);

    // getSwarmCmdJwt called after successful stats check
    expect(mockGetJwt).toHaveBeenCalledWith(SWARM_URL, SWARM_PASSWORD);
  });

  test("does not call getSwarmCmdJwt if :8444/stats check fails", async () => {
    mockRetry.mockImplementation(async (fn) => {
      await fn(); // throws
    });
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE)).rejects.toThrow();
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("calls UpdateSecondBrainAbout with correct title and empty description", async () => {
    await setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE);

    expect(mockCmdRequest).toHaveBeenCalledWith({
      swarmUrl: SWARM_URL,
      jwt: "test-jwt",
      cmd: {
        type: "Swarm",
        data: {
          cmd: "UpdateSecondBrainAbout",
          content: { title: TITLE, description: "" },
        },
      },
    });
  });

  test("throws if retryWithExponentialBackoff exhausts all attempts", async () => {
    const exhaustedError = new Error("Max retries exceeded");
    mockRetry.mockRejectedValue(exhaustedError);

    await expect(setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE)).rejects.toThrow(
      "Max retries exceeded",
    );

    // cmd API never reached
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  test("retries on non-200 stats response before succeeding", async () => {
    // Simulate retry calling fn twice: first fails, second succeeds
    let callCount = 0;
    mockRetry.mockImplementation(async (fn) => {
      callCount++;
      if (callCount === 1) {
        // First attempt: fn would throw — simulate by just throwing
        throw new Error("Jarvis not ready: 503");
      }
      // Should not be called again since retry itself is mocked
    });

    await expect(setGraphTitle(SWARM_URL, SWARM_PASSWORD, TITLE)).rejects.toThrow(
      "Jarvis not ready: 503",
    );
  });

  test("extracts hostname correctly from swarmUrl for :8444 probe", async () => {
    await setGraphTitle("https://custom-host.example.com/api", SWARM_PASSWORD, TITLE);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom-host.example.com:8444/stats",
      expect.anything(),
    );
  });
});
