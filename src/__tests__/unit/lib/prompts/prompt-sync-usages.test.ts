/**
 * Unit tests for fetchPromptUsagesByName and fetchVersionRunCount helpers.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.test/api/v1",
    STAKWORK_API_KEY: "test-key-xyz",
    WORKFLOW_GRAPH_PROMPT_STORAGE_ID: "",
  },
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.test/api/v1",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock db so the module loads without a real DB connection
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({ stakworkRequest: vi.fn() })),
}));

import { fetchPromptUsagesByName, fetchVersionRunCount } from "@/services/prompts/prompt-sync";
import { logger } from "@/lib/logger";

global.fetch = vi.fn();
const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(logger.warn).mockClear();
});

// ─── fetchPromptUsagesByName ───────────────────────────────────────────────────

describe("fetchPromptUsagesByName", () => {
  test("returns name→usages map on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          prompts: [
            {
              name: "MY_PROMPT",
              usages: [
                { workflow_id: 1, workflow_name: "Flow A", step_id: "step_1" },
                { workflow_id: 2, workflow_name: "Flow B", step_id: "step_2" },
              ],
            },
            {
              name: "OTHER_PROMPT",
              usages: [],
            },
          ],
        },
      }),
    } as Response);

    const map = await fetchPromptUsagesByName();

    expect(map.size).toBe(2);
    expect(map.get("MY_PROMPT")).toEqual([
      { workflow_id: 1, workflow_name: "Flow A", step_id: "step_1" },
      { workflow_id: 2, workflow_name: "Flow B", step_id: "step_2" },
    ]);
    expect(map.get("OTHER_PROMPT")).toEqual([]);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/prompts?include_usages=true");
    expect((opts as RequestInit).headers).toMatchObject({
      Authorization: "Token token=test-key-xyz",
    });
  });

  test("handles top-level prompts array (non-data-wrapped response)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        prompts: [
          { name: "PROMPT_X", usages: [{ workflow_id: 5, workflow_name: "WF5", step_id: "s5" }] },
        ],
      }),
    } as Response);

    const map = await fetchPromptUsagesByName();
    expect(map.get("PROMPT_X")).toEqual([{ workflow_id: 5, workflow_name: "WF5", step_id: "s5" }]);
  });

  test("returns empty Map and logs warn when Stakwork returns non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    const map = await fetchPromptUsagesByName();

    expect(map.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("503"),
      "prompt-sync",
      expect.objectContaining({ status: 503 }),
    );
  });

  test("returns empty Map and logs warn when Stakwork is unreachable (throws)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const map = await fetchPromptUsagesByName();

    expect(map.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("non-fatal"),
      "prompt-sync",
      expect.objectContaining({ error: expect.stringContaining("ECONNREFUSED") }),
    );
  });

  test("returns empty Map on malformed response (no prompts key)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ unexpected: "shape" }),
    } as Response);

    const map = await fetchPromptUsagesByName();
    expect(map.size).toBe(0);
  });

  test("skips entries missing name or usages without throwing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          prompts: [
            { name: "GOOD_PROMPT", usages: [{ workflow_id: 1, workflow_name: "W", step_id: "s" }] },
            { name: "NO_USAGES_KEY" }, // missing usages
            { usages: [] },            // missing name
            null,                      // garbage
          ],
        },
      }),
    } as Response);

    const map = await fetchPromptUsagesByName();
    expect(map.size).toBe(1);
    expect(map.has("GOOD_PROMPT")).toBe(true);
  });
});

// ─── fetchVersionRunCount ─────────────────────────────────────────────────────

describe("fetchVersionRunCount", () => {
  test("returns run_count on successful response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ notation: "MY_PROMPT@v3", run_count: 42 }),
    } as Response);

    const count = await fetchVersionRunCount("MY_PROMPT", "ver-abc123");

    expect(count).toBe(42);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/prompts/find_by_version");
    expect(url).toContain("name=MY_PROMPT");
    expect(url).toContain("hive_version_id=ver-abc123");
  });

  test("handles data-wrapped run_count", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { run_count: 7 } }),
    } as Response);

    const count = await fetchVersionRunCount("PROMPT_Y", "ver-def456");
    expect(count).toBe(7);
  });

  test("returns null on 404 (version not in Stakwork)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    const count = await fetchVersionRunCount("MISSING", "ver-999");
    expect(count).toBeNull();
    // 404 is expected — should not warn
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("returns null and logs warn on non-2xx non-404 status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502 } as Response);

    const count = await fetchVersionRunCount("MY_PROMPT", "ver-abc");
    expect(count).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("502"),
      "prompt-sync",
      expect.objectContaining({ status: 502 }),
    );
  });

  test("returns null and logs warn when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

    const count = await fetchVersionRunCount("MY_PROMPT", "ver-abc");
    expect(count).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("non-fatal"),
      "prompt-sync",
      expect.objectContaining({ error: expect.stringContaining("Network timeout") }),
    );
  });

  test("returns null when run_count is absent in response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ notation: "PROMPT@v1" }), // run_count missing
    } as Response);

    const count = await fetchVersionRunCount("PROMPT", "ver-xyz");
    expect(count).toBeNull();
  });
});
