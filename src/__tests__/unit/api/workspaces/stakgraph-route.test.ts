import { NextRequest } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  classify: vi.fn(),
  session: vi.fn(),
  superAdmin: vi.fn(),
  getWorkspaceBySlug: vi.fn(),
  sync: vi.fn(),
  hasInfra: vi.fn(),
  saveSwarm: vi.fn(),
  db: {
    workspace: { findFirst: vi.fn() },
    swarm: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    repository: { findMany: vi.fn() },
    environmentVariable: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    pod: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/auth/caller-token", () => ({ classifyCallerToken: h.classify }));
vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: h.session }));
vi.mock("@/lib/middleware/utils", () => ({
  checkIsSuperAdmin: h.superAdmin,
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));
vi.mock("@/services/workspace", () => ({ getWorkspaceBySlug: h.getWorkspaceBySlug }));
vi.mock("@/services/pool-manager/sync", () => ({ syncPoolManagerSettings: h.sync }));
vi.mock("@/utils/swarmInfraChanges", () => ({ hasInfrastructureChange: h.hasInfra }));
vi.mock("@/utils/stakgraphSync", () => ({
  syncPM2AndServices: vi.fn((_s, _c, services, files) => ({ services: services ?? [], containerFiles: files ?? {} })),
  extractRepoName: vi.fn().mockReturnValue("repo"),
}));
vi.mock("@/services/swarm/db", async (orig) => ({
  ...(await orig<typeof import("@/services/swarm/db")>()),
  saveOrUpdateSwarm: h.saveSwarm,
}));
vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn().mockResolvedValue("enc-pool-key"),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));
vi.mock("@/services/github/WebhookService", () => ({
  WebhookService: vi.fn().mockImplementation(() => ({
    setupRepositoryWithWebhook: vi.fn().mockResolvedValue({ defaultBranch: "main" }),
    deleteRepoWebhook: vi.fn(),
  })),
}));
vi.mock("@/config/services", () => ({ getServiceConfig: vi.fn() }));
vi.mock("@/lib/url", () => ({ getGithubWebhookCallbackUrl: vi.fn().mockReturnValue("http://cb") }));
vi.mock("@/lib/encryption", () => ({
  decryptEnvVars: (v: unknown) => v,
  encryptEnvVars: (v: unknown) => v,
  EncryptionService: { getInstance: () => ({ decryptField: (_f: string, v: string) => v }) },
}));

import { GET, PUT } from "@/app/api/workspaces/[slug]/stakgraph/route";
import { maskEnvValue } from "@/lib/env-mask";

const params = { params: Promise.resolve({ slug: "ws" }) };
const url = "http://localhost/api/workspaces/ws/stakgraph";
const req = (method: string, headers: Record<string, string> = {}, body?: object) =>
  new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const swarmRow = (over: Record<string, unknown> = {}) => ({
  id: "sw1",
  name: "n",
  swarmUrl: "http://s",
  status: "ACTIVE",
  updatedAt: new Date(),
  poolName: "sw1",
  poolCpu: "2",
  poolMemory: "8Gi",
  minimumVms: 2,
  services: [{ name: "web", port: 3000, scripts: { start: "x" } }],
  containerFiles: null,
  environmentVariables: [{ name: "API_KEY", value: "supersecret" }],
  poolChangeId: null,
  poolChangeRequestedAt: null,
  poolPushedAt: null,
  poolPushError: null,
  ...over,
});

const orgKey = { "x-api-token": "hiveorg_abc" };
const orgClassified = { kind: "org", orgId: "org1", apiKeyId: "key1", validated: { orgId: "org1", apiKey: { id: "key1", createdById: "u9" } } };

beforeEach(() => {
  vi.clearAllMocks();
  h.classify.mockResolvedValue(null);
  h.session.mockResolvedValue(null);
  h.superAdmin.mockResolvedValue(false);
  h.hasInfra.mockReturnValue(true);
  h.sync.mockResolvedValue({ success: true });
  h.db.workspace.findFirst.mockResolvedValue({ id: "w1", sourceControlOrgId: "org1" });
  h.db.swarm.findUnique.mockResolvedValue(swarmRow());
  h.db.swarm.update.mockResolvedValue({});
  h.db.swarm.updateMany.mockResolvedValue({ count: 1 });
  h.db.repository.findMany.mockResolvedValue([]);
  h.db.environmentVariable.findMany.mockResolvedValue([]);
  h.db.pod.findMany.mockResolvedValue([]);
});

