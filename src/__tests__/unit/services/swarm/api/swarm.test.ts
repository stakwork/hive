import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  swarmApiRequest,
  fetchSwarmDetails,
} from "@/services/swarm/api/swarm";

// Mock env module to avoid hard errors from required env in test context
vi.mock("@/lib/env", () => ({
  env: {
    STAKWORK_API_KEY: "x",
    POOL_MANAGER_API_KEY: "y",
    POOL_MANAGER_API_USERNAME: "u",
    POOL_MANAGER_API_PASSWORD: "p",
    SWARM_SUPERADMIN_API_KEY: "s",
    SWARM_SUPER_ADMIN_URL: "https://admin",
    STAKWORK_CUSTOMERS_EMAIL: "e",
    STAKWORK_CUSTOMERS_PASSWORD: "pw",
  },
}));

declare global {
  // eslint-disable-next-line no-var
  var fetch: typeof fetch;
  // eslint-disable-next-line no-var
  var process: NodeJS.Process;
}

describe("swarm api helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("swarmApiRequest", () => {
    it("concatenates URL segments correctly and returns JSON data when available", async () => {
      const responseJson = { status: "success", request_id: "abc" };
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(responseJson),
      } as unknown as Response);

      const res = await swarmApiRequest({
        swarmUrl: "https://host/",
        endpoint: "/ingest_async",
        method: "POST",
        apiKey: "key",
        data: { x: 1 },
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ status: "success", request_id: "abc" });
      // header and body assertions
      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ x: 1 }));
    });

    it("tolerates non-JSON responses and sets data undefined", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error("not json")),
      } as unknown as Response);

      const res = await swarmApiRequest({
        swarmUrl: "https://host",
        endpoint: "ingest_async",
        apiKey: "key",
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(500);
      expect(res.data).toBeUndefined();
    });
  });

  describe("fetchSwarmDetails", () => {
    it("returns ok:true when remote responds ok", async () => {
      // set required env used internally
      (process.env as any).SWARM_SUPER_ADMIN_URL = "https://admin";
      (process.env as any).SWARM_SUPERADMIN_API_KEY = "k";

      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 1 }),
      } as unknown as Response);

      const res = await fetchSwarmDetails("id-1");
      expect(res).toEqual({ ok: true, data: { id: 1 }, status: 200 });
    });

    it("retries and returns lastError when failures occur", async () => {
      (process.env as any).SWARM_SUPER_ADMIN_URL = "https://admin";
      (process.env as any).SWARM_SUPERADMIN_API_KEY = "k";

      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({ error: "down" }),
      } as unknown as Response);

      const promise = fetchSwarmDetails("id-2");
      // fast-forward the backoff timers across 5 attempts
      await vi.advanceTimersByTimeAsync(500 + 1000 + 2000 + 4000 + 8000);
      const res = await promise;

      expect(res.ok).toBe(false);
      expect(res.status).toBe(503);
      expect((global.fetch as unknown as any).mock.calls.length).toBeGreaterThanOrEqual(5);
    });
  });
});


