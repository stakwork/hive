import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestFeature } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { GET as getControlPanel } from "@/app/api/orgs/[githubLogin]/control-panel/route";

let installationIdCounter = 982000;
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
  const slug = `ws-cp-${generateUniqueId()}`;
  return db.workspace.create({
    data: { name: slug, slug, ownerId, sourceControlOrgId: orgId },
  });
}

function listParams(githubLogin: string) {
  return Promise.resolve({ githubLogin });
}

const sampleMessages = [
  { role: "user", content: "Hello canvas agent" },
  { role: "assistant", content: "Hi there!" },
];

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];
const createdConversationIds: string[] = [];
const createdFeatureIds: string[] = [];

afterEach(async () => {
  if (createdFeatureIds.length > 0) {
    await db.feature.deleteMany({ where: { id: { in: createdFeatureIds } } });
    createdFeatureIds.length = 0;
  }
  if (createdConversationIds.length > 0) {
    await db.sharedConversation.deleteMany({
      where: { id: { in: createdConversationIds } },
    });
    createdConversationIds.length = 0;
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

describe("GET /api/orgs/[githubLogin]/control-panel", () => {
  it("returns archivedItems without a query param; active items and chats.total stay active-only", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-cp-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const active = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: user.id,
        workspaceId: null,
        messages: sampleMessages as object[],
        title: "Active chat",
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: new Date(),
      },
    });
    createdConversationIds.push(active.id);

    const archived = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: user.id,
        workspaceId: null,
        messages: sampleMessages as object[],
        title: "Archived chat",
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: new Date("2026-01-01T00:00:00Z"),
        archivedAt: new Date("2026-02-01T00:00:00Z"),
      },
    });
    createdConversationIds.push(archived.id);

    const nestedPlan = await createTestFeature({
      title: "Archived nested plan",
      workspaceId: ws.id,
      createdById: user.id,
      updatedById: user.id,
    });
    createdFeatureIds.push(nestedPlan.id);
    await db.feature.update({
      where: { id: nestedPlan.id },
      data: { parentCanvasConversationId: archived.id },
    });

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/control-panel`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
    );
    const res = await getControlPanel(req, { params: listParams(org.githubLogin) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(Array.isArray(body.archivedItems)).toBe(true);

    const activeChatIds = body.items.filter((i: { kind: string }) => i.kind === "chat").map((i: { id: string }) => i.id);
    expect(activeChatIds).toEqual([active.id]);
    expect(body.items.some((i: { id: string }) => i.id === archived.id)).toBe(false);
    expect(body.items.some((i: { id: string }) => i.id === nestedPlan.id)).toBe(false);

    expect(body.chats.total).toBe(1);
    expect(body.chats.shown).toBe(1);

    const archivedChats = body.archivedItems.filter((i: { kind: string }) => i.kind === "chat");
    expect(archivedChats).toHaveLength(1);
    expect(archivedChats[0].id).toBe(archived.id);
    expect(archivedChats[0].archivedAt).toBe("2026-02-01T00:00:00.000Z");

    const archivedPlans = body.archivedItems.filter((i: { kind: string }) => i.kind === "plan");
    expect(archivedPlans).toHaveLength(1);
    expect(archivedPlans[0].id).toBe(nestedPlan.id);
    expect(archivedPlans[0].parentChatId).toBe(archived.id);
  });

  it("returns 404 for a non-member", async () => {
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const outsider = await createTestUser();
    createdUserIds.push(outsider.id);
    const org = await createOrg(`test-org-cp-nm-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/control-panel`,
      { id: outsider.id, email: outsider.email ?? "", name: outsider.name ?? "" },
    );
    const res = await getControlPanel(req, { params: listParams(org.githubLogin) });
    expect(res.status).toBe(404);
  });
});
