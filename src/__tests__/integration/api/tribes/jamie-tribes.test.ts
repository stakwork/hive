/**
 * Jamie in Sphinx tribes (`docs/plans/jamie-in-tribes.md`), against the real
 * database: the device routes that link a tribe (`/api/strut-devices/tribes`),
 * and the three routes the Sphinx account calls (`/api/tribes/messages`,
 * `/api/tribes/outbox`, `/api/tribes/outbox/ack`). Redis is an in-memory
 * stand-in; strut is not reached — the launch is mocked, and the reply rows
 * are written by the completion handler's own writer, as in the calls test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createTestWorkspace, createTestWorkspaceScenario } from "@/__tests__/support/fixtures";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { hashApiKey } from "@/lib/api-keys";
import { generateDeviceCredential } from "@/lib/strut-devices";

// ── Redis: the per-tribe turn lock ───────────────────────────────────────────
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...rest: unknown[]) => {
      if (rest.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    expire: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    eval: vi.fn(async (_lua: string, _n: number, key: string, token: string) =>
      store.get(key) === token && store.delete(key) ? 1 : 0,
    ),
  },
}));

vi.mock("@/lib/pusher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pusher")>()),
  pusherServer: { trigger: vi.fn() },
  notifyCanvasConversationUpdated: vi.fn(),
}));

// The room before a mention goes to S3 under the workspace's canvas uploads.
const { mockPutObject } = vi.hoisted(() => ({ mockPutObject: vi.fn() }));
vi.mock("@/services/s3", () => ({
  getS3Service: () => ({
    generateCanvasUploadPath: (workspaceId: string, filename: string) =>
      `uploads/${workspaceId}/canvas/1790000000000_abc_${filename}`,
    putObject: mockPutObject,
  }),
}));

const { mockLaunch } = vi.hoisted(() => ({ mockLaunch: vi.fn() }));
vi.mock("@/services/strut-orchestrator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/strut-orchestrator")>()),
  launchOrchestratorTurn: mockLaunch,
}));

import { GET as listTribes, POST as linkTribe } from "@/app/api/strut-devices/tribes/route";
import { DELETE as unlinkTribe } from "@/app/api/strut-devices/tribes/[pubkey]/route";
import { POST as postMessage } from "@/app/api/tribes/messages/route";
import { GET as getOutbox } from "@/app/api/tribes/outbox/route";
import { POST as postAck } from "@/app/api/tribes/outbox/ack/route";
import { canReadKey } from "@/lib/ai/resolveMessageAttachments";
import { ORCHESTRATOR_TURN_KIND } from "@/lib/strut-orchestrator";
import { appendOrchestratorRows, orchestratorRowsFor } from "@/services/strut-runs/orchestrator-turn";
import { appendJobRow } from "@/services/strut-runs/job-turn";

const TOKEN = "test-jamie-service-token";
const JAMIE = "03" + "b".repeat(64);
const TRIBE = "02" + "a".repeat(64);
const HOST = "tribes.v2.sphinx.chat";
const BASE = "http://localhost:3000";

// ── Requests ─────────────────────────────────────────────────────────────────

function request(method: string, path: string, bearer: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== null) headers.Authorization = `Bearer ${bearer}`;
  return new NextRequest(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const link = (credential: string, body: unknown) => linkTribe(request("POST", "/api/strut-devices/tribes", credential, body));
const list = (credential: string) => listTribes(request("GET", "/api/strut-devices/tribes", credential));
const unlink = (credential: string, pubkey = TRIBE) =>
  unlinkTribe(request("DELETE", `/api/strut-devices/tribes/${pubkey}`, credential), {
    params: Promise.resolve({ pubkey }),
  });

const mention = (body: Record<string, unknown>, bearer: string | null = TOKEN) =>
  postMessage(request("POST", "/api/tribes/messages", bearer, body));
const outbox = async (query = "") => {
  const res = await getOutbox(request("GET", `/api/tribes/outbox${query}`, TOKEN));
  expect(res.status).toBe(200);
  return (await res.json()).messages as Array<Record<string, unknown>>;
};
const ack = (ids: string[], bearer: string | null = TOKEN) => postAck(request("POST", "/api/tribes/outbox/ack", bearer, { ids }));

const aMention = (extra: Record<string, unknown> = {}) => ({
  id: "msg-1",
  tribe: { pubkey: TRIBE, name: "Builders", host: HOST },
  alias: "Alice",
  owner: false,
  time: "2026-10-29T18:02:11Z",
  text: "@jamie what did we decide about the launch?",
  recent: [],
  ...extra,
});

// ── Scenario ─────────────────────────────────────────────────────────────────

async function createOrg() {
  return db.sourceControlOrg.create({
    data: {
      id: generateUniqueId("tribe-org"),
      githubLogin: `tribe-org-${generateUniqueId()}`,
      githubInstallationId: Math.floor(Math.random() * 1_000_000_000),
      type: "ORG",
    },
  });
}

async function createDevice(userId: string) {
  const credential = generateDeviceCredential();
  await db.strutDevice.create({
    data: { userId, name: "Peel", credentialPrefix: credential.slice(0, 12), credentialHash: hashApiKey(credential) },
  });
  return credential;
}

async function createScenario(opts: { orgless?: boolean } = {}) {
  const org = await createOrg();
  const scenario = await createTestWorkspaceScenario({
    memberCount: 1,
    workspace: { sourceControlOrgId: opts.orgless ? null : org.id },
  });
  const credential = await createDevice(scenario.owner.id);
  return { ...scenario, org, credential };
}

/** A scenario with the tribe linked. */
async function linked() {
  const scenario = await createScenario();
  const res = await link(scenario.credential, { workspace: scenario.workspace.slug, tribe: { pubkey: TRIBE, host: HOST } });
  expect(res.status).toBe(200);
  // The join the link queued: handed out and done.
  const join = await outbox();
  await ack(join.map((m) => m.id as string));
  return scenario;
}