describe("GET stakgraph", () => {
  it("org key in-org -> 200 with masked env and rollout block", async () => {
    h.classify.mockResolvedValue(orgClassified);
    h.db.environmentVariable.findMany.mockResolvedValueOnce([
      { serviceName: "web", name: "TOKEN", value: JSON.stringify("webtoken1") },
    ]);
    const res = await GET(req("GET", orgKey), params);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.environmentVariables).toEqual([{ name: "API_KEY", value: maskEnvValue("supersecret") }]);
    expect(data.services[0].env).toEqual({ TOKEN: maskEnvValue("webtoken1") });
    expect(data.containerFiles).toEqual({});
    expect(data.rollout.state).toBe("idle");
  });

  it("org key for another org -> 403", async () => {
    h.classify.mockResolvedValue({ ...orgClassified, orgId: "other", validated: { ...orgClassified.validated, orgId: "other" } });
    expect((await GET(req("GET", orgKey), params)).status).toBe(403);
  });

  it("invalid/revoked hiveorg key -> 401", async () => {
    expect((await GET(req("GET", orgKey), params)).status).toBe(401);
  });

  it("global API token -> 200, masked", async () => {
    h.classify.mockResolvedValue({ kind: "system" });
    const res = await GET(req("GET", { "x-api-token": "sys" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).data.environmentVariables[0].value).toBe(maskEnvValue("supersecret"));
  });

  it("session sees full values", async () => {
    h.session.mockResolvedValue({ user: { id: "u1" } });
    h.getWorkspaceBySlug.mockResolvedValue({ id: "w1", userRole: "VIEWER" });
    const res = await GET(req("GET"), params);
    expect((await res.json()).data.environmentVariables).toEqual([{ name: "API_KEY", value: "supersecret" }]);
  });

  it("reports failed/push_timeout for a stale push", async () => {
    h.session.mockResolvedValue({ user: { id: "u1" } });
    h.getWorkspaceBySlug.mockResolvedValue({ id: "w1", userRole: "OWNER" });
    h.db.swarm.findUnique.mockResolvedValue(
      swarmRow({ poolChangeId: "c1", poolChangeRequestedAt: new Date(Date.now() - 10 * 60_000) }),
    );
    const { data } = await (await GET(req("GET"), params)).json();
    expect(data.rollout).toMatchObject({ state: "failed", error: "push_timeout", changeId: "c1" });
  });
});

