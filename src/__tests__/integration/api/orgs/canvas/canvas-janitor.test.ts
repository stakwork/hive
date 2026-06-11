import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createAuthenticatedPatchRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import {
  JanitorStatus,
  JanitorTrigger,
  CanvasReviewReason,
  CanvasReviewStatus,
  WorkspaceRole,
} from "@prisma/client";

import { GET as getCards } from "@/app/api/orgs/[githubLogin]/canvas/janitor/cards/route";
import { PATCH as patchCard } from "@/app/api/orgs/[githubLogin]/canvas/janitor/cards/[cardId]/route";
import { GET as getConfig, PATCH as patchConfig } from "@/app/api/orgs/[githubLogin]/canvas/janitor/config/route";
import { POST as postRun } from "@/app/api/orgs/[githubLogin]/canvas/janitor/run/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let installationIdCounter = 930_000;
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
  const slug = `cj-test-ws-${generateUniqueId()}`;
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

async function createConfig(orgId: string) {
  return db.canvasJanitorConfig.create({ data: { orgId } });
}

async function createRun(configId: string, status: JanitorStatus = JanitorStatus.COMPLETED) {
  return db.canvasJanitorRun.create({
    data: {
      configId,
      status,
      triggeredBy: JanitorTrigger.MANUAL,
      cardsCreated: 0,
      startedAt: new Date(),
      completedAt: status === JanitorStatus.COMPLETED ? new Date() : undefined,
    },
  });
}

async function createCard(
  orgId: string,
  userId: string,
  runId: string,
  overrides: Partial<{
    reason: CanvasReviewReason;
    status: CanvasReviewStatus;
  }> = {},
) {
  return db.canvasReviewCard.create({
    data: {
      orgId,
      userId,
      runId,
      reason: overrides.reason ?? CanvasReviewReason.STALE_CONTENT,
      status: overrides.status ?? CanvasReviewStatus.PENDING,
      nodeText: "Test note text",
      nodeCategory: "note",
      reasonDetail: "This note appears stale",
      canvasRef: "",
    },
  });
}

function makeParams(githubLogin: string) {
  return Promise.resolve({ githubLogin });
}

