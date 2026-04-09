import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedGetRequest,
  createGetRequest,
  createAuthenticatedPatchRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { GET as getOrgs } from "@/app/api/orgs/route";
import { GET as getOrgWorkspaces } from "@/app/api/orgs/[githubLogin]/workspaces/route";
import { GET as getOrgMembers } from "@/app/api/orgs/[githubLogin]/members/route";
import { PATCH as patchOrgMember } from "@/app/api/orgs/[githubLogin]/members/[userId]/route";
import type { NextResponse } from "next/server";

async function expectJson<T = unknown>(res: NextResponse | Response, status = 200): Promise<T> {
  const r = res as Response;
  expect(r.status).toBe(status);
  return r.json() as Promise<T>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

let installationIdCounter = 800000;
function nextInstallationId() {
  return installationIdCounter++;
}

async function createOrg(githubLogin: string, type: "ORG" | "USER" = "ORG") {
  return db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: nextInstallationId(),
      type,
      name: githubLogin,
      avatarUrl: `https://avatars.githubusercontent.com/u/${nextInstallationId()}?v=4`,
    },
  });
}

async function createWorkspaceInOrg(
  ownerId: string,
  orgId: string,
  slugSuffix?: string
) {
  const slug = `test-org-ws-${generateUniqueId()}${slugSuffix ?? ""}`;
  return db.workspace.create({
    data: {
      name: slug,
      slug,
      ownerId,
      sourceControlOrgId: orgId,
    },
  });
}

async function addMember(workspaceId: string, userId: string) {
  return db.workspaceMember.create({
    data: { workspaceId, userId, role: "DEVELOPER", joinedAt: new Date() },
  });
}

function makeParams(githubLogin: string) {
  return Promise.resolve({ githubLogin });
}

function makeMemberParams(githubLogin: string, userId: string) {
  return Promise.resolve({ githubLogin, userId });
}

