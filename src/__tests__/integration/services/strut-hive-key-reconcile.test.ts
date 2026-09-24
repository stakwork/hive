import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { generateUniqueId } from "@/__tests__/support/helpers";
import { createTestUser, createTestSwarm } from "@/__tests__/support/factories";
import { createOrgApiKey } from "@/lib/org-api-keys";
import { runStrutHiveKeyReconcile } from "@/services/strut-hive-key";

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      encryptField: (_field: string, value: string) => ({ encrypted: value }),
      decryptField: () => "mock-swarm-api-key",
    }),
  },
}));

// No redis in the integration env; the lock just runs its body.
vi.mock("@/lib/locks/redis-lock", () => ({
  withLock: (_key: string, fn: () => Promise<unknown>) => fn(),
}));

const HIVE_URL = "https://hive.example.com";
let installationIdCounter = 950000;

/** Strut answers `GET /secrets` with `names`, 200s every PUT. */
function stubStrut(names: string[] | "unsupported") {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      if (names === "unsupported") return new Response("not found", { status: 404 });
      return Response.json({ secrets: names.map((name) => ({ name })) });
    }
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    puts: () =>
      (fetchMock.mock.calls as Array<[string, RequestInit]>)
        .filter(([, init]) => init.method === "PUT")
        .map(([url, init]) => ({ url, value: JSON.parse(init.body as string).value as string })),
  };
}

/** An embedded strut: org workspace + swarm pointing at a live managed key. */
async function seedEmbedded(opts: { withOrg?: boolean } = {}) {
  const owner = await createTestUser({ email: `hk-${generateUniqueId()}@example.com`, idempotent: false });
  const login = `hk-org-${generateUniqueId()}`;
  const org = await db.sourceControlOrg.create({
    data: { githubLogin: login, githubInstallationId: installationIdCounter++, type: "ORG", name: login },
  });
  const slug = `hk-ws-${generateUniqueId()}`;
  const ws = await db.workspace.create({
    data: { name: slug, slug, ownerId: owner.id, sourceControlOrgId: opts.withOrg === false ? null : org.id },
  });
  const swarm = await createTestSwarm({
    workspaceId: ws.id,
    swarmUrl: "https://hk.swarm.test/api",
    swarmApiKey: "k",
  });
  const key = await createOrgApiKey({ orgId: org.id, name: "strut (managed)", createdById: owner.id });
  await db.swarm.update({ where: { id: swarm.id }, data: { strutHiveKeyId: key.id } });
  return { owner, org, ws, swarm, key };
}

describe("runStrutHiveKeyReconcile", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves a strut that holds both secrets and a live key alone", async () => {
    const { swarm, key } = await seedEmbedded();
    const strut = stubStrut(["HIVE_API_KEY", "HIVE_URL", "OPENAI_API_KEY"]);

    const result = await runStrutHiveKeyReconcile({ publicBaseUrl: HIVE_URL });

    expect(result).toMatchObject({ success: true, swarmsProcessed: 1, rotated: 0 });
    expect(strut.puts()).toHaveLength(0);
    expect((await db.swarm.findUniqueOrThrow({ where: { id: swarm.id } })).strutHiveKeyId).toBe(key.id);
  });

  it("rotates when strut lost HIVE_API_KEY: new key pushed, pointer moved, old key revoked", async () => {
    const { swarm, key, org, owner } = await seedEmbedded();
    const strut = stubStrut([]);

    const result = await runStrutHiveKeyReconcile({ publicBaseUrl: HIVE_URL });

    expect(result).toMatchObject({ success: true, rotated: 1 });
    const puts = strut.puts();
    expect(puts.map((p) => p.url)).toEqual([
      "https://hk.swarm.test:3355/lab/secrets/HIVE_API_KEY",
      "https://hk.swarm.test:3355/lab/secrets/HIVE_URL",
    ]);
    expect(puts[0].value).toMatch(/^hiveorg_/);
    expect(puts[1].value).toBe(HIVE_URL);

    const newId = (await db.swarm.findUniqueOrThrow({ where: { id: swarm.id } })).strutHiveKeyId!;
    expect(newId).not.toBe(key.id);
    const newKey = await db.orgApiKey.findUniqueOrThrow({ where: { id: newId } });
    expect(newKey).toMatchObject({ sourceControlOrgId: org.id, createdById: owner.id, revokedAt: null });
    expect((await db.orgApiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt).not.toBeNull();
  });

  it("rotates when the key on record was revoked, even though strut still lists the name", async () => {
    const { swarm, key } = await seedEmbedded();
    await db.orgApiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    const strut = stubStrut(["HIVE_API_KEY", "HIVE_URL"]);

    const result = await runStrutHiveKeyReconcile({ publicBaseUrl: HIVE_URL });

    expect(result.rotated).toBe(1);
    expect(strut.puts()).toHaveLength(2);
    expect((await db.swarm.findUniqueOrThrow({ where: { id: swarm.id } })).strutHiveKeyId).not.toBe(key.id);
  });

  it("re-pushes only a missing HIVE_URL", async () => {
    await seedEmbedded();
    const strut = stubStrut(["HIVE_API_KEY"]);

    const result = await runStrutHiveKeyReconcile({ publicBaseUrl: HIVE_URL });

    expect(result.rotated).toBe(0);
    expect(strut.puts()).toEqual([{ url: "https://hk.swarm.test:3355/lab/secrets/HIVE_URL", value: HIVE_URL }]);
  });

  it("retires the key when the workspace no longer belongs to an org", async () => {
    const { swarm, key } = await seedEmbedded({ withOrg: false });
    const strut = stubStrut([]);

    const result = await runStrutHiveKeyReconcile({ publicBaseUrl: HIVE_URL });

    expect(result.revoked).toBe(1);
    expect(strut.puts()).toHaveLength(0);
    expect((await db.swarm.findUniqueOrThrow({ where: { id: swarm.id } })).strutHiveKeyId).toBeNull();
    expect((await db.orgApiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt).not.toBeNull();
  });

  it("skips a lab without deployment-secret routes", async () => {
    const { swarm, key } = await seedEmbedded();
    stubStrut("unsupported");

    const result = await runStrutHiveKeyReconcile({ publicBaseUrl: HIVE_URL });

    expect(result).toMatchObject({ swarmsProcessed: 0, swarmsSkipped: 1, rotated: 0 });
    expect((await db.swarm.findUniqueOrThrow({ where: { id: swarm.id } })).strutHiveKeyId).toBe(key.id);
  });

  it("ignores swarms that were never embedded", async () => {
    const owner = await createTestUser({ email: `hk-none-${generateUniqueId()}@example.com`, idempotent: false });
    const slug = `hk-none-${generateUniqueId()}`;
    const ws = await db.workspace.create({ data: { name: slug, slug, ownerId: owner.id } });
    await createTestSwarm({ workspaceId: ws.id, swarmUrl: "https://none.swarm.test/api", swarmApiKey: "k" });
    const strut = stubStrut([]);

    const result = await runStrutHiveKeyReconcile({ publicBaseUrl: HIVE_URL });

    expect(result).toMatchObject({ swarmsProcessed: 0, swarmsSkipped: 0, rotated: 0 });
    expect(strut.puts()).toHaveLength(0);
  });
});
