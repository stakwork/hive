import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, PUT } from "@/app/api/workspaces/[slug]/janitors/config/route";
import { db } from "@/lib/db";
import { createOrgApiKey } from "@/lib/org-api-keys";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  generateUniqueId,
  expectSuccess,
  createRequestWithHeaders,
} from "@/__tests__/support/helpers";

const SYSTEM_TOKEN = "test-api-token-janitor-config";
let installationId = 940000;

async function createOrg() {
  const githubLogin = `jan-org-${generateUniqueId()}`;
  return db.sourceControlOrg.create({
    data: { githubLogin, githubInstallationId: installationId++, type: "ORG", name: githubLogin },
  });
}

async function createOrgWorkspace(orgId: string) {
  const scenario = await createTestWorkspaceScenario({});
  await db.workspace.update({ where: { id: scenario.workspace.id }, data: { sourceControlOrgId: orgId } });
  return scenario;
}

const url = (slug: string) => `http://localhost:3000/api/workspaces/${slug}/janitors/config`;
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const get = (slug: string, token?: string) =>
  GET(createRequestWithHeaders(url(slug), "GET", token ? { "x-api-token": token } : {}), ctx(slug));
const put = (slug: string, body: object, token?: string) =>
  PUT(
    createRequestWithHeaders(url(slug), "PUT", { "Content-Type": "application/json", ...(token ? { "x-api-token": token } : {}) }, body),
    ctx(slug),
  );
const lingo = async (workspaceId: string) =>
  (await db.janitorConfig.findUnique({ where: { workspaceId } }))?.lingoExtractionEnabled;

describe("janitors config route — org API key", () => {
  beforeEach(() => {
    process.env.API_TOKEN = SYSTEM_TOKEN;
    getMockedSession().mockResolvedValue(mockUnauthenticatedSession() as any);
  });
  afterEach(() => vi.restoreAllMocks());

  test("org key: GET, PUT persists, GET reflects", async () => {
    const org = await createOrg();
    const { owner, workspace } = await createOrgWorkspace(org.id);
    const { key } = await createOrgApiKey({ orgId: org.id, name: "wf", createdById: owner.id });

    const got = await expectSuccess(await get(workspace.slug, key));
    expect(got.config.workspaceId).toBe(workspace.id);
    expect(got.config.lingoExtractionEnabled).toBe(false);

    const res = await put(workspace.slug, { lingoExtractionEnabled: true }, key);
    const updated = await expectSuccess(res);
    expect(updated.config.lingoExtractionEnabled).toBe(true);
    expect(await lingo(workspace.id)).toBe(true);

    const again = await expectSuccess(await get(workspace.slug, key));
    expect(again.config.lingoExtractionEnabled).toBe(true);
  });

  test("legalBenchmarkRecursionEnabled is stripped on token path for non-openlaw", async () => {
    const org = await createOrg();
    const { owner, workspace } = await createOrgWorkspace(org.id);
    const { key } = await createOrgApiKey({ orgId: org.id, name: "wf", createdById: owner.id });
    await expectSuccess(await put(workspace.slug, { legalBenchmarkRecursionEnabled: true }, key));
    const row = await db.janitorConfig.findUnique({ where: { workspaceId: workspace.id } });
    expect(row?.legalBenchmarkRecursionEnabled).toBe(false);
  });

  test("org key for another org's workspace → 403, config unchanged", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const a = await createOrgWorkspace(orgA.id);
    const b = await createOrgWorkspace(orgB.id);
    const { key } = await createOrgApiKey({ orgId: orgA.id, name: "wf", createdById: a.owner.id });

    expect((await get(b.workspace.slug, key)).status).toBe(403);
    expect((await put(b.workspace.slug, { lingoExtractionEnabled: true }, key)).status).toBe(403);
    expect(await lingo(b.workspace.id)).not.toBe(true);
  });

  test("bogus and revoked keys → 401", async () => {
    const org = await createOrg();
    const { owner, workspace } = await createOrgWorkspace(org.id);
    expect((await get(workspace.slug, "hiveorg_bogus0000000000000000000000000")).status).toBe(401);
    expect((await put(workspace.slug, { lingoExtractionEnabled: true }, "hiveorg_bogus")).status).toBe(401);

    const { key, id: apiKeyId } = await createOrgApiKey({ orgId: org.id, name: "wf", createdById: owner.id });
    await db.orgApiKey.update({ where: { id: apiKeyId }, data: { revokedAt: new Date() } });
    expect((await get(workspace.slug, key)).status).toBe(401);
    expect((await put(workspace.slug, { lingoExtractionEnabled: true }, key)).status).toBe(401);
  });

  test("no token and no session → 401", async () => {
    const org = await createOrg();
    const { workspace } = await createOrgWorkspace(org.id);
    expect((await get(workspace.slug)).status).toBe(401);
    expect((await put(workspace.slug, { lingoExtractionEnabled: true })).status).toBe(401);
  });

  test("global API_TOKEN → 403 Org API key required", async () => {
    const org = await createOrg();
    const { workspace } = await createOrgWorkspace(org.id);
    for (const res of [await get(workspace.slug, SYSTEM_TOKEN), await put(workspace.slug, { lingoExtractionEnabled: true }, SYSTEM_TOKEN)]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Org API key required" });
    }
    expect(await lingo(workspace.id)).not.toBe(true);
  });

  test("invalid body on token PUT → 400", async () => {
    const org = await createOrg();
    const { owner, workspace } = await createOrgWorkspace(org.id);
    const { key } = await createOrgApiKey({ orgId: org.id, name: "wf", createdById: owner.id });
    const res = await put(workspace.slug, { lingoExtractionEnabled: "yes" }, key);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  test("session user PUT with lingoExtractionEnabled → 200", async () => {
    const { owner, workspace } = await createOrgWorkspace((await createOrg()).id);
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner) as any);
    await expectSuccess(await put(workspace.slug, { lingoExtractionEnabled: true }));
    expect(await lingo(workspace.id)).toBe(true);
    const got = await expectSuccess(await get(workspace.slug));
    expect(got.config.lingoExtractionEnabled).toBe(true);
  });

  test("token PUT emits audit log without the token", async () => {
    const org = await createOrg();
    const { owner, workspace } = await createOrgWorkspace(org.id);
    const { key, id: apiKeyId } = await createOrgApiKey({ orgId: org.id, name: "wf", createdById: owner.id });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expectSuccess(await put(workspace.slug, { lingoExtractionEnabled: true }, key));
    const lines = spy.mock.calls.map((c) => String(c[0]));
    const audit = lines.find((l) => l.includes("api_token_write"));
    expect(audit).toBeDefined();
    expect(JSON.parse(audit!)).toEqual({
      event: "api_token_write",
      endpoint: "PUT /api/workspaces/[slug]/janitors/config",
      actor: "org-key",
      apiKeyId,
      orgId: org.id,
      workspaceSlug: workspace.slug,
      changedFields: ["lingoExtractionEnabled"],
    });
    expect(lines.join("\n")).not.toContain(key);
  });
});
