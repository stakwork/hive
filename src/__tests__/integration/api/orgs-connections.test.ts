import { describe, it, expect, afterEach } from "vitest";
import {
  addMiddlewareHeaders,
  createAuthenticatedGetRequest,
  createDeleteRequest,
  createGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { GET, DELETE } from "@/app/api/orgs/[githubLogin]/connections/route";
import { WorkspaceRole } from "@prisma/client";
import type { NextResponse } from "next/server";

async function expectJson<T = unknown>(res: NextResponse | Response, status = 200): Promise<T> {
  const r = res as Response;
  expect(r.status).toBe(status);
  return r.json() as Promise<T>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

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
  const slug = `conn-test-ws-${generateUniqueId()}`;
  return db.workspace.create({
    data: { name: slug, slug, ownerId, sourceControlOrgId: orgId },
  });
}

async function addMember(workspaceId: string, userId: string, role: WorkspaceRole = WorkspaceRole.DEVELOPER) {
  return db.workspaceMember.create({
    data: { workspaceId, userId, role, joinedAt: new Date() },
  });
}

async function createConnection(orgId: string, createdBy: string, slug?: string) {
  return db.connection.create({
    data: {
      slug: slug ?? `connection-${generateUniqueId()}`,
      name: "Test Connection",
      summary: "victim summary content",
      diagram: "victim diagram",
      architecture: "victim architecture",
      openApiSpec: "victim openapi",
      createdBy,
      orgId,
    },
  });
}

function makeParams(githubLogin: string) {
  return Promise.resolve({ githubLogin });
}

function authedDeleteRequest(
  url: string,
  user: { id: string; email: string | null; name: string | null },
  body: object,
) {
  const base = createDeleteRequest(url, body);
  return addMiddlewareHeaders(base, {
    id: user.id,
    email: user.email || "",
    name: user.name || "",
  });
}

// ─── cleanup tracking ───────────────────────────────────────────────────────

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdConnectionIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdConnectionIds.length > 0) {
    await db.connection.deleteMany({ where: { id: { in: createdConnectionIds } } });
    createdConnectionIds.length = 0;
  }
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

// ─── GET ────────────────────────────────────────────────────────────────────

