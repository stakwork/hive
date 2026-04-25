import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPatchRequest,
  createGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestFeature } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { PATCH, DELETE } from "@/app/api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]/route";
import { GET as searchFeatures } from "@/app/api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]/features/search/route";

// ─── helpers ────────────────────────────────────────────────────────────────

let installationIdCounter = 900100;
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

async function createWorkspaceInOrg(ownerId: string, orgId: string) {
  const slug = `ms-lf-ws-${generateUniqueId()}`;
  return db.workspace.create({
    data: {
      name: slug,
      slug,
      ownerId,
      sourceControlOrgId: orgId,
    },
  });
}

async function createInitiative(orgId: string) {
  return db.initiative.create({
    data: {
      orgId,
      name: `Initiative ${generateUniqueId()}`,
      status: "ACTIVE",
    },
  });
}

async function createMilestone(initiativeId: string, seq = 1) {
  return db.milestone.create({
    data: {
      initiativeId,
      name: `Milestone ${generateUniqueId()}`,
      sequence: seq,
      status: "NOT_STARTED",
    },
  });
}

function makeParams(githubLogin: string, initiativeId: string, milestoneId: string) {
  return Promise.resolve({ githubLogin, initiativeId, milestoneId });
}

// ─── cleanup tracking ───────────────────────────────────────────────────────

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];
const createdInitiativeIds: string[] = [];
const createdMilestoneIds: string[] = [];
const createdFeatureIds: string[] = [];

