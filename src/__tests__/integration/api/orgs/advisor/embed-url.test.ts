/**
 * Integration tests for POST /api/orgs/[githubLogin]/advisor/embed-url
 *
 * Hive makes no outbound call here — the route derives the advisor URL
 * purely from the swarm's public `swarmUrl`. These tests verify the
 * default-workspace-only resolution, the Owner/Admin gate, and that no
 * credential is ever read or returned.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createAuthenticatedPostRequest, generateUniqueId } from "@/__tests__/support/helpers";
import { createTestUser, createTestSwarm } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { POST } from "@/app/api/orgs/[githubLogin]/advisor/embed-url/route";
import type { NextResponse } from "next/server";

async function expectJson<T = unknown>(res: NextResponse | Response, status: number): Promise<T> {
  const r = res as Response;
  expect(r.status).toBe(status);
  return r.json() as Promise<T>;
}

let installationIdCounter = 880000;

async function createOrg(githubLogin: string) {
  return db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: installationIdCounter++,
      type: "ORG",
      name: githubLogin,
    },
  });
}

async function createWorkspaceInOrg(ownerId: string, orgId: string, suffix = "") {
  const slug = `advisor-test-ws-${generateUniqueId()}${suffix}`;
  return db.workspace.create({
    data: { name: slug, slug, ownerId, sourceControlOrgId: orgId },
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
    await db.swarm.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
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

async function seedUser(prefix: string) {
  const user = await createTestUser({
    email: `${prefix}-${generateUniqueId()}@example.com`,
    idempotent: false,
  });
  createdUserIds.push(user.id);
  return user;
}

async function seedMember(
  prefix: string,
  workspaceId: string,
  role: "ADMIN" | "PM" | "DEVELOPER" | "STAKEHOLDER" | "VIEWER",
) {
  const user = await seedUser(prefix);
  await db.workspaceMember.create({ data: { workspaceId, userId: user.id, role } });
  return user;
}

function postAs(githubLogin: string, user: { id: string; email: string | null; name: string | null }) {
  const req = createAuthenticatedPostRequest(
    `/api/orgs/${githubLogin}/advisor/embed-url`,
    {},
    { id: user.id, email: user.email!, name: user.name! },
  );
  return POST(req, { params: makeParams(githubLogin) });
}

async function setDefaultWorkspace(orgId: string, workspaceId: string) {
  await db.sourceControlOrg.update({ where: { id: orgId }, data: { defaultWorkspaceId: workspaceId } });
}

describe("POST /api/orgs/[githubLogin]/advisor/embed-url", () => {
  it("returns 401 when signed out", async () => {
    const githubLogin = `advisor-noauth-${generateUniqueId()}`;
    const req = new Request(`http://localhost/api/orgs/${githubLogin}/advisor/embed-url`, {
      method: "POST",
    });
    const res = await POST(req as unknown as Parameters<typeof POST>[0], { params: makeParams(githubLogin) });
    expect((res as Response).status).toBe(401);
  });

  it("returns 404 not_configured when the org has no default workspace", async () => {
    const githubLogin = `advisor-nodefault-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedUser("advisor-owner-nd");

    const data = await expectJson<{ reason: string }>(await postAs(githubLogin, owner), 404);
    expect(data.reason).toBe("not_configured");
  });

  it("returns 404 not_configured when the default workspace has no swarm", async () => {
    const githubLogin = `advisor-noswarm-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedUser("advisor-owner-ns");
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await setDefaultWorkspace(org.id, ws.id);

    const data = await expectJson<{ reason: string }>(await postAs(githubLogin, owner), 404);
    expect(data.reason).toBe("not_configured");
  });

  it("returns 404 not_configured when swarmUrl is null", async () => {
    const githubLogin = `advisor-nullurl-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedUser("advisor-owner-nu");
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    const swarm = await createTestSwarm({ workspaceId: ws.id, swarmApiKey: "key-null" });
    await db.swarm.update({ where: { id: swarm.id }, data: { swarmUrl: null } });
    await setDefaultWorkspace(org.id, ws.id);

    const data = await expectJson<{ reason: string }>(await postAs(githubLogin, owner), 404);
    expect(data.reason).toBe("not_configured");
  });

  it("returns 403 no_access for a DEVELOPER of the default workspace", async () => {
    const githubLogin = `advisor-dev-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedUser("advisor-owner-dev");
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({ workspaceId: ws.id, swarmUrl: "https://devgate.sphinx.chat/api", swarmApiKey: "k" });
    await setDefaultWorkspace(org.id, ws.id);
    const dev = await seedMember("advisor-dev-user", ws.id, "DEVELOPER");

    const data = await expectJson<{ reason: string; error: string }>(await postAs(githubLogin, dev), 403);
    expect(data.reason).toBe("no_access");
  });

  it("returns 403 no_access for a VIEWER of the default workspace", async () => {
    const githubLogin = `advisor-viewer-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedUser("advisor-owner-viewer");
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({ workspaceId: ws.id, swarmUrl: "https://viewergate.sphinx.chat/api", swarmApiKey: "k" });
    await setDefaultWorkspace(org.id, ws.id);
    const viewer = await seedMember("advisor-viewer-user", ws.id, "VIEWER");

    const data = await expectJson<{ reason: string }>(await postAs(githubLogin, viewer), 403);
    expect(data.reason).toBe("no_access");
  });

  it("returns 403 no_access for a user who isn't a member of the default workspace", async () => {
    const githubLogin = `advisor-outsider-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedUser("advisor-owner-outsider");
    const outsider = await seedUser("advisor-outsider-user");
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({ workspaceId: ws.id, swarmUrl: "https://outsidergate.sphinx.chat/api", swarmApiKey: "k" });
    await setDefaultWorkspace(org.id, ws.id);

    const data = await expectJson<{ reason: string }>(await postAs(githubLogin, outsider), 403);
    expect(data.reason).toBe("no_access");
  });

  it("does not fall back: an Admin of a non-default swarm workspace gets 403, never another swarm's URL", async () => {
    const githubLogin = `advisor-nofallback-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedUser("advisor-owner-nf");

    const otherWs = await createWorkspaceInOrg(owner.id, org.id, "-other");
    createdWorkspaceIds.push(otherWs.id);
    await createTestSwarm({ workspaceId: otherWs.id, swarmUrl: "https://other.sphinx.chat/api", swarmApiKey: "k" });
    const admin = await seedMember("advisor-admin-nf", otherWs.id, "ADMIN");

    const defaultWs = await createWorkspaceInOrg(owner.id, org.id, "-default");
    createdWorkspaceIds.push(defaultWs.id);
    await createTestSwarm({ workspaceId: defaultWs.id, swarmUrl: "https://defaultnf.sphinx.chat/api", swarmApiKey: "k" });
    await setDefaultWorkspace(org.id, defaultWs.id);

    const data = await expectJson<{ reason: string }>(await postAs(githubLogin, admin), 403);
    expect(data.reason).toBe("no_access");
  });

  it("returns 200 with the advisor URL for the Owner", async () => {
    const githubLogin = `advisor-owner-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedUser("advisor-owner-ok");
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({ workspaceId: ws.id, swarmUrl: "https://swarm38.sphinx.chat/api", swarmApiKey: "k" });
    await setDefaultWorkspace(org.id, ws.id);

    const res = await postAs(githubLogin, owner);
    const data = await expectJson<{ url: string; workspaceSlug: string }>(res, 200);
    expect(data.url).toBe("https://advisor-swarm38.sphinx.chat");
    expect(data.workspaceSlug).toBe(ws.slug);
    expect((res as Response).headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns 200 with the advisor URL for an ADMIN", async () => {
    const githubLogin = `advisor-admin-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedUser("advisor-owner-admin-ok");
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({ workspaceId: ws.id, swarmUrl: "https://swarm39.sphinx.chat/api", swarmApiKey: "k" });
    await setDefaultWorkspace(org.id, ws.id);
    const admin = await seedMember("advisor-admin-ok", ws.id, "ADMIN");

    const data = await expectJson<{ url: string }>(await postAs(githubLogin, admin), 200);
    expect(data.url).toBe("https://advisor-swarm39.sphinx.chat");
  });

  it("sets Cache-Control: private, no-store on every response", async () => {
    const githubLogin = `advisor-cachehdr-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedUser("advisor-owner-cache");

    const res = await postAs(githubLogin, owner);
    expect((res as Response).headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("never returns a token/key field and never decrypts swarmApiKey", async () => {
    const githubLogin = `advisor-noleak-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedUser("advisor-owner-noleak");
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({ workspaceId: ws.id, swarmUrl: "https://swarm40.sphinx.chat/api", swarmApiKey: "secret-key" });
    await setDefaultWorkspace(org.id, ws.id);

    const res = await postAs(githubLogin, owner);
    const data = await expectJson<Record<string, unknown>>(res, 200);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("secret-key");
    expect(data).not.toHaveProperty("token");
    expect(data).not.toHaveProperty("key");
    expect(data).not.toHaveProperty("swarmApiKey");
  });
});
