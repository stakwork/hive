import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { GET } from "@/app/api/orgs/[githubLogin]/automations/inbox/route";

// ─── helpers ────────────────────────────────────────────────────────────────

let installationIdCounter = 880000;
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

/**
 * createOrgWithWorkspace — creates both the SourceControlOrg and a Workspace
 * owned by `ownerId` so that `validateUserBelongsToOrg` returns true for that
 * user. Returns the org and workspace for cleanup tracking.
 */
async function createOrgWithWorkspace(githubLogin: string, ownerId: string) {
  const org = await createOrg(githubLogin);
  const slug = `ws-inbox-${generateUniqueId()}`;
  const workspace = await db.workspace.create({
    data: {
      name: slug,
      slug,
      ownerId,
      sourceControlOrgId: org.id,
    },
  });
  return { org, workspace };
}

async function createAutomation(
  orgId: string,
  userId: string,
  overrides: {
    lastRunConversationId?: string | null;
    lastRunSeenAt?: Date | null;
    lastRunAt?: Date | null;
  } = {},
) {
  return db.automation.create({
    data: {
      sourceControlOrgId: orgId,
      userId,
      name: `Test Automation ${generateUniqueId()}`,
      prompt: "Test prompt",
      timeOfDay: "09:00",
      timezone: "UTC",
      enabled: true,
      nextRunAt: new Date(Date.now() + 86400_000),
      lastRunAt: overrides.lastRunAt ?? null,
      lastRunConversationId: overrides.lastRunConversationId ?? null,
      lastRunSeenAt: overrides.lastRunSeenAt ?? null,
    },
  });
}

function makeParams(githubLogin: string) {
  return Promise.resolve({ githubLogin });
}

// ─── cleanup ────────────────────────────────────────────────────────────────

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
const createdAutomationIds: string[] = [];
const createdWorkspaceIds: string[] = [];

afterEach(async () => {
  if (createdAutomationIds.length > 0) {
    await db.automation.deleteMany({ where: { id: { in: createdAutomationIds } } });
    createdAutomationIds.length = 0;
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

// ─── tests ──────────────────────────────────────────────────────────────────

describe("GET /api/orgs/[githubLogin]/automations/inbox", () => {
  it("returns count=0 and empty runs when no unseen automations", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const { org, workspace } = await createOrgWithWorkspace(
      `inbox-empty-${generateUniqueId()}`,
      user.id,
    );
    createdOrgIds.push(org.id);
    createdWorkspaceIds.push(workspace.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/automations/inbox`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
    );

    const res = await GET(req, { params: makeParams(org.githubLogin) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.runs).toEqual([]);
  });

  it("returns unseen runs with correct shape", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const { org, workspace } = await createOrgWithWorkspace(
      `inbox-shape-${generateUniqueId()}`,
      user.id,
    );
    createdOrgIds.push(org.id);
    createdWorkspaceIds.push(workspace.id);

    const now = new Date();
    const auto = await createAutomation(org.id, user.id, {
      lastRunConversationId: "conv-abc",
      lastRunSeenAt: null,
      lastRunAt: now,
    });
    createdAutomationIds.push(auto.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/automations/inbox`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
    );

    const res = await GET(req, { params: makeParams(org.githubLogin) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({
      automationId: auto.id,
      automationName: auto.name,
      conversationId: "conv-abc",
    });
    expect(body.runs[0].lastRunAt).toBeDefined();
  });

  it("does NOT mark runs as seen as a side effect of GET", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const { org, workspace } = await createOrgWithWorkspace(
      `inbox-nosideeffect-${generateUniqueId()}`,
      user.id,
    );
    createdOrgIds.push(org.id);
    createdWorkspaceIds.push(workspace.id);

    const auto = await createAutomation(org.id, user.id, {
      lastRunConversationId: "conv-xyz",
      lastRunSeenAt: null,
      lastRunAt: new Date(),
    });
    createdAutomationIds.push(auto.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/automations/inbox`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
    );

    await GET(req, { params: makeParams(org.githubLogin) });

    // Verify lastRunSeenAt is still null after the GET
    const refreshed = await db.automation.findUnique({ where: { id: auto.id } });
    expect(refreshed?.lastRunSeenAt).toBeNull();
  });

  it("respects the take=20 limit", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const { org, workspace } = await createOrgWithWorkspace(
      `inbox-limit-${generateUniqueId()}`,
      user.id,
    );
    createdOrgIds.push(org.id);
    createdWorkspaceIds.push(workspace.id);

    // Create 25 unseen automations
    for (let i = 0; i < 25; i++) {
      const a = await createAutomation(org.id, user.id, {
        lastRunConversationId: `conv-${i}`,
        lastRunSeenAt: null,
        lastRunAt: new Date(Date.now() - i * 1000),
      });
      createdAutomationIds.push(a.id);
    }

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/automations/inbox`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
    );

    const res = await GET(req, { params: makeParams(org.githubLogin) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // runs list is capped at 20 by the route's take limit
    expect(body.runs).toHaveLength(20);
  });

  it("excludes automations that have already been seen", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const { org, workspace } = await createOrgWithWorkspace(
      `inbox-seen-${generateUniqueId()}`,
      user.id,
    );
    createdOrgIds.push(org.id);
    createdWorkspaceIds.push(workspace.id);

    // Unseen
    const unseen = await createAutomation(org.id, user.id, {
      lastRunConversationId: "conv-unseen",
      lastRunSeenAt: null,
      lastRunAt: new Date(),
    });
    createdAutomationIds.push(unseen.id);

    // Already seen
    const seen = await createAutomation(org.id, user.id, {
      lastRunConversationId: "conv-seen",
      lastRunSeenAt: new Date(Date.now() - 60_000),
      lastRunAt: new Date(Date.now() - 120_000),
    });
    createdAutomationIds.push(seen.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/automations/inbox`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
    );

    const res = await GET(req, { params: makeParams(org.githubLogin) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.runs[0].automationId).toBe(unseen.id);
  });

  it("returns 404 when user is not a member of the org", async () => {
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const outsider = await createTestUser();
    createdUserIds.push(outsider.id);
    const { org, workspace } = await createOrgWithWorkspace(
      `inbox-nonmember-${generateUniqueId()}`,
      owner.id,
    );
    createdOrgIds.push(org.id);
    createdWorkspaceIds.push(workspace.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/automations/inbox`,
      { id: outsider.id, email: outsider.email ?? "", name: outsider.name ?? "" },
    );

    const res = await GET(req, { params: makeParams(org.githubLogin) });
    expect(res.status).toBe(404);
  });

  it("requires authentication independently (returns 401 without auth headers)", async () => {
    const org = await createOrg(`inbox-noauth-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    // Plain unauthenticated request (no middleware headers)
    const req = new (await import("next/server")).NextRequest(
      `http://localhost/api/orgs/${org.githubLogin}/automations/inbox`,
    );

    const res = await GET(req, { params: makeParams(org.githubLogin) });
    expect(res.status).toBe(401);
  });
});