const tribeLink = () => db.tribeLink.findUnique({ where: { tribePubkey: TRIBE } });

/** The tribe's conversations, oldest first. */
const threads = () => db.tribeThread.findMany({ orderBy: { createdAt: "asc" } });

/** The conversation a mention started (the first mention's by default). */
async function threadOf(mentionId = "msg-1") {
  const thread = await db.tribeThread.findFirst({ where: { mentionId } });
  expect(thread).not.toBeNull();
  return thread!;
}

async function conversation(mentionId = "msg-1") {
  const thread = await db.tribeThread.findFirst({ where: { mentionId } });
  return thread ? db.sharedConversation.findUnique({ where: { id: thread.conversationId } }) : null;
}

/** A reply landing the way the completion handler writes it. */
async function landReply(
  ctx: { workspaceId: string; userId: string; conversationId: string },
  runId: string,
  reply: Parameters<typeof orchestratorRowsFor>[1],
  extra: {
    refs?: Parameters<typeof orchestratorRowsFor>[2];
    proposals?: Parameters<typeof orchestratorRowsFor>[4];
    jobs?: Parameters<typeof orchestratorRowsFor>[5];
    strut?: Parameters<typeof orchestratorRowsFor>[6];
    wakeId?: string;
  } = {},
) {
  await appendOrchestratorRows(ctx, [
    {
      id: `orchestrator-launch-${runId}`,
      content: "",
      source: { kind: "orchestrator_launch", runId, ...(extra.wakeId ? { wakeId: extra.wakeId } : {}) },
    },
  ]);
  await appendOrchestratorRows(
    ctx,
    orchestratorRowsFor(
      { id: runId, strutRunId: `s-${runId}` },
      reply,
      extra.refs ?? [],
      [],
      extra.proposals ?? [],
      extra.jobs ?? [],
      extra.strut,
    ),
  );
}

/** Land a turn's reply on the conversation a mention started (the first mention's by default). */
async function answered(
  scenario: Awaited<ReturnType<typeof linked>>,
  runId: string,
  text: string,
  extra: Parameters<typeof landReply>[3] = {},
  mentionId = "msg-1",
) {
  const { conversationId } = await threadOf(mentionId);
  await landReply({ workspaceId: scenario.workspace.id, userId: scenario.owner.id, conversationId }, runId, { outcome: "success", text }, extra);
  return conversationId;
}