// ─── cleanup tracking ───────────────────────────────────────────────────────

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
    await db.workspaceMember.deleteMany({ where: { userId: { in: createdUserIds } } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

// ─── GET /api/orgs ───────────────────────────────────────────────────────────

describe("GET /api/orgs", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const req = createGetRequest("/api/orgs");
    const res = await getOrgs(req);
    await expectJson(res, 401);
  });

  it("returns empty array when user has no orgs", async () => {
    const user = await createTestUser({ email: `no-orgs-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(user.id);

    const req = createAuthenticatedGetRequest("/api/orgs", user);
    const res = await getOrgs(req);
    const data = await expectJson<unknown[]>(res);

    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it("returns orgs for workspaces the user owns", async () => {
    const user = await createTestUser({ email: `orgs-owner-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(user.id);

    const org = await createOrg(`orgs-test-owned-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedGetRequest("/api/orgs", user);
    const res = await getOrgs(req);
    const data = await expectJson<{ githubLogin: string; type: string }[]>(res);

    expect(data.some((o) => o.githubLogin === org.githubLogin)).toBe(true);
  });

  it("returns orgs for workspaces the user is a member of", async () => {
    const owner = await createTestUser({ email: `orgs-ws-owner-${generateUniqueId()}@example.com`, idempotent: false });
    const member = await createTestUser({ email: `orgs-member-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(owner.id, member.id);

    const org = await createOrg(`orgs-test-member-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, member.id);

    const req = createAuthenticatedGetRequest("/api/orgs", member);
    const res = await getOrgs(req);
    const data = await expectJson<{ githubLogin: string }[]>(res);

    expect(data.some((o) => o.githubLogin === org.githubLogin)).toBe(true);
  });

  it("does not return orgs for deleted workspaces", async () => {
    const user = await createTestUser({ email: `orgs-deleted-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(user.id);

    const org = await createOrg(`orgs-test-deleted-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const ws = await db.workspace.create({
      data: {
        name: "deleted-ws",
        slug: `deleted-ws-${generateUniqueId()}`,
        ownerId: user.id,
        sourceControlOrgId: org.id,
        deleted: true,
      },
    });
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedGetRequest("/api/orgs", user);
    const res = await getOrgs(req);
    const data = await expectJson<{ githubLogin: string }[]>(res);

    expect(data.some((o) => o.githubLogin === org.githubLogin)).toBe(false);
  });
});

// ─── GET /api/orgs/[githubLogin]/workspaces ──────────────────────────────────

describe("GET /api/orgs/[githubLogin]/workspaces", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const req = createGetRequest("/api/orgs/some-org/workspaces");
    const res = await getOrgWorkspaces(req, { params: makeParams("some-org") });
    await expectJson(res, 401);
  });

  it("returns workspaces the user owns in the org", async () => {
    const user = await createTestUser({ email: `ws-owner-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(user.id);

    const login = `ws-owner-org-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedGetRequest(`/api/orgs/${login}/workspaces`, user);
    const res = await getOrgWorkspaces(req, { params: makeParams(login) });
    const data = await expectJson<{ slug: string; userRole: string }[]>(res);

    expect(data).toHaveLength(1);
    expect(data[0].slug).toBe(ws.slug);
    expect(data[0].userRole).toBe("OWNER");
  });

  it("returns workspaces the user is a member of in the org", async () => {
    const owner = await createTestUser({ email: `ws-o-${generateUniqueId()}@example.com`, idempotent: false });
    const member = await createTestUser({ email: `ws-m-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(owner.id, member.id);

    const login = `ws-member-org-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, member.id);

    const req = createAuthenticatedGetRequest(`/api/orgs/${login}/workspaces`, member);
    const res = await getOrgWorkspaces(req, { params: makeParams(login) });
    const data = await expectJson<{ slug: string }[]>(res);

    expect(data).toHaveLength(1);
    expect(data[0].slug).toBe(ws.slug);
  });

  it("does not return workspaces the user has no access to", async () => {
    const owner = await createTestUser({ email: `ws-priv-o-${generateUniqueId()}@example.com`, idempotent: false });
    const stranger = await createTestUser({ email: `ws-priv-s-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(owner.id, stranger.id);

    const login = `ws-private-org-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedGetRequest(`/api/orgs/${login}/workspaces`, stranger);
    const res = await getOrgWorkspaces(req, { params: makeParams(login) });
    const data = await expectJson<unknown[]>(res);

    expect(data).toHaveLength(0);
  });

  it("returns empty array for unknown githubLogin", async () => {
    const user = await createTestUser({ email: `ws-unknown-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(user.id);

    const req = createAuthenticatedGetRequest("/api/orgs/nonexistent-login-xyz/workspaces", user);
    const res = await getOrgWorkspaces(req, { params: makeParams("nonexistent-login-xyz") });
    const data = await expectJson<unknown[]>(res);

    expect(data).toHaveLength(0);
  });
});

// ─── GET /api/orgs/[githubLogin]/members ─────────────────────────────────────

describe("GET /api/orgs/[githubLogin]/members", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const req = createGetRequest("/api/orgs/some-org/members");
    const res = await getOrgMembers(req, { params: makeParams("some-org") });
    await expectJson(res, 401);
  });

  it("returns members across org workspaces, deduplicated", async () => {
    const owner = await createTestUser({ email: `mem-o-${generateUniqueId()}@example.com`, idempotent: false });
    const m1 = await createTestUser({ email: `mem-1-${generateUniqueId()}@example.com`, idempotent: false });
    const m2 = await createTestUser({ email: `mem-2-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(owner.id, m1.id, m2.id);

    const login = `mem-dedup-org-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws1 = await createWorkspaceInOrg(owner.id, org.id, "-ws1");
    const ws2 = await createWorkspaceInOrg(owner.id, org.id, "-ws2");
    createdWorkspaceIds.push(ws1.id, ws2.id);

    // m1 is in both workspaces (should appear once), m2 in ws1 only
    await addMember(ws1.id, m1.id);
    await addMember(ws2.id, m1.id);
    await addMember(ws1.id, m2.id);

    const req = createAuthenticatedGetRequest(`/api/orgs/${login}/members`, owner);
    const res = await getOrgMembers(req, { params: makeParams(login) });
    const data = await expectJson<{ id: string }[]>(res);

    const ids = data.map((m) => m.id);
    // m1 appears exactly once despite being in two workspaces
    expect(ids.filter((id) => id === m1.id)).toHaveLength(1);
    // m2 appears
    expect(ids).toContain(m2.id);
  });

  it("returns empty array for org with no accessible workspaces", async () => {
    const user = await createTestUser({ email: `mem-empty-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(user.id);

    const req = createAuthenticatedGetRequest("/api/orgs/nonexistent-org-abc/members", user);
    const res = await getOrgMembers(req, { params: makeParams("nonexistent-org-abc") });
    const data = await expectJson<unknown[]>(res);

    expect(data).toHaveLength(0);
  });

  it("does not return members of orgs the user has no access to", async () => {
    const owner = await createTestUser({ email: `mem-priv-o-${generateUniqueId()}@example.com`, idempotent: false });
    const stranger = await createTestUser({ email: `mem-priv-s-${generateUniqueId()}@example.com`, idempotent: false });
    const teamMember = await createTestUser({ email: `mem-priv-t-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(owner.id, stranger.id, teamMember.id);

    const login = `mem-private-org-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, teamMember.id);

    // Stranger has no access to any workspace in this org
    const req = createAuthenticatedGetRequest(`/api/orgs/${login}/members`, stranger);
    const res = await getOrgMembers(req, { params: makeParams(login) });
    const data = await expectJson<unknown[]>(res);

    expect(data).toHaveLength(0);
  });
});

// ─── PATCH /api/orgs/[githubLogin]/members/[userId] ──────────────────────────

describe("PATCH /api/orgs/[githubLogin]/members/[userId]", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const req = createGetRequest("/api/orgs/some-org/members/some-user");
    // Use a raw GET request (no auth headers) — patchOrgMember checks auth regardless of method
    const res = await patchOrgMember(req as never, { params: makeMemberParams("some-org", "some-user") });
    await expectJson(res, 401);
  });

  it("updates a member description and returns workspaceId + description", async () => {
    const owner = await createTestUser({ email: `patch-owner-${generateUniqueId()}@example.com`, idempotent: false });
    const member = await createTestUser({ email: `patch-member-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(owner.id, member.id);

    const login = `patch-desc-org-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, member.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${login}/members/${member.id}`,
      { workspaceId: ws.id, description: "Great developer" },
      owner
    );
    const res = await patchOrgMember(req, { params: makeMemberParams(login, member.id) });
    const data = await expectJson<{ workspaceId: string; description: string | null }>(res);

    expect(data.workspaceId).toBe(ws.id);
    expect(data.description).toBe("Great developer");

    // Verify the DB was actually updated
    const record = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: member.id } },
      select: { description: true },
    });
    expect(record?.description).toBe("Great developer");
  });

  it("allows a non-owner member to update descriptions in the org", async () => {
    const owner = await createTestUser({ email: `patch-o2-${generateUniqueId()}@example.com`, idempotent: false });
    const editor = await createTestUser({ email: `patch-e2-${generateUniqueId()}@example.com`, idempotent: false });
    const target = await createTestUser({ email: `patch-t2-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(owner.id, editor.id, target.id);

    const login = `patch-member-editor-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, editor.id);
    await addMember(ws.id, target.id);

    // Editor (not owner) can still update descriptions
    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${login}/members/${target.id}`,
      { workspaceId: ws.id, description: "Edited by peer" },
      editor
    );
    const res = await patchOrgMember(req, { params: makeMemberParams(login, target.id) });
    await expectJson<{ description: string }>(res);

    const record = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: target.id } },
      select: { description: true },
    });
    expect(record?.description).toBe("Edited by peer");
  });

  it("returns 403 when requester is not a member of the org", async () => {
    const owner = await createTestUser({ email: `patch-fo-${generateUniqueId()}@example.com`, idempotent: false });
    const outsider = await createTestUser({ email: `patch-fx-${generateUniqueId()}@example.com`, idempotent: false });
    const target = await createTestUser({ email: `patch-ft-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(owner.id, outsider.id, target.id);

    const login = `patch-forbidden-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, target.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${login}/members/${target.id}`,
      { workspaceId: ws.id, description: "Sneaky edit" },
      outsider
    );
    const res = await patchOrgMember(req, { params: makeMemberParams(login, target.id) });
    await expectJson(res, 403);
  });

  it("returns 404 when the WorkspaceMember record does not exist", async () => {
    const owner = await createTestUser({ email: `patch-404-o-${generateUniqueId()}@example.com`, idempotent: false });
    createdUserIds.push(owner.id);

    const login = `patch-404-org-${generateUniqueId()}`;
    const org = await createOrg(login);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    // Owner requests update for a userId that has no membership record
    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${login}/members/nonexistent-user-id`,
      { workspaceId: ws.id, description: "Ghost edit" },
      owner
    );
    const res = await patchOrgMember(req, { params: makeMemberParams(login, "nonexistent-user-id") });
    await expectJson(res, 404);
  });
});
