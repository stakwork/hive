import { describe, it, expect, afterEach } from "vitest";
import { createAuthenticatedGetRequest, generateUniqueId } from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
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
const createdRunIds: string[] = [];

afterEach(async () => {
  if (createdRunIds.length > 0) {
    await db.strutRun.deleteMany({ where: { id: { in: createdRunIds } } });
    createdRunIds.length = 0;
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
  async function setup() {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const org = await createOrg(`test-org-cp-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);
    return { user, org, ws };
  }

  async function createChat(
    orgId: string,
    userId: string,
    data: { title: string; messages?: object[]; lastMessageAt: Date; archivedAt?: Date },
  ) {
    const chat = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: orgId,
        userId,
        workspaceId: null,
        messages: data.messages ?? (sampleMessages as object[]),
        title: data.title,
        source: "org-canvas",
        followUpQuestions: [],
        lastMessageAt: data.lastMessageAt,
        archivedAt: data.archivedAt,
      },
    });
    createdConversationIds.push(chat.id);
    return chat;
  }

  async function fetchList(
    org: { githubLogin: string },
    user: { id: string; email: string | null; name: string | null },
  ) {
    const req = createAuthenticatedGetRequest(`http://localhost/api/orgs/${org.githubLogin}/control-panel`, {
      id: user.id,
      email: user.email ?? "",
      name: user.name ?? "",
    });
    const res = await getControlPanel(req, { params: listParams(org.githubLogin) });
    expect(res.status).toBe(200);
    return res.json();
  }

  it("returns archivedItems without a query param; active items and chats.total stay active-only", async () => {
    const { user, org } = await setup();
    const active = await createChat(org.id, user.id, { title: "Active chat", lastMessageAt: new Date() });
    const archived = await createChat(org.id, user.id, {
      title: "Archived chat",
      lastMessageAt: new Date("2026-01-01T00:00:00Z"),
      archivedAt: new Date("2026-02-01T00:00:00Z"),
    });

    const body = await fetchList(org, user);

    expect(body.items.map((i: { id: string }) => i.id)).toEqual([active.id]);
    expect(body.chats).toEqual({ shown: 1, total: 1 });
    expect(body.archivedItems).toHaveLength(1);
    expect(body.archivedItems[0].id).toBe(archived.id);
    expect(body.archivedItems[0].archivedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("lists a chat's jobs from its job turns and its pull requests from its messages", async () => {
    const { user, org, ws } = await setup();
    const pr = (state: string) => ({
      id: "pr",
      kind: "pull_request",
      title: "Add the backfill script",
      source: {
        type: "inline",
        content: { url: "https://github.com/acme/app/pull/7", repo: "acme/app", number: 7, state },
      },
    });
    const chat = await createChat(org.id, user.id, {
      title: "Backfill chat",
      lastMessageAt: new Date("2026-03-01T00:00:00Z"),
      messages: [
        { role: "user", content: "Backfill the orgs" },
        {
          id: "job-a",
          role: "assistant",
          content: "**Job · j1 · Backfill**",
          source: { kind: "job", jobId: "j1" },
          artifacts: [pr("open")],
        },
        {
          id: "job-b",
          role: "assistant",
          content: "**Job · j1 · Backfill**",
          source: { kind: "job", jobId: "j1" },
          artifacts: [pr("merged")],
        },
      ],
    });

    const run = (status: "SUCCESS" | "PENDING", createdAt: string) =>
      db.strutRun.create({
        data: {
          tokenHash: generateUniqueId(),
          workspaceId: ws.id,
          swarmId: "swarm-test",
          userId: user.id,
          kind: "job_turn",
          workflow: "job",
          status,
          input: { title: "Backfill", prompt: "go" },
          conversationId: chat.id,
          jobId: "j1",
          createdAt: new Date(createdAt),
        },
      });
    const runs = [await run("SUCCESS", "2026-03-02T00:00:00Z"), await run("PENDING", "2026-03-03T00:00:00Z")];
    createdRunIds.push(...runs.map((r) => r.id));

    const body = await fetchList(org, user);
    const item = body.items.find((i: { id: string }) => i.id === chat.id);

    expect(item.jobs).toEqual([
      { id: "j1", title: "Backfill", working: true, lastActivityAt: "2026-03-03T00:00:00.000Z" },
    ]);
    expect(item.working).toBe(true);
    // The job's latest turn is newer than the chat's own last message.
    expect(item.lastActivityAt).toBe("2026-03-03T00:00:00.000Z");
    // One PR, at its newest card's state, credited to the job.
    expect(item.pullRequests).toEqual([
      {
        identity: "pull_request:acme/app#7",
        title: "Add the backfill script",
        url: "https://github.com/acme/app/pull/7",
        repo: "acme/app",
        number: 7,
        state: "merged",
        jobId: "j1",
      },
    ]);
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

    const req = createAuthenticatedGetRequest(`http://localhost/api/orgs/${org.githubLogin}/control-panel`, {
      id: outsider.id,
      email: outsider.email ?? "",
      name: outsider.name ?? "",
    });
    const res = await getControlPanel(req, { params: listParams(org.githubLogin) });
    expect(res.status).toBe(404);
  });
});