afterEach(async () => {
  if (createdFeatureIds.length > 0) {
    await db.feature.deleteMany({ where: { id: { in: createdFeatureIds } } });
    createdFeatureIds.length = 0;
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
    await db.workspaceMember.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
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

// ─── PATCH milestone — featureId linking ────────────────────────────────────

describe("PATCH /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId] — featureId", () => {
  it("links a feature to a milestone and returns feature in response", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const org = await createOrg(`ms-lf-org-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const workspace = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(workspace.id);

    const initiative = await createInitiative(org.id);
    createdInitiativeIds.push(initiative.id);

    const milestone = await createMilestone(initiative.id);
    createdMilestoneIds.push(milestone.id);

    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      title: "Feature to link",
    });
    createdFeatureIds.push(feature.id);

    const req = createAuthenticatedPatchRequest(
      `http://localhost/api/orgs/${org.githubLogin}/initiatives/${initiative.id}/milestones/${milestone.id}`,
      { featureId: feature.id },
      user,
    );

    const res = await PATCH(req, { params: makeParams(org.githubLogin, initiative.id, milestone.id) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.feature).not.toBeNull();
    expect(body.feature.id).toBe(feature.id);
    expect(body.feature.title).toBe("Feature to link");
    expect(body.feature.workspace.id).toBe(workspace.id);
  });

  it("unlinks a feature from a milestone when featureId is null", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const org = await createOrg(`ms-lf-org-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const workspace = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(workspace.id);

    const initiative = await createInitiative(org.id);
    createdInitiativeIds.push(initiative.id);

    // Create milestone already linked to a feature
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      title: "Feature to unlink",
    });
    createdFeatureIds.push(feature.id);

    const milestone = await db.milestone.create({
      data: {
        initiativeId: initiative.id,
        name: `Milestone ${generateUniqueId()}`,
        sequence: 2,
        status: "NOT_STARTED",
        features: { connect: { id: feature.id } },
      },
    });
    createdMilestoneIds.push(milestone.id);

    const req = createAuthenticatedPatchRequest(
      `http://localhost/api/orgs/${org.githubLogin}/initiatives/${initiative.id}/milestones/${milestone.id}`,
      { featureId: null },
      user,
    );

    const res = await PATCH(req, { params: makeParams(org.githubLogin, initiative.id, milestone.id) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.feature).toBeNull();
  });

  it("returns 401 for unauthenticated PATCH", async () => {
    const req = createGetRequest(
      "http://localhost/api/orgs/some-org/initiatives/init-id/milestones/ms-id",
    );
    // Use the unauthenticated request as PATCH - just checking auth guard
    const res = await PATCH(req as any, {
      params: makeParams("some-org", "init-id", "ms-id"),
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET feature search ──────────────────────────────────────────────────────

describe("GET /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]/features/search", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const req = createGetRequest(
      "http://localhost/api/orgs/some-org/initiatives/init-id/milestones/ms-id/features/search",
    );
    const res = await searchFeatures(req, {
      params: makeParams("some-org", "init-id", "ms-id"),
    });
    expect(res.status).toBe(401);
  });

  it("returns empty array when query is less than 3 characters", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const org = await createOrg(`ms-lf-org-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const workspace = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(workspace.id);

    const initiative = await createInitiative(org.id);
    createdInitiativeIds.push(initiative.id);

    const milestone = await createMilestone(initiative.id);
    createdMilestoneIds.push(milestone.id);

    // Create a feature that WOULD match if query were applied
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      title: "AB should not appear",
    });
    createdFeatureIds.push(feature.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/initiatives/${initiative.id}/milestones/${milestone.id}/features/search`,
      user,
      { query: "AB" },
    );

    const res = await searchFeatures(req, {
      params: makeParams(org.githubLogin, initiative.id, milestone.id),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("returns features across org workspaces ordered by updatedAt desc", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const org = await createOrg(`ms-lf-org-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const workspace1 = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(workspace1.id);
    const workspace2 = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(workspace2.id);

    const initiative = await createInitiative(org.id);
    createdInitiativeIds.push(initiative.id);

    const milestone = await createMilestone(initiative.id);
    createdMilestoneIds.push(milestone.id);

    const uniquePrefix = `srch-${generateUniqueId()}`;

    const featureOlder = await createTestFeature({
      workspaceId: workspace1.id,
      createdById: user.id,
      updatedById: user.id,
      title: `${uniquePrefix} older feature`,
    });
    createdFeatureIds.push(featureOlder.id);

    // Bump updatedAt on the second feature to be newer
    const featureNewer = await db.feature.create({
      data: {
        title: `${uniquePrefix} newer feature`,
        brief: "brief",
        workspaceId: workspace2.id,
        createdById: user.id,
        updatedById: user.id,
        status: "BACKLOG",
        priority: "LOW",
        updatedAt: new Date(Date.now() + 10000),
      },
    });
    createdFeatureIds.push(featureNewer.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/initiatives/${initiative.id}/milestones/${milestone.id}/features/search`,
      user,
      { query: uniquePrefix },
    );

    const res = await searchFeatures(req, {
      params: makeParams(org.githubLogin, initiative.id, milestone.id),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.length).toBe(2);
    // Should be ordered by updatedAt desc — newer first
    expect(body[0].id).toBe(featureNewer.id);
    expect(body[1].id).toBe(featureOlder.id);

    // Each result must include workspace info
    expect(body[0].workspace).toBeDefined();
    expect(body[0].workspace.id).toBe(workspace2.id);
  });

  it("filters results by workspaceId when provided", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const org = await createOrg(`ms-lf-org-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const workspace1 = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(workspace1.id);
    const workspace2 = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(workspace2.id);

    const initiative = await createInitiative(org.id);
    createdInitiativeIds.push(initiative.id);

    const milestone = await createMilestone(initiative.id);
    createdMilestoneIds.push(milestone.id);

    const uniquePrefix = `filter-${generateUniqueId()}`;

    const featureW1 = await createTestFeature({
      workspaceId: workspace1.id,
      createdById: user.id,
      updatedById: user.id,
      title: `${uniquePrefix} ws1 feature`,
    });
    createdFeatureIds.push(featureW1.id);

    const featureW2 = await createTestFeature({
      workspaceId: workspace2.id,
      createdById: user.id,
      updatedById: user.id,
      title: `${uniquePrefix} ws2 feature`,
    });
    createdFeatureIds.push(featureW2.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/initiatives/${initiative.id}/milestones/${milestone.id}/features/search`,
      user,
      { query: uniquePrefix, workspaceId: workspace1.id },
    );

    const res = await searchFeatures(req, {
      params: makeParams(org.githubLogin, initiative.id, milestone.id),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const ids = body.map((f: any) => f.id);
    expect(ids).toContain(featureW1.id);
    expect(ids).not.toContain(featureW2.id);
  });

  it("returns 404 when org does not exist", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/nonexistent-org-xyz/initiatives/init-id/milestones/ms-id/features/search`,
      user,
      { query: "test" },
    );

    const res = await searchFeatures(req, {
      params: makeParams("nonexistent-org-xyz", "init-id", "ms-id"),
    });
    expect(res.status).toBe(404);
  });
});
