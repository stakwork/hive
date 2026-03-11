import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bucketByWindows, getPRCountForRepo } from "@/lib/github/pr-stats";

// ---------------------------------------------------------------------------
// bucketByWindows — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe("bucketByWindows", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");
  const nowMs = now.getTime();

  const ms = (h: number) => h * 60 * 60 * 1000;

  function itemAt(offsetMs: number): { createdAt: Date } {
    return { createdAt: new Date(nowMs - offsetMs) };
  }

  it("counts an item created 1 hour ago in all 5 windows", () => {
    const result = bucketByWindows([itemAt(ms(1))], now);
    expect(result["24h"]).toBe(1);
    expect(result["48h"]).toBe(1);
    expect(result["1w"]).toBe(1);
    expect(result["2w"]).toBe(1);
    expect(result["1mo"]).toBe(1);
  });

  it("counts an item at exactly the 24h boundary in the 24h window", () => {
    // Exactly 24h ago — should still be inside the 24h window (<=)
    const result = bucketByWindows([itemAt(ms(24))], now);
    expect(result["24h"]).toBe(1);
    expect(result["48h"]).toBe(1);
  });

  it("does not count an item just beyond 24h in the 24h window", () => {
    const result = bucketByWindows([itemAt(ms(24) + 1)], now);
    expect(result["24h"]).toBe(0);
    expect(result["48h"]).toBe(1);
  });

  it("counts an item at exactly the 48h boundary", () => {
    const result = bucketByWindows([itemAt(ms(48))], now);
    expect(result["24h"]).toBe(0);
    expect(result["48h"]).toBe(1);
    expect(result["1w"]).toBe(1);
  });

  it("does not count an item just beyond 48h in the 48h window", () => {
    const result = bucketByWindows([itemAt(ms(48) + 1)], now);
    expect(result["48h"]).toBe(0);
    expect(result["1w"]).toBe(1);
  });

  it("counts an item at exactly the 1w (7d) boundary", () => {
    const result = bucketByWindows([itemAt(ms(7 * 24))], now);
    expect(result["48h"]).toBe(0);
    expect(result["1w"]).toBe(1);
    expect(result["2w"]).toBe(1);
  });

  it("does not count an item just beyond 1w in the 1w window", () => {
    const result = bucketByWindows([itemAt(ms(7 * 24) + 1)], now);
    expect(result["1w"]).toBe(0);
    expect(result["2w"]).toBe(1);
  });

  it("counts an item at exactly the 2w (14d) boundary", () => {
    const result = bucketByWindows([itemAt(ms(14 * 24))], now);
    expect(result["1w"]).toBe(0);
    expect(result["2w"]).toBe(1);
    expect(result["1mo"]).toBe(1);
  });

  it("does not count an item just beyond 2w in the 2w window", () => {
    const result = bucketByWindows([itemAt(ms(14 * 24) + 1)], now);
    expect(result["2w"]).toBe(0);
    expect(result["1mo"]).toBe(1);
  });

  it("counts an item at exactly the 1mo (30d) boundary", () => {
    const result = bucketByWindows([itemAt(ms(30 * 24))], now);
    expect(result["2w"]).toBe(0);
    expect(result["1mo"]).toBe(1);
  });

  it("does not count an item just beyond 1mo in any window", () => {
    const result = bucketByWindows([itemAt(ms(30 * 24) + 1)], now);
    expect(result["24h"]).toBe(0);
    expect(result["48h"]).toBe(0);
    expect(result["1w"]).toBe(0);
    expect(result["2w"]).toBe(0);
    expect(result["1mo"]).toBe(0);
  });

  it("returns all zeros for an empty list", () => {
    const result = bucketByWindows([], now);
    expect(result).toEqual({ "24h": 0, "48h": 0, "1w": 0, "2w": 0, "1mo": 0 });
  });

  it("correctly accumulates multiple items across different windows", () => {
    const items = [
      itemAt(ms(1)),       // 24h → in all 5 windows
      itemAt(ms(25)),      // 48h only → in 48h, 1w, 2w, 1mo
      itemAt(ms(4 * 24)),  // 1w only → in 1w, 2w, 1mo
      itemAt(ms(10 * 24)), // 2w only → in 2w, 1mo
      itemAt(ms(20 * 24)), // 1mo only → in 1mo
    ];
    const result = bucketByWindows(items, now);
    expect(result["24h"]).toBe(1);
    expect(result["48h"]).toBe(2);
    expect(result["1w"]).toBe(3);
    expect(result["2w"]).toBe(4);
    expect(result["1mo"]).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// getPRCountForRepo — mocks fetch
// ---------------------------------------------------------------------------

describe("getPRCountForRepo", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed items from GitHub Search API response", async () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const mockItems = [
      { created_at: "2026-01-14T10:00:00.000Z" },
      { created_at: "2026-01-10T08:00:00.000Z" },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total_count: 2, items: mockItems }),
    });

    const result = await getPRCountForRepo("owner/repo", "token-abc", since);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].createdAt).toEqual(new Date("2026-01-14T10:00:00.000Z"));
    expect(result.items[1].createdAt).toEqual(new Date("2026-01-10T08:00:00.000Z"));
  });

  it("builds the correct search query URL", async () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total_count: 0, items: [] }),
    });

    await getPRCountForRepo("stakwork/hive", "my-token", since);

    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("repo%3Astakwork%2Fhive");
    expect(calledUrl).toContain("is%3Apr");
    expect(calledUrl).toContain("created%3A%3E%3D2026-01-01");
  });

  it("sends the Authorization header", async () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total_count: 0, items: [] }),
    });

    await getPRCountForRepo("owner/repo", "secret-token", since);

    const calledOptions = mockFetch.mock.calls[0][1];
    expect(calledOptions.headers["Authorization"]).toBe("token secret-token");
  });

  it("throws when the GitHub API returns a non-OK status", async () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    await expect(getPRCountForRepo("owner/repo", "bad-token", since)).rejects.toThrow(
      "GitHub API error: 403 Forbidden",
    );
  });

  it("returns empty items when response has no items field", async () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total_count: 0 }),
    });

    const result = await getPRCountForRepo("owner/repo", "token", since);
    expect(result.items).toEqual([]);
  });
});
