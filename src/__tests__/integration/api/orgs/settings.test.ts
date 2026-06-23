import { describe, it, expect, afterEach } from "vitest";
import {
  createPatchRequest,
  createAuthenticatedPatchRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { PATCH } from "@/app/api/orgs/[githubLogin]/settings/route";
import { WorkspaceRole } from "@prisma/client";
import type { NextResponse } from "next/server";

async function expectJson<T = unknown>(res: NextResponse | Response, status = 200): Promise<T> {
  const r = res as Response;
  expect(r.status).toBe(status);
  return r.json() as Promise<T>;
}

let installationIdCounter = 810000;
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
  const slug = `settings-test-ws-${generateUniqueId()}`;
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
    // Clear defaultWorkspaceId FK before deleting workspaces
    await db.sourceControlOrg.updateMany({
      where: { defaultWorkspaceId: { in: createdWorkspaceIds } },
      data: { defaultWorkspaceId: null },
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

// ─── PATCH /api/orgs/[githubLogin]/settings ───────────────────────────────

describe("PATCH /api/orgs/[githubLogin]/settings", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const req = createPatchRequest(`/api/orgs/${githubLogin}/settings`, {
      defaultWorkspaceId: null,
    });
    const res = await PATCH(req, { params: makeParams(githubLogin) });
    await expectJson(res, 401);
  });

  it("returns 404 for authenticated non-member", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    // owner with workspace (needed for the org to exist)
    const owner = await createTestUser({
      email: `owner-nm-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const outsider = await createTestUser({
      email: `outsider-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(outsider.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/settings`,
      { defaultWorkspaceId: ws.id },
      { id: outsider.id, email: outsider.email!, name: outsider.name! },
    );
    const res = await PATCH(req, { params: makeParams(githubLogin) });
    await expectJson(res, 404);
  });

  it("returns 404 for MEMBER (DEVELOPER) — not an OWNER or ADMIN", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const owner = await createTestUser({
      email: `owner-dev-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const developer = await createTestUser({
      email: `dev-settings-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(developer.id);
    await addMember(ws.id, developer.id, WorkspaceRole.DEVELOPER);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/settings`,
      { defaultWorkspaceId: ws.id },
      { id: developer.id, email: developer.email!, name: developer.name! },
    );
    const res = await PATCH(req, { params: makeParams(githubLogin) });
    await expectJson(res, 404);
  });

  it("returns 400 when body is invalid (missing defaultWorkspaceId key)", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const owner = await createTestUser({
      email: `owner-bad-body-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/settings`,
      { defaultWorkspaceId: 12345 }, // invalid type
      { id: owner.id, email: owner.email!, name: owner.name! },
    );
    const res = await PATCH(req, { params: makeParams(githubLogin) });
    await expectJson(res, 400);
  });

  it("returns 400 when defaultWorkspaceId belongs to a different org", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const owner = await createTestUser({
      email: `owner-xorg-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    // Create a workspace in a different org
    const otherGithubLogin = `other-org-${generateUniqueId()}`;
    const otherOrg = await createOrg(otherGithubLogin);
    createdOrgIds.push(otherOrg.id);
    const otherWs = await createWorkspaceInOrg(owner.id, otherOrg.id);
    createdWorkspaceIds.push(otherWs.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/settings`,
      { defaultWorkspaceId: otherWs.id }, // workspace in different org
      { id: owner.id, email: owner.email!, name: owner.name! },
    );
    const res = await PATCH(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ error: string }>(res, 400);
    expect(data.error).toBe("Workspace not found in this org");
  });

  it("sets defaultWorkspaceId for OWNER with valid workspace in org → 200, DB updated", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const owner = await createTestUser({
      email: `owner-set-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/settings`,
      { defaultWorkspaceId: ws.id },
      { id: owner.id, email: owner.email!, name: owner.name! },
    );
    const res = await PATCH(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ defaultWorkspaceId: string }>(res, 200);
    expect(data.defaultWorkspaceId).toBe(ws.id);

    const updated = await db.sourceControlOrg.findUnique({ where: { id: org.id } });
    expect(updated?.defaultWorkspaceId).toBe(ws.id);
  });

  it("allows workspace ADMIN to set default", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const owner = await createTestUser({
      email: `owner-adm-set-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const admin = await createTestUser({
      email: `admin-set-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(admin.id);
    await addMember(ws.id, admin.id, WorkspaceRole.ADMIN);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/settings`,
      { defaultWorkspaceId: ws.id },
      { id: admin.id, email: admin.email!, name: admin.name! },
    );
    const res = await PATCH(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ defaultWorkspaceId: string }>(res, 200);
    expect(data.defaultWorkspaceId).toBe(ws.id);
  });

  it("clears defaultWorkspaceId when null is passed → 200, DB cleared", async () => {
    const githubLogin = `test-org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const owner = await createTestUser({
      email: `owner-clear-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    // Seed a default first
    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { defaultWorkspaceId: ws.id },
    });

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/settings`,
      { defaultWorkspaceId: null },
      { id: owner.id, email: owner.email!, name: owner.name! },
    );
    const res = await PATCH(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ defaultWorkspaceId: null }>(res, 200);
    expect(data.defaultWorkspaceId).toBeNull();

    const updated = await db.sourceControlOrg.findUnique({ where: { id: org.id } });
    expect(updated?.defaultWorkspaceId).toBeNull();
  });
});