function makeCardParams(githubLogin: string, cardId: string) {
  return Promise.resolve({ githubLogin, cardId });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  // Cascade deletes handle janitor data
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

// ---------------------------------------------------------------------------
// GET /api/orgs/[githubLogin]/canvas/janitor/cards
// ---------------------------------------------------------------------------

describe("GET /api/orgs/[githubLogin]/canvas/janitor/cards", () => {
  it("returns 404 for unknown org", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const req = createAuthenticatedGetRequest(
      "/api/orgs/nonexistent-org/canvas/janitor/cards",
      user,
    );
    const res = await getCards(req, { params: makeParams("nonexistent-org") });
    expect(res.status).toBe(404);
  });

  it("returns 404 when user is not a member of the org", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    createdUserIds.push(owner.id, outsider.id);

    const githubLogin = `cj-cards-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedGetRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/cards`,
      outsider,
    );
    const res = await getCards(req, { params: makeParams(githubLogin) });
    expect(res.status).toBe(404);
  });

  it("returns cards for authenticated org member", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `cj-cards-ok-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const config = await createConfig(org.id);
    const run = await createRun(config.id);
    await createCard(org.id, user.id, run.id);
    await createCard(org.id, user.id, run.id);

    const req = createAuthenticatedGetRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/cards`,
      user,
    );
    const res = await getCards(req, { params: makeParams(githubLogin) });
    expect(res.status).toBe(200);
    const body = await res.json() as { cards: unknown[]; pendingCount: number; lastRunAt: string | null };
    expect(body.pendingCount).toBe(2);
    expect(body.cards).toHaveLength(2);
  });

  it("only returns PENDING cards, not DISMISSED ones", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `cj-cards-pending-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const config = await createConfig(org.id);
    const run = await createRun(config.id);
    await createCard(org.id, user.id, run.id, { status: CanvasReviewStatus.PENDING });
    await createCard(org.id, user.id, run.id, { status: CanvasReviewStatus.DISMISSED });

    const req = createAuthenticatedGetRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/cards`,
      user,
    );
    const res = await getCards(req, { params: makeParams(githubLogin) });
    const body = await res.json() as { pendingCount: number };
    expect(body.pendingCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/orgs/[githubLogin]/canvas/janitor/cards/[cardId]
// ---------------------------------------------------------------------------

describe("PATCH /api/orgs/[githubLogin]/canvas/janitor/cards/[cardId]", () => {
  it("returns 403 when card belongs to different user (IDOR guard)", async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();
    createdUserIds.push(owner.id, attacker.id);

    const githubLogin = `cj-patch-idor-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    // attacker is also a member
    await addMember(ws.id, attacker.id);

    const config = await createConfig(org.id);
    const run = await createRun(config.id);
    // Card belongs to owner, not attacker
    const card = await createCard(org.id, owner.id, run.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/cards/${card.id}`,
      { status: "DISMISSED" },
      attacker,
    );
    const res = await patchCard(req, { params: makeCardParams(githubLogin, card.id) });
    expect(res.status).toBe(403);
  });

  it("updates card to DISMISSED for the card owner", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `cj-patch-dismiss-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const config = await createConfig(org.id);
    const run = await createRun(config.id);
    const card = await createCard(org.id, user.id, run.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/cards/${card.id}`,
      { status: "DISMISSED" },
      user,
    );
    const res = await patchCard(req, { params: makeCardParams(githubLogin, card.id) });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; dismissedAt: string | null };
    expect(body.status).toBe("DISMISSED");
    expect(body.dismissedAt).not.toBeNull();
  });

  it("updates card to ACKNOWLEDGED", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `cj-patch-ack-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const config = await createConfig(org.id);
    const run = await createRun(config.id);
    const card = await createCard(org.id, user.id, run.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/cards/${card.id}`,
      { status: "ACKNOWLEDGED" },
      user,
    );
    const res = await patchCard(req, { params: makeCardParams(githubLogin, card.id) });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ACKNOWLEDGED");
  });

  it("updates card to ACTIONED with actionedAt timestamp", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `cj-patch-act-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const config = await createConfig(org.id);
    const run = await createRun(config.id);
    const card = await createCard(org.id, user.id, run.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/cards/${card.id}`,
      { status: "ACTIONED" },
      user,
    );
    const res = await patchCard(req, { params: makeCardParams(githubLogin, card.id) });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; actionedAt: string | null };
    expect(body.status).toBe("ACTIONED");
    expect(body.actionedAt).not.toBeNull();
  });

  it("returns 400 for invalid status value", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `cj-patch-bad-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const config = await createConfig(org.id);
    const run = await createRun(config.id);
    const card = await createCard(org.id, user.id, run.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/cards/${card.id}`,
      { status: "PENDING" }, // not allowed to set back to PENDING
      user,
    );
    const res = await patchCard(req, { params: makeCardParams(githubLogin, card.id) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/orgs/[githubLogin]/canvas/janitor/config
// ---------------------------------------------------------------------------

describe("PATCH /api/orgs/[githubLogin]/canvas/janitor/config", () => {
  it("returns 403 for non-admin member", async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    createdUserIds.push(owner.id, member.id);

    const githubLogin = `cj-cfg-nonadmin-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await addMember(ws.id, member.id, WorkspaceRole.DEVELOPER);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/config`,
      { scheduleIntervalDays: 14 },
      member,
    );
    const res = await patchConfig(req, { params: makeParams(githubLogin) });
    expect(res.status).toBe(403);
  });

  it("allows admin to update config", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `cj-cfg-admin-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/config`,
      { scheduleIntervalDays: 14, enabled: false },
      user,
    );
    const res = await patchConfig(req, { params: makeParams(githubLogin) });
    expect(res.status).toBe(200);
    const body = await res.json() as { scheduleIntervalDays: number; enabled: boolean };
    expect(body.scheduleIntervalDays).toBe(14);
    expect(body.enabled).toBe(false);
  });

  it("returns 400 when scheduleIntervalDays is out of range", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `cj-cfg-badrange-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedPatchRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/config`,
      { scheduleIntervalDays: 0 },
      user,
    );
    const res = await patchConfig(req, { params: makeParams(githubLogin) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/orgs/[githubLogin]/canvas/janitor/run
// ---------------------------------------------------------------------------

describe("POST /api/orgs/[githubLogin]/canvas/janitor/run", () => {
  it("returns 404 for non-member", async () => {
    const outsider = await createTestUser();
    createdUserIds.push(outsider.id);

    const githubLogin = `cj-run-nonmember-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedPostRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/run`,
      outsider,
      {},
    );
    const res = await postRun(req, { params: makeParams(githubLogin) });
    expect(res.status).toBe(404);
  });

  it("returns 409 when a run is already in progress", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `cj-run-409-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const config = await createConfig(org.id);
    // Create a RUNNING run
    await createRun(config.id, JanitorStatus.RUNNING);

    const req = createAuthenticatedPostRequest(
      `/api/orgs/${githubLogin}/canvas/janitor/run`,
      user,
      {},
    );
    const res = await postRun(req, { params: makeParams(githubLogin) });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/already in progress/i);
  });
});
