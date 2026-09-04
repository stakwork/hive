import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createAuthenticatedPutRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { GET as getConversations } from "@/app/api/orgs/[githubLogin]/chat/conversations/route";
import {
  GET as getConversation,
  PUT as putConversation,
} from "@/app/api/orgs/[githubLogin]/chat/conversations/[conversationId]/route";
import { POST as archiveConversation } from "@/app/api/orgs/[githubLogin]/chat/conversations/[conversationId]/archive/route";

let installationIdCounter = 981000;
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
  const slug = `ws-archive-${generateUniqueId()}`;
  return db.workspace.create({
    data: { name: slug, slug, ownerId, sourceControlOrgId: orgId },
  });
}

function listParams(githubLogin: string) {
  return Promise.resolve({ githubLogin });
}

function detailParams(githubLogin: string, conversationId: string) {
  return Promise.resolve({ githubLogin, conversationId });
}

const sampleMessages = [
  { role: "user", content: "Hello canvas agent" },
  { role: "assistant", content: "Hi there!" },
];

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];
const createdConversationIds: string[] = [];

afterEach(async () => {
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

async function createOrgCanvasConversation(opts: {
  orgId: string;
  userId: string;
  title?: string;
  source?: string;
  archivedAt?: Date | null;
  isShared?: boolean;
  workspaceId?: string | null;
}) {
  const conv = await db.sharedConversation.create({
    data: {
      sourceControlOrgId: opts.orgId,
      userId: opts.userId,
      workspaceId: opts.workspaceId ?? null,
      messages: sampleMessages as object[],
      title: opts.title ?? "Archive test chat",
      source: opts.source ?? "org-canvas",
      followUpQuestions: [],
      lastMessageAt: new Date(),
      archivedAt: opts.archivedAt ?? null,
      isShared: opts.isShared ?? false,
    },
  });
  createdConversationIds.push(conv.id);
  return conv;
}

describe("POST /api/orgs/[githubLogin]/chat/conversations/[conversationId]/archive", () => {
  it("archives and restores an org-canvas conversation owned by the caller", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-archive-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);
    const conv = await createOrgCanvasConversation({ orgId: org.id, userId: user.id });

    const archiveReq = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/archive`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      { archived: true },
    );
    const archiveRes = await archiveConversation(archiveReq, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(archiveRes.status).toBe(200);
    expect(await archiveRes.json()).toEqual({ ok: true });

    const archived = await db.sharedConversation.findUnique({ where: { id: conv.id } });
    expect(archived!.archivedAt).toBeInstanceOf(Date);

    const restoreReq = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/archive`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      { archived: false },
    );
    const restoreRes = await archiveConversation(restoreReq, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(restoreRes.status).toBe(200);

    const restored = await db.sharedConversation.findUnique({ where: { id: conv.id } });
    expect(restored!.archivedAt).toBeNull();
  });

  it("ignores extra body keys and never copies a client-supplied archivedAt", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-archive-extra-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);
    const conv = await createOrgCanvasConversation({ orgId: org.id, userId: user.id });

    const clientStamp = new Date("2020-01-01T00:00:00Z");
    const before = Date.now();
    const req = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/archive`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      { archived: true, archivedAt: clientStamp.toISOString(), title: "hijack" },
    );
    const res = await archiveConversation(req, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(res.status).toBe(200);

    const row = await db.sharedConversation.findUnique({ where: { id: conv.id } });
    expect(row!.title).toBe("Archive test chat");
    expect(row!.archivedAt).toBeInstanceOf(Date);
    expect(row!.archivedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(row!.archivedAt!.getTime()).not.toBe(clientStamp.getTime());
  });

  it("returns 400 when archived is missing or not a boolean", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-archive-400-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);
    const conv = await createOrgCanvasConversation({ orgId: org.id, userId: user.id });

    const auth = { id: user.id, email: user.email ?? "", name: user.name ?? "" };
    const url = `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/archive`;

    const missing = await archiveConversation(
      createAuthenticatedPostRequest(url, auth, {}),
      { params: detailParams(org.githubLogin, conv.id) },
    );
    expect(missing.status).toBe(400);

    const stringed = await archiveConversation(
      createAuthenticatedPostRequest(url, auth, { archived: "true" }),
      { params: detailParams(org.githubLogin, conv.id) },
    );
    expect(stringed.status).toBe(400);

    const nulled = await archiveConversation(
      createAuthenticatedPostRequest(url, auth, { archived: null }),
      { params: detailParams(org.githubLogin, conv.id) },
    );
    expect(nulled.status).toBe(400);
  });

  it("returns 404 (IDOR) when another org member tries to archive the owner's chat", async () => {
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const joiner = await createTestUser();
    createdUserIds.push(joiner.id);
    const org = await createOrg(`test-org-archive-idor-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await db.workspaceMember.create({
      data: { workspaceId: ws.id, userId: joiner.id, role: "VIEWER" },
    });
    const conv = await createOrgCanvasConversation({
      orgId: org.id,
      userId: owner.id,
      isShared: true,
    });

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/archive`,
      { id: joiner.id, email: joiner.email ?? "", name: joiner.name ?? "" },
      { archived: true },
    );
    const res = await archiveConversation(req, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(res.status).toBe(404);

    const row = await db.sharedConversation.findUnique({ where: { id: conv.id } });
    expect(row!.archivedAt).toBeNull();
  });

  it("returns 404 for a conversation in a different org", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const orgA = await createOrg(`test-org-archive-a-${generateUniqueId()}`);
    createdOrgIds.push(orgA.id);
    const orgB = await createOrg(`test-org-archive-b-${generateUniqueId()}`);
    createdOrgIds.push(orgB.id);
    const wsA = await createWorkspaceInOrg(user.id, orgA.id);
    createdWorkspaceIds.push(wsA.id);
    const wsB = await createWorkspaceInOrg(user.id, orgB.id);
    createdWorkspaceIds.push(wsB.id);
    const conv = await createOrgCanvasConversation({ orgId: orgA.id, userId: user.id });

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${orgB.githubLogin}/chat/conversations/${conv.id}/archive`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      { archived: true },
    );
    const res = await archiveConversation(req, {
      params: detailParams(orgB.githubLogin, conv.id),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-org-canvas conversation", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-archive-src-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);
    const conv = await createOrgCanvasConversation({
      orgId: org.id,
      userId: user.id,
      source: "dashboard",
      workspaceId: ws.id,
    });

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/archive`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      { archived: true },
    );
    const res = await archiveConversation(req, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(res.status).toBe(404);
  });
});

describe("archived conversations stay readable and appendable", () => {
  it("GET list omits archived rows", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-archive-list-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const active = await createOrgCanvasConversation({
      orgId: org.id,
      userId: user.id,
      title: "Active",
    });
    await createOrgCanvasConversation({
      orgId: org.id,
      userId: user.id,
      title: "Archived",
      archivedAt: new Date(),
    });

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
    );
    const res = await getConversations(req, { params: listParams(org.githubLogin) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(active.id);
  });

  it("GET-by-id still returns an archived conversation", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-archive-get-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);
    const conv = await createOrgCanvasConversation({
      orgId: org.id,
      userId: user.id,
      archivedAt: new Date(),
    });

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
    );
    const res = await getConversation(req, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(conv.id);
    expect(body.messages).toHaveLength(2);
  });

  it("PUT append on an archived row leaves archivedAt untouched", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-archive-put-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);
    const archivedAt = new Date("2026-01-15T12:00:00Z");
    const conv = await createOrgCanvasConversation({
      orgId: org.id,
      userId: user.id,
      archivedAt,
    });

    const req = createAuthenticatedPutRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      { messages: [{ role: "user", content: "Follow-up on archived chat" }] },
    );
    const res = await putConversation(req, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(res.status).toBe(200);

    const updated = await db.sharedConversation.findUnique({ where: { id: conv.id } });
    expect(updated!.archivedAt).toEqual(archivedAt);
    const msgs = updated!.messages as { content: string }[];
    expect(msgs).toHaveLength(3);
    expect(msgs[2].content).toBe("Follow-up on archived chat");
  });
});
