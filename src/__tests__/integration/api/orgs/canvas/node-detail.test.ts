import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { GET } from "@/app/api/orgs/[githubLogin]/canvas/node/[liveId]/route";

let installationIdCounter = 920100;
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
      avatarUrl: `https://avatars.githubusercontent.com/u/${nextInstallationId()}?v=4`,
    },
  });
}

async function createWorkspaceInOrg(ownerId: string, orgId: string, slugPrefix = "ws") {
  const slug = `${slugPrefix}-${generateUniqueId()}`;
  return db.workspace.create({
    data: {
      name: slug,
      slug,
      ownerId,
      sourceControlOrgId: orgId,
      description: "Workspace description for tests",
    },
  });
}

function makeParams(githubLogin: string, liveId: string) {
  return Promise.resolve({ githubLogin, liveId });
}

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];
const createdInitiativeIds: string[] = [];
const createdMilestoneIds: string[] = [];
const createdHtmlPageIds: string[] = [];

afterEach(async () => {
  if (createdHtmlPageIds.length > 0) {
    await db.htmlPage.deleteMany({ where: { id: { in: createdHtmlPageIds } } });
    createdHtmlPageIds.length = 0;
  }
  if (createdMilestoneIds.length > 0) {
    await db.milestone.deleteMany({ where: { id: { in: createdMilestoneIds } } });
    createdMilestoneIds.length = 0;
  }
  if (createdInitiativeIds.length > 0) {
    await db.initiative.deleteMany({ where: { id: { in: createdInitiativeIds } } });
    createdInitiativeIds.length = 0;
  }
  if (createdWorkspaceIds.length > 0) {
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

describe("GET /api/orgs/[githubLogin]/canvas/node/[liveId]", () => {
  it("returns 400 for an unparseable live id", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const request = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLogin}/canvas/node/not-a-live-id`,
      user,
    );
    const res = await GET(request, { params: makeParams(githubLogin, "not-a-live-id") });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown org", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const request = createAuthenticatedGetRequest(
      "http://localhost:3000/api/orgs/missing-org/canvas/node/ws:abc",
      user,
    );
    const res = await GET(request, { params: makeParams("missing-org", "ws:abc") });
    expect(res.status).toBe(404);
  });

  it("returns workspace detail for a live ws: id in the same org", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const liveId = `ws:${ws.id}`;
    const request = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLogin}/canvas/node/${encodeURIComponent(liveId)}`,
      user,
    );
    const res = await GET(request, { params: makeParams(githubLogin, liveId) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("workspace");
    expect(body.id).toBe(ws.id);
    expect(body.name).toBe(ws.name);
    expect(body.description).toBe("Workspace description for tests");
    expect(body.extras.slug).toBe(ws.slug);
  });

  it("returns 404 when looking up a workspace that belongs to a different org (cross-org guard)", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const githubLoginA = `org-a-${generateUniqueId()}`;
    const orgA = await createOrg(githubLoginA);
    createdOrgIds.push(orgA.id);

    const githubLoginB = `org-b-${generateUniqueId()}`;
    const orgB = await createOrg(githubLoginB);
    createdOrgIds.push(orgB.id);

    // Workspace lives in orgB.
    const ws = await createWorkspaceInOrg(user.id, orgB.id);
    createdWorkspaceIds.push(ws.id);

    const liveId = `ws:${ws.id}`;
    // Look it up via orgA's URL — should 404 even though the user is
    // authenticated and the workspace exists.
    const request = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLoginA}/canvas/node/${encodeURIComponent(liveId)}`,
      user,
    );
    const res = await GET(request, { params: makeParams(githubLoginA, liveId) });
    expect(res.status).toBe(404);
  });

  it("returns initiative detail with description for a live initiative: id", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const init = await db.initiative.create({
      data: {
        orgId: org.id,
        name: "Reduce Token Cost",
        description: "Cut token usage by 50% on the agent path.",
        status: "ACTIVE",
      },
    });
    createdInitiativeIds.push(init.id);

    const liveId = `initiative:${init.id}`;
    const request = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLogin}/canvas/node/${encodeURIComponent(liveId)}`,
      user,
    );
    const res = await GET(request, { params: makeParams(githubLogin, liveId) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("initiative");
    expect(body.id).toBe(init.id);
    expect(body.name).toBe("Reduce Token Cost");
    expect(body.description).toBe("Cut token usage by 50% on the agent path.");
    expect(body.extras.status).toBe("ACTIVE");
    expect(body.extras.milestoneCount).toBe(0);
  });

  it("returns 404 for an initiative in a different org (cross-org guard)", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const githubLoginA = `org-a-${generateUniqueId()}`;
    const orgA = await createOrg(githubLoginA);
    createdOrgIds.push(orgA.id);

    const githubLoginB = `org-b-${generateUniqueId()}`;
    const orgB = await createOrg(githubLoginB);
    createdOrgIds.push(orgB.id);

    const init = await db.initiative.create({
      data: { orgId: orgB.id, name: "B init", status: "DRAFT" },
    });
    createdInitiativeIds.push(init.id);

    const liveId = `initiative:${init.id}`;
    const request = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLoginA}/canvas/node/${encodeURIComponent(liveId)}`,
      user,
    );
    const res = await GET(request, { params: makeParams(githubLoginA, liveId) });
    expect(res.status).toBe(404);
  });

  it("returns milestone detail when the parent initiative is in this org", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const init = await db.initiative.create({
      data: { orgId: org.id, name: "Init", status: "ACTIVE" },
    });
    createdInitiativeIds.push(init.id);

    const ms = await db.milestone.create({
      data: {
        initiativeId: init.id,
        name: "MVP",
        description: "First public release.",
        sequence: 1,
        status: "IN_PROGRESS",
      },
    });
    createdMilestoneIds.push(ms.id);

    const liveId = `milestone:${ms.id}`;
    const request = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLogin}/canvas/node/${encodeURIComponent(liveId)}`,
      user,
    );
    const res = await GET(request, { params: makeParams(githubLogin, liveId) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("milestone");
    expect(body.id).toBe(ms.id);
    expect(body.description).toBe("First public release.");
    expect(body.extras.initiative.id).toBe(init.id);
  });

  it("returns 404 for an unknown live id with a known prefix", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const liveId = "initiative:does-not-exist";
    const request = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLogin}/canvas/node/${encodeURIComponent(liveId)}`,
      user,
    );
    const res = await GET(request, { params: makeParams(githubLogin, liveId) });
    expect(res.status).toBe(404);
  });

  it("returns html page detail with slug in extras for a live html: id", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const page = await db.htmlPage.create({
      data: {
        orgId: org.id,
        slug: "hive-vs-workspaces",
        title: "Hive vs Workspaces",
        s3Key: `orgs/${org.id}/canvas/hive-vs-workspaces.html`,
        size: 128,
        contentType: "text/html; charset=utf-8",
        createdBy: user.id,
      },
    });
    createdHtmlPageIds.push(page.id);

    const liveId = `html:${page.id}`;
    const request = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLogin}/canvas/node/${encodeURIComponent(liveId)}`,
      user,
    );
    const res = await GET(request, { params: makeParams(githubLogin, liveId) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("html");
    expect(body.id).toBe(page.id);
    expect(body.name).toBe("Hive vs Workspaces");
    expect(body.extras.slug).toBe("hive-vs-workspaces");
    expect(body.extras).not.toHaveProperty("shareRef");
    expect(body.extras).not.toHaveProperty("s3Key");
  });

  it("returns 404 when looking up an html: id that belongs to a different org (cross-org guard)", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const githubLoginA = `org-a-${generateUniqueId()}`;
    const orgA = await createOrg(githubLoginA);
    createdOrgIds.push(orgA.id);
    const wsA = await createWorkspaceInOrg(user.id, orgA.id);
    createdWorkspaceIds.push(wsA.id);

    const githubLoginB = `org-b-${generateUniqueId()}`;
    const orgB = await createOrg(githubLoginB);
    createdOrgIds.push(orgB.id);

    const page = await db.htmlPage.create({
      data: {
        orgId: orgB.id,
        slug: "other-org-page",
        title: "Other Org Page",
        s3Key: `orgs/${orgB.id}/canvas/other-org-page.html`,
        size: 64,
        contentType: "text/html; charset=utf-8",
        createdBy: user.id,
      },
    });
    createdHtmlPageIds.push(page.id);

    const liveId = `html:${page.id}`;
    const request = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLoginA}/canvas/node/${encodeURIComponent(liveId)}`,
      user,
    );
    const res = await GET(request, { params: makeParams(githubLoginA, liveId) });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an authenticated user who is not a member of any workspace under the org (resolveAuthorizedOrgId swap)", async () => {
    // This route now resolves org authorization via `resolveAuthorizedOrgId`
    // instead of `validateUserBelongsToOrg` + a separate org lookup. A
    // signed-in user with no owning/member workspace under the org must
    // still 404 — same as a genuinely unknown org — never leaking that
    // the org (or the node) exists.
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const outsider = await createTestUser();
    createdUserIds.push(outsider.id);

    const githubLogin = `org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const liveId = `ws:${ws.id}`;
    const request = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLogin}/canvas/node/${encodeURIComponent(liveId)}`,
      outsider,
    );
    const res = await GET(request, { params: makeParams(githubLogin, liveId) });
    expect(res.status).toBe(404);
  });
});
