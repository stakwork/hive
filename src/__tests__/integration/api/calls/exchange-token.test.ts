import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/calls/exchange-token/route";

// Mock Redis to avoid real Redis connections in integration tests
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

function makeRequest(callKey?: string): NextRequest {
  const url = callKey !== undefined
    ? `http://localhost:3000/api/calls/exchange-token?callKey=${callKey}`
    : `http://localhost:3000/api/calls/exchange-token`;
  return new NextRequest(url);
}

describe("GET /api/calls/exchange-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Hit — token found in Redis", () => {
    test("returns 200 with hiveToken when callKey exists", async () => {
      const { redis } = await import("@/lib/redis");
      vi.mocked(redis.get).mockResolvedValueOnce("tok.abc.123");

      const response = await GET(makeRequest("abc123def456abc123def456") as Parameters<typeof GET>[0]);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ hiveToken: "tok.abc.123" });
    });

    test("does not call redis.del (key remains for rejoin)", async () => {
      const { redis } = await import("@/lib/redis");
      vi.mocked(redis.get).mockResolvedValueOnce("tok.abc.123");

      await GET(makeRequest("abc123def456abc123def456") as Parameters<typeof GET>[0]);

      expect(vi.mocked(redis.del)).not.toHaveBeenCalled();
    });
  });

  describe("Miss — token not found or expired", () => {
    test("returns 401 when callKey not found in Redis", async () => {
      const { redis } = await import("@/lib/redis");
      vi.mocked(redis.get).mockResolvedValueOnce(null);

      const response = await GET(makeRequest("abc123def456abc123def456") as Parameters<typeof GET>[0]);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toHaveProperty("error", "Token not found or expired");
    });
  });

  describe("Missing or blank callKey", () => {
    test("returns 400 when callKey param is absent", async () => {
      const response = await GET(makeRequest() as Parameters<typeof GET>[0]);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error", "callKey is required");
    });

    test("returns 400 when callKey param is blank (empty string)", async () => {
      const response = await GET(makeRequest("") as Parameters<typeof GET>[0]);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error", "callKey is required");
    });

    test("does not call redis.get when callKey is missing", async () => {
      const { redis } = await import("@/lib/redis");

      await GET(makeRequest() as Parameters<typeof GET>[0]);

      expect(vi.mocked(redis.get)).not.toHaveBeenCalled();
    });

    test("does not call redis.get when callKey is blank", async () => {
      const { redis } = await import("@/lib/redis");

      await GET(makeRequest("") as Parameters<typeof GET>[0]);

      expect(vi.mocked(redis.get)).not.toHaveBeenCalled();
    });
  });

  describe("Key is not deleted after exchange (repeatable)", () => {
    test("redis.del is never called on a successful exchange", async () => {
      const { redis } = await import("@/lib/redis");
      vi.mocked(redis.get).mockResolvedValue("tok.xyz.789");

      // Call exchange twice to simulate Jamie rejoining
      await GET(makeRequest("abc123def456abc123def456") as Parameters<typeof GET>[0]);
      await GET(makeRequest("abc123def456abc123def456") as Parameters<typeof GET>[0]);

      expect(vi.mocked(redis.del)).not.toHaveBeenCalled();
      expect(vi.mocked(redis.get)).toHaveBeenCalledTimes(2);
    });
  });
});