describe("Jamie in Sphinx tribes", () => {
  const saved = {
    token: process.env.JAMIE_SERVICE_TOKEN,
    pubkey: process.env.JAMIE_SPHINX_PUBKEY,
    alias: process.env.JAMIE_SPHINX_ALIAS,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    process.env.JAMIE_SERVICE_TOKEN = TOKEN;
    // The daemon prints an address; the pubkey is its first part.
    process.env.JAMIE_SPHINX_PUBKEY = `${JAMIE}_${"c".repeat(66)}_529771090670583808`;
    delete process.env.JAMIE_SPHINX_ALIAS;
    mockLaunch.mockResolvedValue({ status: "started", runId: "run-1", strutRunId: "s-1" });
  });

  afterEach(() => {
    for (const [name, value] of [
      ["JAMIE_SERVICE_TOKEN", saved.token],
      ["JAMIE_SPHINX_PUBKEY", saved.pubkey],
      ["JAMIE_SPHINX_ALIAS", saved.alias],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  describe("auth", () => {
    const jamieRoutes: Array<[string, (bearer: string | null) => Promise<Response>]> = [
      ["messages", (bearer) => mention(aMention(), bearer)],
      ["outbox", (bearer) => getOutbox(request("GET", "/api/tribes/outbox", bearer))],
      ["outbox/ack", (bearer) => ack([], bearer)],
    ];

    it.each(jamieRoutes)("%s: 401 without Jamie's token, or with a wrong one", async (_name, send) => {
      expect((await send(null)).status).toBe(401);
      expect((await send("not-the-token")).status).toBe(401);
    });

    it.each(jamieRoutes)("%s: 503 while the feature is off", async (_name, send) => {
      delete process.env.JAMIE_SERVICE_TOKEN;
      expect((await send(TOKEN)).status).toBe(503);
    });

    it("the device routes: 401 for an unknown credential; 503 while the feature is off or Jamie's pubkey is unset", async () => {
      const { credential, workspace } = await createScenario();
      const body = { workspace: workspace.slug, tribe: { pubkey: TRIBE, host: HOST } };
      expect((await link("hivedev_nope", body)).status).toBe(401);
      expect((await list("hivedev_nope")).status).toBe(401);
      expect((await unlink("hivedev_nope")).status).toBe(401);

      delete process.env.JAMIE_SPHINX_PUBKEY;
      expect((await link(credential, body)).status).toBe(503);
      process.env.JAMIE_SPHINX_PUBKEY = JAMIE;
      delete process.env.JAMIE_SERVICE_TOKEN;
      expect((await link(credential, body)).status).toBe(503);
      expect((await list(credential)).status).toBe(503);
      expect(await db.tribeLink.count()).toBe(0);
    });
  });

  describe("/api/strut-devices/tribes", () => {
    it("links a tribe, answers Jamie's account, and tells Jamie to join; the devices list it", async () => {
      const { credential, workspace, org, owner } = await createScenario();

      const res = await link(credential, { workspace: workspace.slug, tribe: { pubkey: TRIBE.toUpperCase(), host: HOST, name: "Builders" } });

      expect(res.status).toBe(200);
      const tribe = { pubkey: TRIBE, host: HOST, name: "Builders", workspace: workspace.slug, org: org.githubLogin, createdAt: expect.any(String) };
      expect(await res.json()).toEqual({ jamie: { pubkey: JAMIE, alias: "Jamie" }, tribe });
      expect(await tribeLink()).toMatchObject({ userId: owner.id, orgId: org.id, workspaceSlug: workspace.slug });
      expect(await threads()).toEqual([]);

      const messages = await outbox();
      expect(messages).toEqual([{ id: expect.any(String), join: `sphinx.chat://?action=tribeV2&pubkey=${TRIBE}&host=${HOST}` }]);

      expect(await (await list(credential)).json()).toEqual({ jamie: { pubkey: JAMIE, alias: "Jamie" }, tribes: [tribe] });
    });

    it("400 for a body that names no workspace or no tribe; 404, 403 and 400 for the workspace, as a call checks it", async () => {
      const { credential, workspace, members } = await createScenario();
      for (const body of [
        { tribe: { pubkey: TRIBE, host: HOST } },
        { workspace: workspace.slug },
        { workspace: workspace.slug, tribe: { pubkey: "02abc", host: HOST } },
        { workspace: workspace.slug, tribe: { pubkey: TRIBE, host: "https://tribes.example/x" } },
      ]) {
        expect((await link(credential, body)).status).toBe(400);
      }
      expect((await link(credential, { workspace: "no-such-workspace", tribe: { pubkey: TRIBE, host: HOST } })).status).toBe(404);

      // Someone who is not in the workspace.
      const other = await createScenario();
      expect((await link(other.credential, { workspace: workspace.slug, tribe: { pubkey: TRIBE, host: HOST } })).status).toBe(403);

      const orgless = await createScenario({ orgless: true });
      const res = await link(orgless.credential, { workspace: orgless.workspace.slug, tribe: { pubkey: TRIBE, host: HOST } });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("not linked to a source-control org");

      expect(members).toHaveLength(1);
      expect(await db.tribeLink.count()).toBe(0);
      expect(await outbox()).toEqual([]);
    });

    it("someone else's link is never taken over: 409", async () => {
      const first = await linked();
      const memberCredential = await createDevice(first.members[0].id);

      const res = await link(memberCredential, { workspace: first.workspace.slug, tribe: { pubkey: TRIBE, host: HOST } });

      expect(res.status).toBe(409);
      expect((await tribeLink())!.userId).toBe(first.owner.id);
      expect(await outbox()).toEqual([]);
    });

    it("linking again keeps the conversations within the org, and drops them for another org", async () => {
      const scenario = await linked();
      await mention(aMention());
      const thread = await threadOf();

      await link(scenario.credential, { workspace: scenario.workspace.slug, tribe: { pubkey: TRIBE, host: HOST } });
      expect(await threads()).toEqual([thread]);

      const otherOrg = await createOrg();
      const elsewhere = await createTestWorkspace({ ownerId: scenario.owner.id, sourceControlOrgId: otherOrg.id });
      const res = await link(scenario.credential, { workspace: elsewhere.slug, tribe: { pubkey: TRIBE, host: HOST } });
      expect(res.status).toBe(200);
      expect(await tribeLink()).toMatchObject({ orgId: otherOrg.id, workspaceSlug: elsewhere.slug });
      expect(await threads()).toEqual([]);
      // The conversation stays in Hive; a reply to an earlier post starts a new one.
      expect(await db.sharedConversation.count({ where: { id: thread.conversationId } })).toBe(1);
      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-2", strutRunId: "s-2" });
      expect((await mention(aMention({ id: "msg-2", thread: thread.id }))).status).toBe(202);
      expect((await threadOf("msg-2")).conversationId).not.toBe(thread.conversationId);
    });

    it("unlinking drops the link and tells Jamie to leave; the tribe's mentions are refused from then on", async () => {
      const { credential } = await linked();

      const res = await unlink(credential, TRIBE.toUpperCase());

      expect(res.status).toBe(200);
      expect(await tribeLink()).toBeNull();
      expect(await outbox()).toEqual([{ id: expect.any(String), leave: TRIBE }]);
      expect((await unlink(credential)).status).toBe(404);
      expect((await mention(aMention())).status).toBe(404);
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it("only the linker unlinks", async () => {
      const scenario = await linked();
      const memberCredential = await createDevice(scenario.members[0].id);
      expect((await unlink(memberCredential)).status).toBe(404);
      expect(await tribeLink()).not.toBeNull();
    });
  });

  describe("POST /api/tribes/messages", () => {
    it("a mention starts a conversation of its own and launches as the linker, with the tribe line", async () => {
      const { owner, org, workspace } = await linked();
      await db.user.update({ where: { id: owner.id }, data: { timezone: "Europe/London" } });

      const res = await mention(aMention({ owner: true }));

      expect(res.status).toBe(202);
      const thread = await threadOf();
      expect(await res.json()).toEqual({ turn: "run-1", thread: thread.id });
      const conv = await conversation();
      expect(conv).toMatchObject({ userId: owner.id, sourceControlOrgId: org.id, source: "org-canvas" });
      const rows = conv!.messages as Array<{ role: string; content: string }>;
      expect(rows).toEqual([expect.objectContaining({ role: "user", content: "Alice: @jamie what did we decide about the launch?" })]);

      expect(mockLaunch).toHaveBeenCalledWith({
        userId: owner.id,
        orgId: org.id,
        conversationId: conv!.id,
        message: "Alice: @jamie what did we decide about the launch?",
        attachments: [],
        publicBaseUrl: expect.any(String),
        timeZone: "Europe/London",
        tribe: { name: "Builders", alias: "Alice", owner: true },
      });
      expect(await db.tribeMention.findMany({ select: { mentionId: true, runId: true } })).toEqual([{ mentionId: "msg-1", runId: "run-1" }]);
      expect((await tribeLink())!.name).toBe("Builders");
      expect(workspace.sourceControlOrgId).toBe(org.id);
    });

    it("each mention is a new conversation, and so a new session; a reply to Jamie's post continues its own", async () => {
      await linked();
      await mention(aMention());
      const first = await threadOf();

      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-2", strutRunId: "s-2" });
      const second = await mention(aMention({ id: "msg-2", text: "@jamie something else" }));
      expect(second.status).toBe(202);
      const other = await threadOf("msg-2");
      expect(other.conversationId).not.toBe(first.conversationId);
      expect(mockLaunch.mock.calls[1][0].conversationId).toBe(other.conversationId);

      // A mention replying to a post from the first conversation.
      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-3", strutRunId: "s-3" });
      const reply = await mention(aMention({ id: "msg-3", text: "@jamie and Thursday?", thread: first.id }));
      expect(reply.status).toBe(202);
      expect(await reply.json()).toEqual({ turn: "run-3", thread: first.id });
      expect(mockLaunch.mock.calls[2][0]).toMatchObject({ conversationId: first.conversationId, message: "Alice: @jamie and Thursday?" });
      expect((await conversation())!.messages).toHaveLength(2);
      expect(await threads()).toHaveLength(2);
    });

    it("a burst is one turn: the earlier lines first, the newest last; every id is taken; the reply threads under the newest", async () => {
      const scenario = await linked();
      await mention(aMention());
      const thread = await threadOf();
      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-2", strutRunId: "s-2" });

      const res = await mention(
        aMention({
          id: "msg-4",
          alias: "Carol",
          text: "and Friday?",
          thread: thread.id,
          earlier: [
            { id: "msg-2", alias: "Bob", owner: false, time: "2026-10-29T18:03:00Z", text: "what about Thursday?" },
            { id: "msg-3", alias: "Alice", owner: true, time: "2026-10-29T18:03:05Z", text: "or Wednesday\nafter lunch" },
          ],
        }),
      );

      expect(res.status).toBe(202);
      const folded = "Bob: what about Thursday?\nAlice: or Wednesday\nafter lunch\nCarol: and Friday?";
      expect(mockLaunch.mock.calls[1][0]).toMatchObject({ conversationId: thread.conversationId, message: folded });
      const rows = (await conversation())!.messages as Array<{ role: string; content: string }>;
      expect(rows.filter((r) => r.role === "user").map((r) => r.content)).toEqual([
        "Alice: @jamie what did we decide about the launch?",
        folded,
      ]);
      expect(await db.tribeMention.findMany({ where: { runId: "run-2" }, select: { mentionId: true, folded: true }, orderBy: { mentionId: "asc" } })).toEqual([
        { mentionId: "msg-2", folded: true },
        { mentionId: "msg-3", folded: true },
        { mentionId: "msg-4", folded: false },
      ]);

      // A retry of any message in it is a duplicate.
      for (const id of ["msg-2", "msg-3", "msg-4"]) {
        const again = await mention(aMention({ id, thread: thread.id }));
        expect(again.status).toBe(200);
        expect(await again.json()).toEqual({ duplicate: true, turn: "run-2" });
      }
      expect(mockLaunch).toHaveBeenCalledTimes(2);

      await ack((await outbox()).map((m) => m.id as string));
      await answered(scenario, "run-2", "Friday it is.");
      expect((await outbox()).map((m) => [m.text, m.replyTo])).toEqual([["Friday it is.", "msg-4"]]);
    });

    it("a burst leaves out a message a turn already took", async () => {
      await linked();
      await mention(aMention());
      const thread = await threadOf();
      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-2", strutRunId: "s-2" });

      await mention(
        aMention({
          id: "msg-3",
          alias: "Carol",
          text: "and Friday?",
          thread: thread.id,
          earlier: [
            { id: "msg-1", alias: "Alice", text: "@jamie what did we decide about the launch?" },
            { id: "msg-2", alias: "Bob", text: "what about Thursday?" },
            { id: "msg-2", alias: "Bob", text: "what about Thursday?" },
          ],
        }),
      );

      expect(mockLaunch.mock.calls[1][0].message).toBe("Bob: what about Thursday?\nCarol: and Friday?");
      expect(await db.tribeMention.findMany({ where: { mentionId: "msg-1" }, select: { runId: true } })).toEqual([{ runId: "run-1" }]);
    });

    it("a thread Hive does not know, or another tribe's, starts a new conversation", async () => {
      const scenario = await linked();
      // Another tribe, linked by the same person, with a conversation of its own.
      const elsewhere = "02" + "d".repeat(64);
      await link(scenario.credential, { workspace: scenario.workspace.slug, tribe: { pubkey: elsewhere, host: HOST } });
      await mention(aMention({ tribe: { pubkey: elsewhere, name: "Other", host: HOST } }));
      const theirs = await threadOf();

      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-2", strutRunId: "s-2" });
      expect((await mention(aMention({ id: "msg-2", thread: theirs.id }))).status).toBe(202);
      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-3", strutRunId: "s-3" });
      expect((await mention(aMention({ id: "msg-3", thread: "no-such-thread" }))).status).toBe(202);

      const conversations = new Set((await threads()).map((t) => t.conversationId));
      expect(conversations.size).toBe(3);
      expect((await threadOf("msg-2")).tribeLinkId).not.toBe(theirs.tribeLinkId);
    });

    it("a mention taken before is dropped: no second turn", async () => {
      await linked();
      await mention(aMention());

      const res = await mention(aMention());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ duplicate: true, turn: "run-1" });
      expect(mockLaunch).toHaveBeenCalledTimes(1);
      expect((await conversation())!.messages).toHaveLength(1);
    });

    it("409 busy for a reply while its conversation has a turn in flight; a new mention runs beside it", async () => {
      const { owner, workspace } = await linked();
      await mention(aMention());
      const thread = await threadOf();
      await db.strutRun.create({
        data: {
          tokenHash: "h",
          workspaceId: workspace.id,
          swarmId: "swarm-1",
          userId: owner.id,
          kind: ORCHESTRATOR_TURN_KIND,
          workflow: "orchestrator",
          conversationId: thread.conversationId,
        },
      });
      mockLaunch.mockClear();

      const busy = await mention(aMention({ id: "msg-2", text: "and now?", thread: thread.id }));
      expect(busy.status).toBe(409);
      expect(await busy.json()).toHaveProperty("busy");
      expect(mockLaunch).not.toHaveBeenCalled();
      expect((await conversation())!.messages).toHaveLength(1);

      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-2", strutRunId: "s-2" });
      expect((await mention(aMention({ id: "msg-3", text: "@jamie another thing" }))).status).toBe(202);
      expect(await db.tribeMention.count()).toBe(2);
    });

    it("409 while another request holds the lock: a conversation's for a reply, the tribe's for a new mention", async () => {
      await linked();
      await mention(aMention());
      const thread = await threadOf();
      mockLaunch.mockClear();

      store.set(`tribe-turn:${TRIBE}:${thread.id}`, "someone-else");
      expect((await mention(aMention({ id: "msg-2", thread: thread.id }))).status).toBe(409);
      store.set(`tribe-turn:${TRIBE}:new`, "someone-else");
      expect((await mention(aMention({ id: "msg-3" }))).status).toBe(409);

      expect(mockLaunch).not.toHaveBeenCalled();
      expect(await threads()).toHaveLength(1);
    });

    it("a launch strut refused is a 502 and is not recorded, so Jamie's retry takes it", async () => {
      await linked();
      mockLaunch.mockResolvedValueOnce({ status: "error", error: "Organization not found." });

      const res = await mention(aMention());
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain("Organization not found.");
      expect(await db.tribeMention.count()).toBe(0);

      // The retry lands on the conversation the first try started.
      expect((await mention(aMention())).status).toBe(202);
      expect(mockLaunch).toHaveBeenCalledTimes(2);
      expect(await threads()).toHaveLength(1);
      expect(mockLaunch.mock.calls[1][0].conversationId).toBe(mockLaunch.mock.calls[0][0].conversationId);
    });

    it("the room before the mention is a text attachment: on S3, on the user row and on the launch", async () => {
      const { owner, workspace } = await linked();

      const res = await mention(
        aMention({
          recent: [
            { alias: "Bob", time: "2026-10-29T18:00:00Z", text: "launch is Tuesday?" },
            { alias: "Carol", time: "2026-10-29T18:01:00Z", text: "Wednesday,\nI think" },
          ],
        }),
      );

      expect(res.status).toBe(202);
      const [path, bytes, contentType] = mockPutObject.mock.calls[0];
      expect(path).toBe(`uploads/${workspace.id}/canvas/1790000000000_abc_tribe-recent.txt`);
      expect((bytes as Buffer).toString("utf8")).toBe(
        "[2026-10-29T18:00:00Z] Bob: launch is Tuesday?\n[2026-10-29T18:01:00Z] Carol: Wednesday,\nI think\n",
      );
      expect(contentType).toMatch(/^text\/plain/);
      const attachment = { path, filename: "tribe-recent.txt", mimeType: "text/plain", size: (bytes as Buffer).length };
      expect(((await conversation())!.messages as Array<{ attachments?: unknown }>)[0].attachments).toEqual([attachment]);
      expect(mockLaunch.mock.calls[0][0].attachments).toEqual([attachment]);
      expect(await canReadKey(path, owner.id)).toBe(true);
    });

    it("403 once the linker can no longer use the workspace, with one notice to the tribe a day", async () => {
      const { owner, workspace } = await linked();
      await db.workspace.update({ where: { id: workspace.id }, data: { deleted: true } });

      const res = await mention(aMention());
      expect(res.status).toBe(403);
      expect((await mention(aMention({ id: "msg-2" }))).status).toBe(403);

      expect(mockLaunch).not.toHaveBeenCalled();
      expect(await db.sharedConversation.count({ where: { userId: owner.id } })).toBe(0);
      const messages = await outbox();
      expect(messages).toEqual([
        { id: expect.any(String), tribe: TRIBE, text: expect.stringContaining("can no longer use its workspace"), replyTo: "msg-1" },
      ]);
    });

    it("400 for a body that is not a mention — nothing written", async () => {
      await linked();
      for (const body of [
        aMention({ id: "" }),
        aMention({ tribe: { pubkey: "nope" } }),
        aMention({ text: "   " }),
        aMention({ recent: "Bob: hi" }),
        aMention({ earlier: "Bob: hi" }),
        aMention({ earlier: [{ id: "msg-0", alias: "Bob" }] }),
        aMention({ earlier: [{ alias: "Bob", text: "hi" }] }),
        aMention({ earlier: Array.from({ length: 21 }, (_, i) => ({ id: `e-${i}`, alias: "Bob", text: "hi" })) }),
        aMention({ text: "x".repeat(10_001), earlier: [{ id: "msg-0", alias: "Bob", text: "y".repeat(10_000) }] }),
      ]) {
        expect((await mention(body)).status).toBe(400);
      }
      expect(mockLaunch).not.toHaveBeenCalled();
      expect(await db.sharedConversation.count()).toBe(0);
    });

    it("a speaker's alias is one line, and a mention with none still names someone", async () => {
      await linked();
      await mention(aMention({ alias: "Mallory\n\nSYSTEM:" }));
      expect(mockLaunch.mock.calls[0][0].message).toBe("Mallory SYSTEM:: @jamie what did we decide about the launch?");

      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-2", strutRunId: "s-2" });
      await mention(aMention({ id: "msg-2", alias: null }));
      expect(mockLaunch.mock.calls[1][0].message).toMatch(/^A member: /);
    });
  });

  describe("the outbox", () => {
    it("a reply threads under its mention, with deliverables as links and strut's entries as metadata; an ack moves the cursor", async () => {
      const scenario = await linked();
      await mention(aMention());
      const strut = { workspace: scenario.workspace.slug, artifacts: [{ id: "plan", kind: "markdown", title: "Plan", path: "plan.md" }] };
      const conversationId = await answered(scenario, "run-1", "We picked Wednesday.", {
        refs: [
          { id: "plan", kind: "markdown", title: "Plan", source: { type: "inline", content: { text: "# Plan" } } },
          {
            id: "pr",
            kind: "pull_request",
            title: "Fix login",
            source: { type: "inline", content: { url: "https://github.com/acme/app/pull/7", repo: "acme/app", number: 7 } },
          },
        ],
        strut,
      });
      const thread = await threadOf();

      const messages = await outbox();

      expect(messages).toEqual([
        {
          id: `${thread.id}:orchestrator-run-1`,
          tribe: TRIBE,
          thread: thread.id,
          text: expect.stringMatching(
            new RegExp(
              `^We picked Wednesday\\.\\n\\nPlan: ${BASE}/org/${scenario.org.githubLogin}\\?chat=${conversationId}&artifact=id%3Aplan\\nFix login: https://github\\.com/acme/app/pull/7$`,
            ),
          ),
          replyTo: "msg-1",
          metadata: { strut },
        },
      ]);
      // Handed out again until acked.
      expect(await outbox()).toHaveLength(1);

      expect((await ack([messages[0].id as string])).status).toBe(200);
      expect(await outbox()).toEqual([]);
      expect((await threadOf()).cursor).toBeTruthy();
    });

    it("a turn's rows move the cursor together: one acked without the other is handed out again", async () => {
      const scenario = await linked();
      await mention(aMention());
      await answered(scenario, "run-1", "I've proposed it.", {
        proposals: [{ id: "p1", step: "graph/create-node", title: "Login bug", status: "pending", url: "/proposals/p1" }],
      });
      const { name } = await db.user.findUniqueOrThrow({ where: { id: scenario.owner.id }, select: { name: true } });

      const messages = await outbox();
      expect(messages.map((m) => [m.text, m.replyTo])).toEqual([
        ["I've proposed it.", "msg-1"],
        [`Waiting for ${name || "the person who linked this tribe"} to approve: Login bug`, "msg-1"],
      ]);

      // An ack of the proposal alone moves nothing, and is not kept: the two
      // are handed out again, and Jamie, which keeps what it posted, acks both.
      await ack([messages[1].id as string]);
      expect(await outbox()).toHaveLength(2);
      await ack([messages[0].id as string]);
      expect(await outbox()).toHaveLength(2);
      await ack(messages.map((m) => m.id as string));
      expect(await outbox()).toEqual([]);
    });

    it("a job's wake reply threads under the mention that started the job", async () => {
      const scenario = await linked();
      await mention(aMention());
      await answered(scenario, "run-1", "Started a job for it.", { jobs: [{ jobId: "job-a", title: "Launch plan", runId: "jobturn-1" }] });
      await ack((await outbox()).map((m) => m.id as string));

      await new Promise((r) => setTimeout(r, 5));
      await answered(scenario, "wake-1", "The launch plan is ready.", { wakeId: "job-jobturn-1" });

      expect((await outbox()).map((m) => [m.text, m.replyTo])).toEqual([["The launch plan is ready.", "msg-1"]]);
    });

    it("a job's wake reply carries the job's deliverables: links for everyone, strut's entries as metadata", async () => {
      const scenario = await linked();
      await mention(aMention());
      const conversationId = await answered(scenario, "run-1", "On it.", { jobs: [{ jobId: "job-a", title: "Marketplace report", runId: "jobturn-1" }] });
      await ack((await outbox()).map((m) => m.id as string));

      // The job's row, as the job turn's handler lands it: the report and
      // hive's own cards (claims, trace), and strut's entries as they came.
      await new Promise((r) => setTimeout(r, 5));
      const strut = { workspace: scenario.workspace.slug, artifacts: [{ id: "report", kind: "markdown", title: "Report", path: "report.md" }] };
      const inline = { type: "inline" as const, content: {} };
      await appendJobRow(
        { id: "jobturn-1", workspaceId: scenario.workspace.id, userId: scenario.owner.id, conversationId },
        {
          content: "**Job · job-a · Marketplace report**\n\nWrote the report.",
          source: { kind: "job", jobId: "job-a", strutRunId: "s-jobturn-1", workflow: "job", status: "success", title: "Marketplace report" },
          artifacts: [
            { id: "report", kind: "markdown", title: "Report", source: { type: "graph", swarmId: "swarm-1", key: "/jobs/job-a/files/report.md" } },
            { id: "claims-job-a", kind: "claims", title: "Marketplace report", source: inline },
            { id: "run-graph-job-a", kind: "run_graph", title: "Marketplace report", source: inline },
          ],
          strut,
        },
      );
      // The job row alone is a card, not something Jamie says.
      expect(await outbox()).toEqual([]);

      await answered(scenario, "wake-1", "The marketplace report is ready.", { wakeId: "job-jobturn-1" });
      const thread = await threadOf();
      expect(await outbox()).toEqual([
        {
          id: `${thread.id}:orchestrator-wake-1`,
          tribe: TRIBE,
          thread: thread.id,
          text: `The marketplace report is ready.\n\nReport: ${BASE}/org/${scenario.org.githubLogin}?chat=${conversationId}&artifact=${encodeURIComponent("graph:swarm-1:/jobs/job-a/files/report.md")}`,
          replyTo: "msg-1",
          metadata: { strut },
        },
      ]);
    });

    it("each conversation is read after its own cursor, and an ack moves only its own; a continued one threads under the reply", async () => {
      const scenario = await linked();
      await mention(aMention());
      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-2", strutRunId: "s-2" });
      await mention(aMention({ id: "msg-2", text: "@jamie other" }));
      const [a, b] = [await threadOf(), await threadOf("msg-2")];
      await answered(scenario, "run-1", "First.");
      await answered(scenario, "run-2", "Second.", {}, "msg-2");

      const messages = await outbox();
      expect(messages.map((m) => [m.id, m.thread, m.text, m.replyTo])).toEqual([
        [`${a.id}:orchestrator-run-1`, a.id, "First.", "msg-1"],
        [`${b.id}:orchestrator-run-2`, b.id, "Second.", "msg-2"],
      ]);

      await ack([messages[1].id as string]);
      expect((await outbox()).map((m) => m.text)).toEqual(["First."]);
      expect((await threadOf("msg-2")).cursor).toBeTruthy();
      expect((await threadOf()).cursor).toBeNull();
      await ack([messages[0].id as string]);
      expect(await outbox()).toEqual([]);

      // A mention replying to "First." continues that conversation; its answer threads under it.
      await new Promise((r) => setTimeout(r, 5));
      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-3", strutRunId: "s-3" });
      await mention(aMention({ id: "msg-3", text: "@jamie and then?", thread: a.id }));
      await answered(scenario, "run-3", "Then Thursday.");
      expect((await outbox()).map((m) => [m.thread, m.text, m.replyTo])).toEqual([[a.id, "Then Thursday.", "msg-3"]]);
    });

    it("a reply to no mention — a turn the linker took in Hive — is posted unthreaded", async () => {
      const scenario = await linked();
      await mention(aMention());
      await answered(scenario, "run-other", "Done.");
      const [message] = await outbox();
      expect(message).toMatchObject({ text: "Done." });
      expect(message).not.toHaveProperty("replyTo");
    });

    it("a reply with nothing to post is passed over, and the conversation is not read again until it moves", async () => {
      const scenario = await linked();
      await mention(aMention());
      await answered(scenario, "run-1", "");

      expect(await outbox()).toEqual([]);
      const thread = await threadOf();
      expect(thread.cursor).toBeTruthy();
      expect(thread.readAt).toBeTruthy();

      // A row written without moving `updatedAt` is not seen: the conversation was not read again…
      const { conversationId } = thread;
      const row = {
        id: "orchestrator-run-2",
        role: "assistant",
        content: "Seen once it moves.",
        timestamp: new Date(Date.now() + 1000).toISOString(),
        source: { kind: "orchestrator", runId: "run-2", status: "success" },
      };
      await db.$executeRaw`
        UPDATE shared_conversations SET messages = messages || ${JSON.stringify([row])}::jsonb WHERE id = ${conversationId}
      `;
      expect(await outbox()).toEqual([]);
      // …until it moves.
      await db.sharedConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
      expect((await outbox()).map((m) => m.text)).toEqual(["Seen once it moves."]);
    });

    it("joins, leaves and notices come before replies, oldest first, and an ack marks them done", async () => {
      const scenario = await linked();
      await mention(aMention());
      await answered(scenario, "run-1", "Hello.");
      await link(scenario.credential, { workspace: scenario.workspace.slug, tribe: { pubkey: TRIBE, host: HOST } });

      const messages = await outbox();
      expect(messages.map((m) => ("join" in m ? "join" : "text" in m ? m.text : m))).toEqual(["join", "Hello."]);

      await ack([messages[0].id as string, "unknown-id", "nothread:orchestrator-x"]);
      expect((await outbox()).map((m) => m.text)).toEqual(["Hello."]);
    });

    it("a long poll returns as soon as a reply lands", async () => {
      const scenario = await linked();
      await mention(aMention());
      const { conversationId } = await threadOf();

      const started = Date.now();
      const pending = outbox("?wait=10");
      setTimeout(() => {
        void landReply({ workspaceId: scenario.workspace.id, userId: scenario.owner.id, conversationId }, "run-1", {
          outcome: "success",
          text: "All green.",
        });
      }, 300);
      const messages = await pending;

      expect(messages.map((m) => m.text)).toEqual(["All green."]);
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it("a long poll with nothing to do ends empty after the wait", async () => {
      await linked();
      const started = Date.now();
      expect(await outbox("?wait=1")).toEqual([]);
      expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    });

    it("400 for a wait that is no number, or an ack that is not a list of ids", async () => {
      expect((await getOutbox(request("GET", "/api/tribes/outbox?wait=soon", TOKEN))).status).toBe(400);
      expect((await postAck(request("POST", "/api/tribes/outbox/ack", TOKEN, { ids: "a" }))).status).toBe(400);
      expect((await postAck(request("POST", "/api/tribes/outbox/ack", TOKEN, { ids: [1] }))).status).toBe(400);
    });
  });
});