describe("GET /api/orgs/[githubLogin]/connections - IDOR hardening", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const req = createGetRequest("/api/orgs/some-org/connections");
    const res = await GET(req, { params: makeParams("some-org") });
    await expectJson(res, 401);
  });

  it("returns 404 for a signed-in user with no workspace under the org (non-member IDOR)", async () => {
    const owner = await createTestUser({
      email: `conn-owner-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    const attacker = await createTestUser({
      email: `conn-attacker-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id, attacker.id);

    const login = `conn-victim-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const connection = await createConnection(org.id, owner.id);
    createdConnectionIds.push(connection.id);

    const req = createAuthenticatedGetRequest(
      `/api/orgs/${login}/connections`,
      attacker,
    );
    const res = await GET(req, { params: makeParams(login) });
    const data = await expectJson<{ error: string }>(res, 404);

    expect(data.error).toBe("Organization not found");
    // Make sure the attacker never received the victim's connection payload.
    expect(JSON.stringify(data)).not.toContain("victim summary content");
    expect(JSON.stringify(data)).not.toContain("victim diagram");
  });

  it("returns 404 for an unknown org without leaking existence", async () => {
    const user = await createTestUser({
      email: `conn-unknown-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(user.id);

    const req = createAuthenticatedGetRequest(
      `/api/orgs/nonexistent-login-${generateUniqueId()}/connections`,
      user,
    );
    const res = await GET(req, {
      params: makeParams(`nonexistent-login-${generateUniqueId()}`),
    });
    await expectJson(res, 404);
  });

  it("returns connections when caller owns a workspace under the org", async () => {
    const owner = await createTestUser({
      email: `conn-ok-owner-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);

    const login = `conn-ok-org-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const connection = await createConnection(org.id, owner.id);
    createdConnectionIds.push(connection.id);

    const req = createAuthenticatedGetRequest(
      `/api/orgs/${login}/connections`,
      owner,
    );
    const res = await GET(req, { params: makeParams(login) });
    const data = await expectJson<{ id: string; summary: string }[]>(res);

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(connection.id);
    expect(data[0].summary).toBe("victim summary content");
  });

  it("returns connections for a plain DEVELOPER member", async () => {
    const owner = await createTestUser({
      email: `conn-o-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    const member = await createTestUser({
      email: `conn-m-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id, member.id);

    const login = `conn-member-org-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, member.id, WorkspaceRole.DEVELOPER);

    const connection = await createConnection(org.id, owner.id);
    createdConnectionIds.push(connection.id);

    const req = createAuthenticatedGetRequest(
      `/api/orgs/${login}/connections`,
      member,
    );
    const res = await GET(req, { params: makeParams(login) });
    const data = await expectJson<unknown[]>(res);

    expect(data).toHaveLength(1);
  });
});

// ─── DELETE ─────────────────────────────────────────────────────────────────

describe("DELETE /api/orgs/[githubLogin]/connections - IDOR hardening", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const req = createDeleteRequest("/api/orgs/some-org/connections", {
      connectionId: "abc",
    });
    const res = await DELETE(req, { params: makeParams("some-org") });
    await expectJson(res, 401);
  });

  it("returns 404 when caller is not a member of any workspace under the org", async () => {
    const owner = await createTestUser({
      email: `conn-del-o-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    const attacker = await createTestUser({
      email: `conn-del-a-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id, attacker.id);

    const login = `conn-del-victim-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const connection = await createConnection(org.id, owner.id);
    createdConnectionIds.push(connection.id);

    const req = authedDeleteRequest(
      `/api/orgs/${login}/connections`,
      attacker,
      { connectionId: connection.id },
    );
    const res = await DELETE(req, { params: makeParams(login) });
    await expectJson(res, 404);

    // Verify the connection still exists — no write happened.
    const stillThere = await db.connection.findUnique({
      where: { id: connection.id },
    });
    expect(stillThere).not.toBeNull();
  });

  it("returns 404 when caller is a plain DEVELOPER member (admin required for DELETE)", async () => {
    const owner = await createTestUser({
      email: `conn-dev-o-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    const developer = await createTestUser({
      email: `conn-dev-d-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id, developer.id);

    const login = `conn-dev-org-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, developer.id, WorkspaceRole.DEVELOPER);

    const connection = await createConnection(org.id, owner.id);
    createdConnectionIds.push(connection.id);

    const req = authedDeleteRequest(
      `/api/orgs/${login}/connections`,
      developer,
      { connectionId: connection.id },
    );
    const res = await DELETE(req, { params: makeParams(login) });
    await expectJson(res, 404);

    const stillThere = await db.connection.findUnique({
      where: { id: connection.id },
    });
    expect(stillThere).not.toBeNull();
  });

  it("allows workspace OWNER to delete a connection", async () => {
    const owner = await createTestUser({
      email: `conn-del-ok-o-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);

    const login = `conn-del-ok-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const connection = await createConnection(org.id, owner.id);
    // Don't push to createdConnectionIds — the delete under test will remove it.

    const req = authedDeleteRequest(
      `/api/orgs/${login}/connections`,
      owner,
      { connectionId: connection.id },
    );
    const res = await DELETE(req, { params: makeParams(login) });
    await expectJson(res, 200);

    const deleted = await db.connection.findUnique({
      where: { id: connection.id },
    });
    expect(deleted).toBeNull();
  });

  it("allows ADMIN member to delete a connection", async () => {
    const owner = await createTestUser({
      email: `conn-del-adm-o-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    const admin = await createTestUser({
      email: `conn-del-adm-a-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id, admin.id);

    const login = `conn-del-adm-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, admin.id, WorkspaceRole.ADMIN);

    const connection = await createConnection(org.id, owner.id);

    const req = authedDeleteRequest(
      `/api/orgs/${login}/connections`,
      admin,
      { connectionId: connection.id },
    );
    const res = await DELETE(req, { params: makeParams(login) });
    await expectJson(res, 200);

    const deleted = await db.connection.findUnique({
      where: { id: connection.id },
    });
    expect(deleted).toBeNull();
  });

  it("returns 400 when connectionId is missing", async () => {
    const owner = await createTestUser({
      email: `conn-del-400-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);

    const login = `conn-del-400-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = authedDeleteRequest(
      `/api/orgs/${login}/connections`,
      owner,
      {},
    );
    const res = await DELETE(req, { params: makeParams(login) });
    await expectJson(res, 400);
  });
});