describe("PUT stakgraph", () => {
  const body = { poolCpu: "4" };

  it("org key in-org pushes before responding, records the push and returns changeId", async () => {
    h.classify.mockResolvedValue(orgClassified);

    const res = await PUT(req("PUT", orgKey, body), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.changeId).toEqual(expect.any(String));
    expect(json.infraChanged).toBe(true);
    expect(json.rollout).toEqual({ state: "rolling", error: null });
    expect(h.sync).toHaveBeenCalledTimes(1);
    expect(h.db.swarm.update).toHaveBeenCalledWith({
      where: { id: "sw1" },
      data: expect.objectContaining({ poolChangeId: json.changeId, poolPushedAt: null, poolPushError: null }),
    });
    expect(h.db.swarm.updateMany).toHaveBeenCalledWith({
      where: { id: "sw1", poolChangeId: json.changeId },
      data: { poolPushedAt: expect.any(Date) },
    });
    // The change is recorded, then pushed, then the push result is recorded.
    expect(h.db.swarm.update.mock.invocationCallOrder[0]).toBeLessThan(h.sync.mock.invocationCallOrder[0]);
    expect(h.sync.mock.invocationCallOrder[0]).toBeLessThan(h.db.swarm.updateMany.mock.invocationCallOrder[0]);
  });

  it("reports and stores the push error when the push fails (result or throw)", async () => {
    h.classify.mockResolvedValue({ kind: "system" });
    h.sync.mockResolvedValueOnce({ success: false, error: "pm down" });
    const res = await PUT(req("PUT", { "x-api-token": "sys" }, body), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rollout).toEqual({ state: "failed", error: "pm down" });
    expect(h.db.swarm.updateMany).toHaveBeenLastCalledWith({
      where: { id: "sw1", poolChangeId: json.changeId },
      data: { poolPushError: "pm down" },
    });

    h.sync.mockRejectedValueOnce(new Error("kaboom"));
    const json2 = await (await PUT(req("PUT", { "x-api-token": "sys" }, body), params)).json();
    expect(json2.rollout).toEqual({ state: "failed", error: "kaboom" });
    expect(h.db.swarm.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { poolPushError: "kaboom" } }),
    );
  });

  it("no infra change -> no push, idle", async () => {
    h.classify.mockResolvedValue({ kind: "system" });
    h.hasInfra.mockReturnValue(false);
    const json = await (await PUT(req("PUT", { "x-api-token": "sys" }, { description: "d" }), params)).json();
    expect(json).toMatchObject({ changeId: null, infraChanged: false, rollout: { state: "idle" } });
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("org key for another org -> 403; invalid key -> 401", async () => {
    h.classify.mockResolvedValue({ ...orgClassified, orgId: "other", validated: { ...orgClassified.validated, orgId: "other" } });
    expect((await PUT(req("PUT", orgKey, body), params)).status).toBe(403);
    h.classify.mockResolvedValue(null);
    expect((await PUT(req("PUT", orgKey, body), params)).status).toBe(401);
    expect(h.saveSwarm).not.toHaveBeenCalled();
  });

  it("session VIEWER -> 403", async () => {
    h.session.mockResolvedValue({ user: { id: "u1" } });
    h.getWorkspaceBySlug.mockResolvedValue({ id: "w1", userRole: "VIEWER" });
    const res = await PUT(req("PUT", {}, body), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("FORBIDDEN");
  });

  it("token caller: masked env values are restored from storage before saving", async () => {
    h.classify.mockResolvedValue(orgClassified);
    h.db.environmentVariable.findMany.mockImplementation(async ({ where }: { where: { serviceName: unknown } }) =>
      where.serviceName === ""
        ? []
        : [{ serviceName: "web", name: "TOKEN", value: JSON.stringify("webtoken1") }],
    );
    await PUT(
      req("PUT", orgKey, {
        environmentVariables: [
          { name: "API_KEY", value: maskEnvValue("supersecret") },
          { name: "NEW", value: "brandnew" },
        ],
        services: [
          { name: "web", port: 3000, scripts: { start: "x" }, env: { TOKEN: maskEnvValue("webtoken1") } },
        ],
      }),
      params,
    );
    const saved = h.saveSwarm.mock.calls[0][0];
    expect(saved.environmentVariables).toEqual([
      { name: "API_KEY", value: "supersecret" },
      { name: "NEW", value: "brandnew" },
    ]);
    expect(saved.services[0].env).toEqual({ TOKEN: "webtoken1" });
    expect(h.db.environmentVariable.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ name: "TOKEN", serviceName: "web" })]),
    });
  });

  it("token caller: service env stored only in the services JSON (no table rows) is restored too", async () => {
    h.classify.mockResolvedValue(orgClassified);
    h.db.swarm.findUnique.mockResolvedValue(
      swarmRow({ services: [{ name: "web", port: 3000, scripts: { start: "x" }, env: { TOKEN: "jsontoken1" } }] }),
    );
    await PUT(
      req("PUT", orgKey, {
        services: [{ name: "web", port: 3000, scripts: { start: "x" }, env: { TOKEN: maskEnvValue("jsontoken1") } }],
      }),
      params,
    );
    expect(h.saveSwarm.mock.calls[0][0].services[0].env).toEqual({ TOKEN: "jsontoken1" });
  });

  it("token caller: a service sent without env keeps its stored env", async () => {
    h.classify.mockResolvedValue(orgClassified);
    h.db.environmentVariable.findMany.mockImplementation(async ({ where }: { where: { serviceName: unknown } }) =>
      where.serviceName === "" ? [] : [{ serviceName: "web", name: "TOKEN", value: JSON.stringify("webtoken1") }],
    );
    await PUT(req("PUT", orgKey, { services: [{ name: "web", port: 3001, scripts: { start: "x" } }] }), params);
    expect(h.saveSwarm.mock.calls[0][0].services[0]).toMatchObject({ port: 3001, env: { TOKEN: "webtoken1" } });
    expect(h.db.environmentVariable.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ name: "TOKEN", serviceName: "web" })]),
    });
  });

  it("audit log for org writes includes actor org-key + apiKeyId, never values", async () => {
    h.classify.mockResolvedValue(orgClassified);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await PUT(req("PUT", orgKey, { environmentVariables: [{ name: "A", value: "topsecret" }] }), params);
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("api_token_write"))!;
    log.mockRestore();
    expect(JSON.parse(line)).toMatchObject({ actor: "org-key", apiKeyId: "key1" });
    expect(line).not.toContain("topsecret");
  });
});
