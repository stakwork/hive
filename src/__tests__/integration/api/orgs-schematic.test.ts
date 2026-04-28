import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPutRequest,
  createGetRequest,
  createPutRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { GET, PUT } from "@/app/api/orgs/[githubLogin]/schematic/route";
import { WorkspaceRole } from "@prisma/client";
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

async function createWorkspaceInOrg(ownerId: string, orgId: string) {
  const slug = `schematic-test-ws-${generateUniqueId()}`;
  return db.workspace.create({
    data: { name: slug, slug, ownerId, sourceControlOrgId: orgId },
  });
}

async function addMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole = WorkspaceRole.DEVELOPER,
) {
  return db.workspaceMember.create({
    data: { workspaceId, userId, role, joinedAt: new Date() },
  });
}

function makeParams(githubLogin: string) {
  return Promise.resolve({ githubLogin });
}

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdWorkspaceIds.length > 0) {
    await db.workspaceMember.deleteMany({
      where: { workspaceId: { in: createdWorkspaceIds } },
    });
    await db.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    createdWorkspaceIds.length = 0;
  }
  if (createdOrgIds.length > 0) {
    await db.sourceControlOrg.deleteMany({ where: { id: { in: createdOrgIds } } });
    createdOrgIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

async function createOrgWithUserWorkspace(githubLogin: string) {
  const org = await createOrg(githubLogin);
  createdOrgIds.push(org.id);

  const user = await createTestUser({
    email: `schematic-${generateUniqueId()}@example.com`,
    idempotent: false,
  });
  createdUserIds.push(user.id);

  const workspace = await createTestWorkspace({
    ownerId: user.id,
    sourceControlOrgId: org.id,
    slug: `ws-${generateUniqueId()}`,
  });
  createdWorkspaceIds.push(workspace.id);

  return { org, user, workspace };
}

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

  it("returns { schematic: null } for org with no schematic (authorized member)", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const { user } = await createOrgWithUserWorkspace(githubLogin);

    const req = createAuthenticatedGetRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: user.id, email: user.email!, name: user.name! }
    );
    const res = await GET(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ schematic: null }>(res, 200);
    expect(data.schematic).toBeNull();
  });

  it("returns saved schematic after update (authorized member)", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const { org, user } = await createOrgWithUserWorkspace(githubLogin);

    const mermaidBody = "graph TD\n  A --> B";
    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { schematic: mermaidBody },
    });

    const req = createAuthenticatedGetRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: user.id, email: user.email!, name: user.name! }
    );
    const res = await GET(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ schematic: string }>(res, 200);
    expect(data.schematic).toBe(mermaidBody);
  });

  it("returns 404 for signed-in non-member attacker (no schematic leakage)", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const mermaidBody = "graph TD\n  VICTIM --> SECRET";
    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { schematic: mermaidBody },
    });

    // Owner has a workspace under the org.
    const owner = await createTestUser({
      email: `owner-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    // Attacker has no workspace under the org.
    const attacker = await createTestUser({
      email: `attacker-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(attacker.id);

    const req = createAuthenticatedGetRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: attacker.id, email: attacker.email!, name: attacker.name! }
    );
    const res = await GET(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ error: string }>(res, 404);
    expect(data.error).toBe("Organization not found");
    // Ensure no schematic content leaked in the response body.
    expect(JSON.stringify(data)).not.toContain("SECRET");
  });

  it("returns 404 for unknown org (no org-existence leak)", async () => {
    const user = await createTestUser({
      email: `unknown-org-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(user.id);

    const req = createAuthenticatedGetRequest(
      `/api/orgs/does-not-exist-${generateUniqueId()}/schematic`,
      { id: user.id, email: user.email!, name: user.name! }
    );
    const res = await GET(req, {
      params: makeParams(`does-not-exist-${generateUniqueId()}`),
    });
    await expectJson(res, 404);
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

  it("persists value and returns it (workspace OWNER)", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const { org, user } = await createOrgWithUserWorkspace(githubLogin);

    const mermaidBody = "graph LR\n  X --> Y\n  Y --> Z";

    const req = createAuthenticatedPutRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: user.id, email: user.email!, name: user.name! },
      { schematic: mermaidBody }
    );
    const res = await PUT(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ schematic: string }>(res, 200);
    expect(data.schematic).toBe(mermaidBody);

    const updated = await db.sourceControlOrg.findUnique({ where: { id: org.id } });
    expect(updated?.schematic).toBe(mermaidBody);
  });

  it("allows workspace ADMIN to write", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const owner = await createTestUser({
      email: `owner-adm-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);

    const admin = await createTestUser({
      email: `adm-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(admin.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, admin.id, WorkspaceRole.ADMIN);

    const mermaidBody = "graph TD\n  admin --> ok";

    const req = createAuthenticatedPutRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: admin.id, email: admin.email!, name: admin.name! },
      { schematic: mermaidBody }
    );
    const res = await PUT(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ schematic: string }>(res, 200);
    expect(data.schematic).toBe(mermaidBody);
  });

  it("returns 404 for DEVELOPER member (no write access)", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { schematic: "original-value" },
    });

    const owner = await createTestUser({
      email: `owner-dev-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);

    const developer = await createTestUser({
      email: `dev-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(developer.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, developer.id, WorkspaceRole.DEVELOPER);

    const req = createAuthenticatedPutRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: developer.id, email: developer.email!, name: developer.name! },
      { schematic: "attacker-overwrite" }
    );
    const res = await PUT(req, { params: makeParams(githubLogin) });
    await expectJson(res, 404);

    const after = await db.sourceControlOrg.findUnique({ where: { id: org.id } });
    expect(after?.schematic).toBe("original-value");
  });

  it("returns 404 for signed-in non-member attacker (no write)", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { schematic: "victim-graph" },
    });

    const owner = await createTestUser({
      email: `owner-atk-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const attacker = await createTestUser({
      email: `atk-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(attacker.id);

    const req = createAuthenticatedPutRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: attacker.id, email: attacker.email!, name: attacker.name! },
      { schematic: "attacker-overwrite" }
    );
    const res = await PUT(req, { params: makeParams(githubLogin) });
    await expectJson(res, 404);

    const after = await db.sourceControlOrg.findUnique({ where: { id: org.id } });
    expect(after?.schematic).toBe("victim-graph");
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

    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedPutRequest(
      `/api/orgs/${githubLogin}/schematic`,
      { id: user.id, email: user.email!, name: user.name! },
      {} // missing schematic
    );
    const res = await PUT(req, { params: makeParams(githubLogin) });
    await expectJson(res, 400);
  });
});
