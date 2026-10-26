import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/calls/exchange-token/route";

// Mock Redis to avoid real Redis connections in integration tests
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

const VOICE_KEY = "test-voice-agent-key";
const CALL_KEY = "abc123def456abc123def456";

function makeRequest(
  body: Record<string, unknown> | undefined,
  authorization: string | null = `Bearer ${VOICE_KEY}`,
): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization !== null) headers.Authorization = authorization;
  return new NextRequest("http://localhost:3000/api/calls/exchange-token", {
    method: "POST",
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("POST /api/calls/exchange-token", () => {
  const originalKey = process.env.VOICE_AGENT_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOICE_AGENT_API_KEY = VOICE_KEY;
  });

  afterEach(() => {
    if (originalKey) process.env.VOICE_AGENT_API_KEY = originalKey;
    else delete process.env.VOICE_AGENT_API_KEY;
  });

  describe("Hit — token found in Redis", () => {
    test("returns 200 with hiveToken when the agent's key and a known callKey are sent", async () => {
      const { redis } = await import("@/lib/redis");
      vi.mocked(redis.get).mockResolvedValueOnce("tok.abc.123");

      const response = await POST(makeRequest({ callKey: CALL_KEY }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ hiveToken: "tok.abc.123" });
      expect(vi.mocked(redis.get)).toHaveBeenCalledWith(`call-token:${CALL_KEY}`);
    });

    test("does not call redis.del (key remains for rejoin)", async () => {
      const { redis } = await import("@/lib/redis");
      vi.mocked(redis.get).mockResolvedValue("tok.xyz.789");

      // Exchange twice to simulate Jamie rejoining
      await POST(makeRequest({ callKey: CALL_KEY }));
      await POST(makeRequest({ callKey: CALL_KEY }));

      expect(vi.mocked(redis.del)).not.toHaveBeenCalled();
      expect(vi.mocked(redis.get)).toHaveBeenCalledTimes(2);
    });
  });

  describe("A callKey alone is worth nothing", () => {
    test("returns 401 without the agent's key", async () => {
      const { redis } = await import("@/lib/redis");
      vi.mocked(redis.get).mockResolvedValue("tok.abc.123");

      const response = await POST(makeRequest({ callKey: CALL_KEY }, null));

      expect(response.status).toBe(401);
      expect(vi.mocked(redis.get)).not.toHaveBeenCalled();
    });

    test("returns 401 with a wrong key", async () => {
      const response = await POST(makeRequest({ callKey: CALL_KEY }, "Bearer not-the-key"));
      expect(response.status).toBe(401);
    });

    test("returns 401 with the key in a non-Bearer header", async () => {
      const response = await POST(makeRequest({ callKey: CALL_KEY }, VOICE_KEY));
      expect(response.status).toBe(401);
    });

    test("returns 503 and reads nothing when the key is not configured", async () => {
      delete process.env.VOICE_AGENT_API_KEY;
      const { redis } = await import("@/lib/redis");

      const response = await POST(makeRequest({ callKey: CALL_KEY }));

      expect(response.status).toBe(503);
      expect(vi.mocked(redis.get)).not.toHaveBeenCalled();
    });
  });

  describe("Miss — token not found or expired", () => {
    test("returns 401 when callKey not found in Redis", async () => {
      const { redis } = await import("@/lib/redis");
      vi.mocked(redis.get).mockResolvedValueOnce(null);

      const response = await POST(makeRequest({ callKey: CALL_KEY }));

      expect(response.status).toBe(401);
      expect(await response.json()).toHaveProperty("error", "Token not found or expired");
    });
  });

  describe("Missing or blank callKey", () => {
    test("returns 400 when callKey is absent", async () => {
      const { redis } = await import("@/lib/redis");
      const response = await POST(makeRequest({}));

      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty("error", "callKey is required");
      expect(vi.mocked(redis.get)).not.toHaveBeenCalled();
    });

    test("returns 400 when callKey is blank", async () => {
      const response = await POST(makeRequest({ callKey: "  " }));
      expect(response.status).toBe(400);
    });

    test("returns 400 when the body is not JSON", async () => {
      const response = await POST(makeRequest(undefined));
      expect(response.status).toBe(400);
    });
  });
});
