import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPutRequest,
  createGetRequest,
  createPutRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { GET, PUT } from "@/app/api/orgs/[githubLogin]/schematic/route";
import type { NextResponse } from "next/server";

async function expectJson<T = unknown>(res: NextResponse | Response, status = 200): Promise<T> {
  const r = res as Response;
  expect(r.status).toBe(status);
  return r.json() as Promise<T>;
}

let installationIdCounter = 900000;
function nextInstallationId() {
  return installationIdCounter++;
}

async function createOrg(githubLogin: string) {
  return db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: nextInstallationId(),
      type: "ORG",
      name: githubLogin,
    },
  });
}

function makeParams(githubLogin: string) {
  return Promise.resolve({ githubLogin });
}

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdOrgIds.length > 0) {
    await db.sourceControlOrg.deleteMany({ where: { id: { in: createdOrgIds } } });
    createdOrgIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

// ─── GET /api/orgs/[githubLogin]/schematic ────────────────────────────────────

describe("GET /api/orgs/[githubLogin]/schematic", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const req = createGetRequest(`/api/orgs/${githubLogin}/schematic`);
    const res = await GET(req, { params: makeParams(githubLogin) });
    await expectJson(res, 401);
  });

  it("returns { schematic: null } for org with no schematic", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const user = await createTestUser({
      email: `schematic-get-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(user.id);

    const req = createAuthenticatedGetRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: user.id, email: user.email!, name: user.name! }
    );
    const res = await GET(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ schematic: null }>(res, 200);
    expect(data.schematic).toBeNull();
  });

  it("returns saved schematic after update", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const mermaidBody = "graph TD\n  A --> B";
    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { schematic: mermaidBody },
    });

    const user = await createTestUser({
      email: `schematic-get2-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(user.id);

    const req = createAuthenticatedGetRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: user.id, email: user.email!, name: user.name! }
    );
    const res = await GET(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ schematic: string }>(res, 200);
    expect(data.schematic).toBe(mermaidBody);
  });
});

// ─── PUT /api/orgs/[githubLogin]/schematic ────────────────────────────────────

describe("PUT /api/orgs/[githubLogin]/schematic", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const req = createPutRequest(`/api/orgs/${githubLogin}/schematic`, {
      schematic: "graph TD\n  A --> B",
    });
    const res = await PUT(req, { params: makeParams(githubLogin) });
    await expectJson(res, 401);
  });

  it("persists value and returns it", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const user = await createTestUser({
      email: `schematic-put-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(user.id);

    const mermaidBody = "graph LR\n  X --> Y\n  Y --> Z";

    const req = createAuthenticatedPutRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: user.id, email: user.email!, name: user.name! },
      { schematic: mermaidBody }
    );
    const res = await PUT(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ schematic: string }>(res, 200);
    expect(data.schematic).toBe(mermaidBody);

    // Verify it was persisted in the DB
    const updated = await db.sourceControlOrg.findUnique({ where: { id: org.id } });
    expect(updated?.schematic).toBe(mermaidBody);
  });

  it("returns 400 when schematic is missing from body", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const user = await createTestUser({
      email: `schematic-put2-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(user.id);

    const req = createAuthenticatedPutRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: user.id, email: user.email!, name: user.name! },
      {} // missing schematic
    );
    const res = await PUT(req, { params: makeParams(githubLogin) });
    await expectJson(res, 400);
  });
});
