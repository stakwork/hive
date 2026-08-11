import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { POST } from "@/app/api/orgs/[githubLogin]/automations/[automationId]/seen/route";

// ─── helpers ────────────────────────────────────────────────────────────────

let installationIdCounter = 890000;
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
  const slug = `ws-seen-${generateUniqueId()}`;
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

async function createAutomation(orgId: string, userId: string) {
  return db.automation.create({
    data: {
      sourceControlOrgId: orgId,
      userId,
      name: `Seen Test Automation ${generateUniqueId()}`,
      prompt: "Test prompt",
      timeOfDay: "09:00",
      timezone: "UTC",
      enabled: true,
      nextRunAt: new Date(Date.now() + 86400_000),
      lastRunAt: new Date(),
      lastRunConversationId: `conv-${generateUniqueId()}`,
      lastRunSeenAt: null,
    },
  });
}

function makeParams(githubLogin: string, automationId: string) {
  return Promise.resolve({ githubLogin, automationId });
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

describe("POST /api/orgs/[githubLogin]/automations/[automationId]/seen", () => {
  it("marks the automation as seen and returns ok", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const { org, workspace } = await createOrgWithWorkspace(
      `seen-ok-${generateUniqueId()}`,
      user.id,
    );
    createdOrgIds.push(org.id);
    createdWorkspaceIds.push(workspace.id);
    const auto = await createAutomation(org.id, user.id);
    createdAutomationIds.push(auto.id);

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${org.githubLogin}/automations/${auto.id}/seen`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      {},
    );

    const res = await POST(req, { params: makeParams(org.githubLogin, auto.id) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const refreshed = await db.automation.findUnique({ where: { id: auto.id } });
    expect(refreshed?.lastRunSeenAt).not.toBeNull();
  });

  it("returns 404 when automationId belongs to a different user (IDOR check)", async () => {
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const attacker = await createTestUser();
    createdUserIds.push(attacker.id);
    const { org, workspace } = await createOrgWithWorkspace(
      `seen-idor-${generateUniqueId()}`,
      owner.id,
    );
    createdOrgIds.push(org.id);
    createdWorkspaceIds.push(workspace.id);

    // Add attacker as member so they pass the org-membership check
    const attackerMembership = await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: attacker.id,
        role: "DEVELOPER",
        joinedAt: new Date(),
      },
    });

    // Automation owned by owner, not attacker
    const auto = await createAutomation(org.id, owner.id);
    createdAutomationIds.push(auto.id);

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${org.githubLogin}/automations/${auto.id}/seen`,
      { id: attacker.id, email: attacker.email ?? "", name: attacker.name ?? "" },
      {},
    );

    const res = await POST(req, { params: makeParams(org.githubLogin, auto.id) });
    // Must return 404 — cannot distinguish "not found" from "not yours"
    expect(res.status).toBe(404);

    // Confirm DB was NOT mutated
    const refreshed = await db.automation.findUnique({ where: { id: auto.id } });
    expect(refreshed?.lastRunSeenAt).toBeNull();

    // Cleanup membership
    await db.workspaceMember.delete({ where: { id: attackerMembership.id } });
  });

  it("returns 404 when automationId belongs to a different org (IDOR check)", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const { org: orgA, workspace: wsA } = await createOrgWithWorkspace(
      `seen-idor-orgA-${generateUniqueId()}`,
      user.id,
    );
    createdOrgIds.push(orgA.id);
    createdWorkspaceIds.push(wsA.id);

    const orgB = await createOrg(`seen-idor-orgB-${generateUniqueId()}`);
    createdOrgIds.push(orgB.id);

    // Automation in orgB — user is NOT a member of orgB
    const auto = await createAutomation(orgB.id, user.id);
    createdAutomationIds.push(auto.id);

    // Call against orgA but with auto belonging to orgB
    const req = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${orgA.githubLogin}/automations/${auto.id}/seen`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      {},
    );

    const res = await POST(req, { params: makeParams(orgA.githubLogin, auto.id) });
    expect(res.status).toBe(404);

    const refreshed = await db.automation.findUnique({ where: { id: auto.id } });
    expect(refreshed?.lastRunSeenAt).toBeNull();
  });

  it("returns 404 when user is not a member of the org", async () => {
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const outsider = await createTestUser();
    createdUserIds.push(outsider.id);
    const { org, workspace } = await createOrgWithWorkspace(
      `seen-nonmember-${generateUniqueId()}`,
      owner.id,
    );
    createdOrgIds.push(org.id);
    createdWorkspaceIds.push(workspace.id);

    const auto = await createAutomation(org.id, owner.id);
    createdAutomationIds.push(auto.id);

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${org.githubLogin}/automations/${auto.id}/seen`,
      { id: outsider.id, email: outsider.email ?? "", name: outsider.name ?? "" },
      {},
    );

    const res = await POST(req, { params: makeParams(org.githubLogin, auto.id) });
    expect(res.status).toBe(404);
  });

  it("requires authentication independently (returns 401 without auth headers)", async () => {
    const org = await createOrg(`seen-noauth-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const req = new (await import("next/server")).NextRequest(
      `http://localhost/api/orgs/${org.githubLogin}/automations/fake-id/seen`,
      { method: "POST" },
    );

    const res = await POST(req, {
      params: makeParams(org.githubLogin, "fake-id"),
    });
    expect(res.status).toBe(401);
  });

  it("is idempotent — marking seen twice still returns ok", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const { org, workspace } = await createOrgWithWorkspace(
      `seen-idempotent-${generateUniqueId()}`,
      user.id,
    );
    createdOrgIds.push(org.id);
    createdWorkspaceIds.push(workspace.id);
    const auto = await createAutomation(org.id, user.id);
    createdAutomationIds.push(auto.id);

    const makeReq = () =>
      createAuthenticatedPostRequest(
        `http://localhost/api/orgs/${org.githubLogin}/automations/${auto.id}/seen`,
        { id: user.id, email: user.email ?? "", name: user.name ?? "" },
        {},
      );

    const res1 = await POST(makeReq(), { params: makeParams(org.githubLogin, auto.id) });
    expect(res1.status).toBe(200);

    // Second call: lastRunSeenAt already set — updateMany still matches 1 row
    const res2 = await POST(makeReq(), { params: makeParams(org.githubLogin, auto.id) });
    expect(res2.status).toBe(200);
  });
});
