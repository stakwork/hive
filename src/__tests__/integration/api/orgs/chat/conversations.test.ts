import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createAuthenticatedPutRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import {
  GET as getConversations,
  POST as postConversation,
} from "@/app/api/orgs/[githubLogin]/chat/conversations/route";
import {
  GET as getConversation,
  PUT as putConversation,
} from "@/app/api/orgs/[githubLogin]/chat/conversations/[conversationId]/route";

// ─── helpers ────────────────────────────────────────────────────────────────

let installationIdCounter = 970000;
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
  const slug = `ws-conv-${generateUniqueId()}`;
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

// ─── cleanup ────────────────────────────────────────────────────────────────

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

// ─── tests ──────────────────────────────────────────────────────────────────

describe("POST /api/orgs/[githubLogin]/chat/conversations", () => {
  it("creates a conversation scoped to the org", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-post-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      { messages: sampleMessages },
    );

    const res = await postConversation(req, { params: listParams(org.githubLogin) });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe("Hello canvas agent");
    createdConversationIds.push(body.id);

    const row = await db.sharedConversation.findUnique({ where: { id: body.id } });
    expect(row).not.toBeNull();
    expect(row!.sourceControlOrgId).toBe(org.id);
    expect(row!.userId).toBe(user.id);
    expect(row!.workspaceId).toBeNull();
    expect(row!.source).toBe("org-canvas");
  });

  it("returns 400 when messages is missing", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-post-bad-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      { settings: {} },
    );

    const res = await postConversation(req, { params: listParams(org.githubLogin) });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-member user", async () => {
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const outsider = await createTestUser();
    createdUserIds.push(outsider.id);
    const org = await createOrg(`test-org-post-nonmember-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations`,
      { id: outsider.id, email: outsider.email ?? "", name: outsider.name ?? "" },
      { messages: sampleMessages },
    );

    const res = await postConversation(req, { params: listParams(org.githubLogin) });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/orgs/[githubLogin]/chat/conversations", () => {
  it("returns only the caller's own org-canvas conversations", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const other = await createTestUser();
    createdUserIds.push(other.id);
    const org = await createOrg(`test-org-get-list-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    // user's org-canvas conversation
    const mine = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: user.id,
        workspaceId: null,
        messages: sampleMessages as any,
        title: "Mine",
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: new Date(),
      },
    });
    createdConversationIds.push(mine.id);

    // other user's org-canvas conversation — must NOT be returned
    const theirs = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: other.id,
        workspaceId: null,
        messages: sampleMessages as any,
        title: "Theirs",
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: new Date(),
      },
    });
    createdConversationIds.push(theirs.id);

    // workspace-scoped conversation for same user — must NOT be returned
    const wsConv = await db.sharedConversation.create({
      data: {
        workspaceId: ws.id,
        userId: user.id,
        messages: sampleMessages as any,
        title: "WS Conv",
        source: "dashboard",
        followUpQuestions: [],
        lastMessageAt: new Date(),
      },
    });
    createdConversationIds.push(wsConv.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
    );

    const res = await getConversations(req, { params: listParams(org.githubLogin) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(mine.id);
  });

  it("returns 404 for a non-member", async () => {
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const outsider = await createTestUser();
    createdUserIds.push(outsider.id);
    const org = await createOrg(`test-org-get-list-nm-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations`,
      { id: outsider.id, email: outsider.email ?? "", name: outsider.name ?? "" },
    );

    const res = await getConversations(req, { params: listParams(org.githubLogin) });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/orgs/[githubLogin]/chat/conversations/[conversationId]", () => {
  it("returns full conversation for the owner", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-get-one-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const conv = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: user.id,
        workspaceId: null,
        messages: sampleMessages as any,
        title: "My Conversation",
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: new Date(),
      },
    });
    createdConversationIds.push(conv.id);

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
    expect(body.title).toBe("My Conversation");
    expect(body.messages).toHaveLength(2);
  });

  it("returns 404 (IDOR) when another user requests the conversation", async () => {
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const attacker = await createTestUser();
    createdUserIds.push(attacker.id);
    const org = await createOrg(`test-org-get-one-idor-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    // Make attacker a member so org membership check passes
    await db.workspaceMember.create({
      data: { workspaceId: ws.id, userId: attacker.id, role: "VIEWER" },
    });

    const conv = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: owner.id,
        workspaceId: null,
        messages: sampleMessages as any,
        title: "Owner's Private Conv",
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: new Date(),
      },
    });
    createdConversationIds.push(conv.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}`,
      { id: attacker.id, email: attacker.email ?? "", name: attacker.name ?? "" },
    );

    const res = await getConversation(req, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-member", async () => {
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const outsider = await createTestUser();
    createdUserIds.push(outsider.id);
    const org = await createOrg(`test-org-get-one-nm-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const conv = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: owner.id,
        workspaceId: null,
        messages: sampleMessages as any,
        title: "Conv",
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: new Date(),
      },
    });
    createdConversationIds.push(conv.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}`,
      { id: outsider.id, email: outsider.email ?? "", name: outsider.name ?? "" },
    );

    const res = await getConversation(req, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/orgs/[githubLogin]/chat/conversations/[conversationId]", () => {
  it("appends messages and updates lastMessageAt", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-put-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const originalAt = new Date("2024-01-01T00:00:00Z");
    const conv = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: user.id,
        workspaceId: null,
        messages: sampleMessages as any,
        title: "Conv to update",
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: originalAt,
      },
    });
    createdConversationIds.push(conv.id);

    const newMessages = [{ role: "user", content: "Follow-up question" }];
    const req = createAuthenticatedPutRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      { messages: newMessages },
    );

    const res = await putConversation(req, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(conv.id);
    expect(body.lastMessageAt).not.toBe(originalAt.toISOString());

    const updated = await db.sharedConversation.findUnique({ where: { id: conv.id } });
    const msgs = updated!.messages as any[];
    expect(msgs).toHaveLength(3); // 2 original + 1 appended
    expect(msgs[2].content).toBe("Follow-up question");
  });

  it("returns 404 (IDOR) when a different user tries to PUT", async () => {
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const attacker = await createTestUser();
    createdUserIds.push(attacker.id);
    const org = await createOrg(`test-org-put-idor-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await db.workspaceMember.create({
      data: { workspaceId: ws.id, userId: attacker.id, role: "VIEWER" },
    });

    const conv = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: owner.id,
        workspaceId: null,
        messages: sampleMessages as any,
        title: "Owner only",
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: new Date(),
      },
    });
    createdConversationIds.push(conv.id);

    const req = createAuthenticatedPutRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}`,
      { id: attacker.id, email: attacker.email ?? "", name: attacker.name ?? "" },
      { messages: [{ role: "user", content: "Injected" }] },
    );

    const res = await putConversation(req, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-member", async () => {
    const owner = await createTestUser();
    createdUserIds.push(owner.id);
    const outsider = await createTestUser();
    createdUserIds.push(outsider.id);
    const org = await createOrg(`test-org-put-nm-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const conv = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: owner.id,
        workspaceId: null,
        messages: sampleMessages as any,
        title: "Conv",
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: new Date(),
      },
    });
    createdConversationIds.push(conv.id);

    const req = createAuthenticatedPutRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}`,
      { id: outsider.id, email: outsider.email ?? "", name: outsider.name ?? "" },
      { messages: [{ role: "user", content: "Injected" }] },
    );

    const res = await putConversation(req, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when messages is missing", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-put-bad-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const conv = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: user.id,
        workspaceId: null,
        messages: sampleMessages as any,
        title: "Conv",
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: new Date(),
      },
    });
    createdConversationIds.push(conv.id);

    const req = createAuthenticatedPutRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}`,
      { id: user.id, email: user.email ?? "", name: user.name ?? "" },
      { notMessages: "oops" },
    );

    const res = await putConversation(req, {
      params: detailParams(org.githubLogin, conv.id),
    });
    expect(res.status).toBe(400);
  });
});
