import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { GET } from "@/app/api/pool-scaler/swarms/route";
import { POST } from "@/app/api/pool-scaler/swarms/[swarmId]/scale/route";
import {
  resetDatabase,
  createTestUser,
  createTestWorkspace,
  createTestSwarm,
} from "@/__tests__/support/fixtures";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const TOKEN = "test-api-token-pool-scaler";

function req(url: string, init: { token?: string | null; body?: unknown; method?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.token !== null) headers.set("x-api-token", init.token ?? TOKEN);
  return new NextRequest(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const scale = (swarmId: string, body: unknown, token?: string | null) =>
  POST(req(`/api/pool-scaler/swarms/${swarmId}/scale`, { method: "POST", body, token }), {
    params: Promise.resolve({ swarmId }),
  });

async function addPod(swarmId: string, usage: "USED" | "UNUSED", n: number) {
  await db.pod.create({
    data: {
      podId: `pod-${n}-${Date.now()}-${Math.random()}`,
      swarmId,
      status: "RUNNING",
      usageStatus: usage,
      usageStatusMarkedAt: new Date(),
      password: "x",
      portMappings: [3000],
    },
  });
}

describe("pool-scaler API", () => {
  const saved: Record<string, string | undefined> = {};
  let swarmId: string;

  beforeEach(async () => {
    for (const k of ["API_TOKEN", "TOKEN_ENCRYPTION_KEY", "TOKEN_ENCRYPTION_KEY_ID", "POOL_MANAGER_BASE_URL"]) {
      saved[k] = process.env[k];
    }
    process.env.API_TOKEN = TOKEN;
    process.env.TOKEN_ENCRYPTION_KEY =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    process.env.TOKEN_ENCRYPTION_KEY_ID = "k-test";
    process.env.POOL_MANAGER_BASE_URL = "https://pool-manager.example.com";

    await resetDatabase();
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => "OK" });

    const user = await createTestUser({ email: "ps@example.com" });
    const ws = await createTestWorkspace({ ownerId: user.id, slug: "ps-ws" });
    const swarm = await createTestSwarm({
      workspaceId: ws.id,
      poolApiKey: "secret-pool-key",
      minimumVms: 3,
      minimumPods: 2,
    });
    swarmId = swarm.id;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe("GET /swarms", () => {
    it("401 without token", async () => {
      expect((await GET(req("/api/pool-scaler/swarms", { token: null }))).status).toBe(401);
    });

    it("200 with API_TOKEN, no poolApiKey leaked", async () => {
      await addPod(swarmId, "USED", 1);
      const res = await GET(req("/api/pool-scaler/swarms"));
      expect(res.status).toBe(200);
      const text = JSON.stringify(await res.clone().json());
      expect(text).not.toContain("poolApiKey");
      expect(text).not.toContain("secret-pool-key");
      const { swarms } = await res.json();
      expect(swarms).toHaveLength(1);
      expect(swarms[0]).toMatchObject({
        swarmId,
        workspaceSlug: "ps-ws",
        floor: 2,
        current: 3,
        usedVms: 1,
        runningVms: 1,
      });
    });
  });

  describe("POST /swarms/[swarmId]/scale", () => {
    it("401 without token", async () => {
      expect((await scale(swarmId, { minimumVms: 5 }, null)).status).toBe(401);
    });

    it.each([0, 21, 1.5])("400 for %s", async (v) => {
      const res = await scale(swarmId, { minimumVms: v });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("1 and 20");
    });

    it("404 for unknown swarm", async () => {
      expect((await scale("nope", { minimumVms: 5 })).status).toBe(404);
    });

    it("400 below floor", async () => {
      await db.swarm.update({ where: { id: swarmId }, data: { minimumPods: 4 } });
      const res = await scale(swarmId, { minimumVms: 3 });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("floor of 4");
    });

    it("400 below usedVms", async () => {
      for (let i = 0; i < 4; i++) await addPod(swarmId, "USED", i);
      const res = await scale(swarmId, { minimumVms: 3 });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("in use");
    });

    it("200 unchanged without calling Pool Manager", async () => {
      const res = await scale(swarmId, { minimumVms: 3 });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ swarmId, previous: 3, applied: 3, changed: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("200 changed: calls Pool Manager and updates DB", async () => {
      const res = await scale(swarmId, { minimumVms: 6 });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ swarmId, previous: 3, applied: 6, changed: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toMatch(new RegExp(`/pools/${swarmId}/scale$`));
      expect(init.headers.Authorization).toBe("Bearer secret-pool-key");
      expect(JSON.parse(init.body)).toEqual({ minimum_vms: 6 });
      const row = await db.swarm.findUniqueOrThrow({ where: { id: swarmId } });
      expect(row.minimumVms).toBe(6);
      expect(row.deployedPods).toBe(6);
    });

    it("502 when Pool Manager fails", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
      const res = await scale(swarmId, { minimumVms: 6 });
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain("boom");
    });

    it("dryRun changes nothing", async () => {
      const res = await scale(swarmId, { minimumVms: 6, dryRun: true });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        swarmId, previous: 3, applied: 6, changed: false, dryRun: true,
      });
      expect(mockFetch).not.toHaveBeenCalled();
      const row = await db.swarm.findUniqueOrThrow({ where: { id: swarmId } });
      expect(row.minimumVms).toBe(3);
    });
  });
});
