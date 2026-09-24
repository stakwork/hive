/**
 * Thin SSE relay for an in-flight org-canvas turn.
 *
 * Redis and resumable-stream are mocked — no live pub/sub. Covers
 * 401 / 404 / 429 / 204 vs SSE replay, and owner-only (isShared joiner
 * → 204, never the live buffer).
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  createGetRequest,
  createAuthenticatedGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { GET } from "@/app/api/orgs/[githubLogin]/chat/conversations/[conversationId]/stream/route";
import { redis } from "@/lib/redis";

const redisGet = vi.fn();
const resumeExistingStream = vi.fn();

vi.mock("@/lib/redis", () => ({
  redis: {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
    get: (...args: unknown[]) => redisGet(...args),
    set: vi.fn(),
    del: vi.fn(),
    duplicate: vi.fn(),
  },
}));

vi.mock("resumable-stream/ioredis", () => ({
  createResumableStreamContext: () => ({
    createNewResumableStream: vi.fn(),
    resumeExistingStream: (...args: unknown[]) => resumeExistingStream(...args),
  }),
}));

let installationIdCounter = 880000;
function nextInstallationId() {
  return installationIdCounter++;
}

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];
const createdConversationIds: string[] = [];

async function createOrg(githubLogin: string) {
  const org = await db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: nextInstallationId(),
      type: "ORG",
      name: githubLogin,
      avatarUrl: "https://example.com/a",
    },
  });
  createdOrgIds.push(org.id);
  return org;
}

async function createWorkspaceInOrg(ownerId: string, orgId: string) {
  const slug = `ws-stream-${generateUniqueId()}`;
  const ws = await db.workspace.create({
    data: { name: slug, slug, ownerId, sourceControlOrgId: orgId },
  });
  createdWorkspaceIds.push(ws.id);
  return ws;
}

function params(githubLogin: string, conversationId: string) {
  return Promise.resolve({ githubLogin, conversationId });
}

function authUser(user: { id: string; email: string | null; name: string | null }) {
  return { id: user.id, email: user.email ?? "", name: user.name ?? "" };
}

beforeEach(() => {
  redisGet.mockReset();
  resumeExistingStream.mockReset();
  vi.mocked(redis.incr).mockResolvedValue(1);
});

afterEach(async () => {
  if (createdConversationIds.length) {
    await db.sharedConversation.deleteMany({ where: { id: { in: createdConversationIds } } });
    createdConversationIds.length = 0;
  }
  if (createdWorkspaceIds.length) {
    await db.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    createdWorkspaceIds.length = 0;
  }
  if (createdOrgIds.length) {
    await db.sourceControlOrg.deleteMany({ where: { id: { in: createdOrgIds } } });
    createdOrgIds.length = 0;
  }
  if (createdUserIds.length) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

async function seedConversation(opts: { isShared?: boolean } = {}) {
  const owner = await createTestUser();
  createdUserIds.push(owner.id);
  const org = await createOrg(`stream-org-${generateUniqueId()}`);
  const ws = await createWorkspaceInOrg(owner.id, org.id);
  const conv = await db.sharedConversation.create({
    data: {
      sourceControlOrgId: org.id,
      userId: owner.id,
      workspaceId: null,
      messages: [{ id: "u1", role: "user", content: "hi" }] as never,
      title: "Live",
      source: "org-canvas",
      followUpQuestions: [],
      isShared: opts.isShared ?? true,
      lastMessageAt: new Date(),
    },
  });
  createdConversationIds.push(conv.id);
  return { owner, org, ws, conv };
}

describe("GET conversation stream relay", () => {
  it("returns 401 when unauthenticated", async () => {
    const req = createGetRequest("http://localhost/api/orgs/acme/chat/conversations/c1/stream");
    const res = await GET(req, { params: params("acme", "c1") });
    expect(res.status).toBe(401);
    expect(redisGet).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-member before reading Redis", async () => {
    const { org, conv } = await seedConversation();
    const outsider = await createTestUser();
    createdUserIds.push(outsider.id);

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/stream`,
      authUser(outsider),
    );
    const res = await GET(req, { params: params(org.githubLogin, conv.id) });
    expect(res.status).toBe(404);
    expect(redisGet).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-readable private row", async () => {
    const { org, ws, conv } = await seedConversation({ isShared: false });
    const member = await createTestUser();
    createdUserIds.push(member.id);
    await db.workspaceMember.create({
      data: { workspaceId: ws.id, userId: member.id, role: "VIEWER" },
    });

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/stream`,
      authUser(member),
    );
    const res = await GET(req, { params: params(org.githubLogin, conv.id) });
    expect(res.status).toBe(404);
    expect(redisGet).not.toHaveBeenCalled();
  });

  it("returns 429 before opening a subscriber", async () => {
    vi.mocked(redis.incr).mockResolvedValue(31);
    vi.mocked(redis.ttl).mockResolvedValue(12);
    const { owner, org, conv } = await seedConversation();
    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/stream`,
      authUser(owner),
    );
    const res = await GET(req, { params: params(org.githubLogin, conv.id) });
    expect(res.status).toBe(429);
    expect(redisGet).not.toHaveBeenCalled();
    expect(resumeExistingStream).not.toHaveBeenCalled();
  });

  it("returns 204 when the pointer is missing", async () => {
    redisGet.mockResolvedValue(null);
    const { owner, org, conv } = await seedConversation();
    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/stream`,
      authUser(owner),
    );
    const res = await GET(req, { params: params(org.githubLogin, conv.id) });
    expect(res.status).toBe(204);
    expect(redisGet).toHaveBeenCalledWith(`canvas:active-stream:${conv.id}`);
    expect(resumeExistingStream).not.toHaveBeenCalled();
  });

  it("returns 204 when resume says the stream is done", async () => {
    redisGet.mockResolvedValue(JSON.stringify({ streamId: "turn-1", turnId: "turn-1" }));
    resumeExistingStream.mockResolvedValue(null);
    const { owner, org, conv } = await seedConversation();
    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/stream`,
      authUser(owner),
    );
    const res = await GET(req, { params: params(org.githubLogin, conv.id) });
    expect(res.status).toBe(204);
    expect(resumeExistingStream).toHaveBeenCalledWith("turn-1");
  });

  it("returns 204 for an isShared joiner who is not the owner", async () => {
    const { org, ws, conv } = await seedConversation({ isShared: true });
    const joiner = await createTestUser();
    createdUserIds.push(joiner.id);
    await db.workspaceMember.create({
      data: { workspaceId: ws.id, userId: joiner.id, role: "DEVELOPER" },
    });

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/stream`,
      authUser(joiner),
    );
    const res = await GET(req, { params: params(org.githubLogin, conv.id) });
    expect(res.status).toBe(204);
    expect(redisGet).not.toHaveBeenCalled();
    expect(resumeExistingStream).not.toHaveBeenCalled();
  });

  it("replays the pointer streamId as SSE for the owner", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue("data: hi\n\n");
        controller.close();
      },
    });
    redisGet.mockResolvedValue(JSON.stringify({ streamId: "turn-9", turnId: "turn-9" }));
    resumeExistingStream.mockResolvedValue(body);
    const { owner, org, conv } = await seedConversation();
    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/stream`,
      authUser(owner),
    );
    const res = await GET(req, { params: params(org.githubLogin, conv.id) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(resumeExistingStream).toHaveBeenCalledWith("turn-9");
    expect(await res.text()).toContain("data: hi");
  });

  it("returns 204 when Redis throws instead of opening SSE", async () => {
    redisGet.mockRejectedValue(new Error("redis down"));
    const { owner, org, conv } = await seedConversation();
    const req = createAuthenticatedGetRequest(
      `http://localhost/api/orgs/${org.githubLogin}/chat/conversations/${conv.id}/stream`,
      authUser(owner),
    );
    const res = await GET(req, { params: params(org.githubLogin, conv.id) });
    expect(res.status).toBe(204);
    expect(resumeExistingStream).not.toHaveBeenCalled();
  });
});
