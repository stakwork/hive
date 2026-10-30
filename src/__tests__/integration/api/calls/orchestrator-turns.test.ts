/**
 * Jamie on a call talking to strut's orchestrator through Hive: the three
 * call endpoints (`/api/calls/turn`, `/api/calls/messages`,
 * `/api/calls/cancel`), against the real database. Redis is an in-memory
 * stand-in; strut is not reached — the launch and the strut cancel are
 * mocked, and the reply rows are written by the completion handler's own
 * writer (`orchestratorRowsFor` + `appendOrchestratorRows`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

// ── Redis: the call record, the per-call turn lock ────────────────────────────
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

// The transcript excerpt goes to S3 under the workspace's canvas uploads.
const { mockPutObject } = vi.hoisted(() => ({ mockPutObject: vi.fn() }));
vi.mock("@/services/s3", () => ({
  getS3Service: () => ({
    generateCanvasUploadPath: (workspaceId: string, filename: string) =>
      `uploads/${workspaceId}/canvas/1790000000000_abc_${filename}`,
    putObject: mockPutObject,
  }),
}));

// Strut's side: the launch, and the cancel the Stop path sends.
const { mockLaunch, mockCancel } = vi.hoisted(() => ({ mockLaunch: vi.fn(), mockCancel: vi.fn() }));
vi.mock("@/services/strut-orchestrator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/strut-orchestrator")>()),
  launchOrchestratorTurn: mockLaunch,
}));
vi.mock("@/services/strut-runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/strut-runs")>()),
  cancelPendingStrutRunsForConversation: mockCancel,
}));

import { POST as turn } from "@/app/api/calls/turn/route";
import { GET as messages } from "@/app/api/calls/messages/route";
import { POST as cancel } from "@/app/api/calls/cancel/route";
import { canReadKey } from "@/lib/ai/resolveMessageAttachments";
import { peekCallRecord, storeCallRecord } from "@/lib/calls/callRecord";
import { ORCHESTRATOR_TURN_KIND } from "@/lib/strut-orchestrator";
import { appendOrchestratorRows, orchestratorRowsFor } from "@/services/strut-runs/orchestrator-turn";

const VOICE_KEY = "test-voice-agent-key";
const CALL_KEY = "abc123def456abc123def456";

function call(
  method: "GET" | "POST",
  path: string,
  { body, key = VOICE_KEY, callKey = CALL_KEY }: { body?: unknown; key?: string | null; callKey?: string | null } = {},
): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== null) headers.Authorization = `Bearer ${key}`;
  if (callKey !== null) headers["X-Call-Key"] = callKey;
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const say = (body: Record<string, unknown>, opts: { key?: string | null; callKey?: string | null } = {}) =>
  turn(call("POST", "/api/calls/turn", { body, ...opts }));

async function createCall(opts: { orgless?: boolean } = {}) {
  const org = await db.sourceControlOrg.create({
    data: {
      id: generateUniqueId("call-org"),
      githubLogin: `call-org-${generateUniqueId()}`,
      githubInstallationId: Math.floor(Math.random() * 1_000_000_000),
      type: "ORG",
    },
  });
  const scenario = await createTestWorkspaceScenario({
    memberCount: 1,
    workspace: { sourceControlOrgId: opts.orgless ? null : org.id },
  });
  const owner = scenario.owner;
  await storeCallRecord(CALL_KEY, {
    userId: owner.id,
    orgId: opts.orgless ? null : org.id,
    workspaceSlug: scenario.workspace.slug,
    roomName: "sphinx.call.-room-1",
  });
  return { ...scenario, org, owner };
}

async function conversationOf(callKey = CALL_KEY) {
  const record = await peekCallRecord(callKey);
  if (!record?.conversationId) return null;
  return db.sharedConversation.findUnique({ where: { id: record.conversationId } });
}

/** A reply landing the way the completion handler writes it. */
async function landReply(
  ctx: { workspaceId: string; userId: string; conversationId: string },
  runId: string,
  reply: Parameters<typeof orchestratorRowsFor>[1],
  extra: { refs?: Parameters<typeof orchestratorRowsFor>[2]; proposals?: Parameters<typeof orchestratorRowsFor>[4] } = {},
) {
  await appendOrchestratorRows(ctx, [
    { id: `orchestrator-launch-${runId}`, content: "", source: { kind: "orchestrator_launch", runId } },
  ]);
  await appendOrchestratorRows(
    ctx,
    orchestratorRowsFor({ id: runId, strutRunId: `s-${runId}` }, reply, extra.refs ?? [], [], extra.proposals ?? []),
  );
}

describe("the call endpoints", () => {
  const originalKey = process.env.VOICE_AGENT_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    process.env.VOICE_AGENT_API_KEY = VOICE_KEY;
    mockLaunch.mockResolvedValue({ status: "started", runId: "run-1", strutRunId: "s-1" });
    mockCancel.mockResolvedValue({ rows: [], cancelled: 0 });
  });

  afterEach(() => {
    if (originalKey) process.env.VOICE_AGENT_API_KEY = originalKey;
    else delete process.env.VOICE_AGENT_API_KEY;
  });

  describe("auth: the agent's key AND a live callKey, in headers", () => {
    type Opts = { key?: string | null; callKey?: string | null };
    const routes: Array<[string, (opts?: Opts) => Promise<Response>]> = [
      ["turn", (opts) => say({ speaker: "Alice", text: "hi", source: "voice" }, opts)],
      ["messages", (opts) => messages(call("GET", "/api/calls/messages", opts))],
      ["cancel", (opts) => cancel(call("POST", "/api/calls/cancel", opts))],
    ];

    it.each(routes)("%s: 401 without the agent's key, or with a wrong one", async (_name, send) => {
      await createCall();
      expect((await send({ key: null })).status).toBe(401);
      expect((await send({ key: "not-the-key" })).status).toBe(401);
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it.each(routes)("%s: 503 when the agent's key is not configured", async (_name, send) => {
      await createCall();
      delete process.env.VOICE_AGENT_API_KEY;
      expect((await send()).status).toBe(503);
    });

    it("404 for a missing or unknown callKey; a callKey in the URL counts for nothing", async () => {
      await createCall();
      const missing = await say({ speaker: "Alice", text: "hi", source: "voice" }, { callKey: null });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "call not found or expired" });
      expect((await say({ speaker: "Alice", text: "hi", source: "voice" }, { callKey: "ffffffffffffffffffffffff" })).status).toBe(404);
      expect((await messages(call("GET", `/api/calls/messages?callKey=${CALL_KEY}`, { callKey: null }))).status).toBe(404);
      expect((await cancel(call("POST", "/api/calls/cancel", { callKey: "nope" }))).status).toBe(404);
      expect(mockLaunch).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/calls/turn", () => {
    it("the first turn creates the call's conversation, records it, and launches as the call's creator", async () => {
      const { owner, org } = await createCall();
      await db.user.update({ where: { id: owner.id }, data: { timezone: "Europe/London" } });

      const res = await say({ speaker: "Alice", text: "what are we working on?", source: "voice" });

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ turn: "run-1" });

      const conversation = await conversationOf();
      expect(conversation).toMatchObject({ userId: owner.id, sourceControlOrgId: org.id, source: "org-canvas" });
      const rows = conversation!.messages as Array<{ role: string; content: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        role: "user",
        content: "Alice: what are we working on?",
        source: { kind: "call_request", speaker: "Alice", via: "voice" },
      });

      expect(mockLaunch).toHaveBeenCalledTimes(1);
      expect(mockLaunch).toHaveBeenCalledWith({
        userId: owner.id,
        orgId: org.id,
        conversationId: conversation!.id,
        message: "Alice: what are we working on?",
        attachments: [],
        publicBaseUrl: expect.any(String),
        timeZone: "Europe/London",
        call: true,
      });
    });

    it("a second turn appends to the same conversation", async () => {
      await createCall();
      await say({ speaker: "Alice", text: "first", source: "voice" });
      const first = await conversationOf();
      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-2", strutRunId: "s-2" });

      const res = await say({ speaker: "Bob", text: "@jamie second", source: "chat" });

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ turn: "run-2" });
      const again = await conversationOf();
      expect(again!.id).toBe(first!.id);
      expect((again!.messages as Array<{ content: string }>).map((m) => m.content)).toEqual([
        "Alice: first",
        "Bob: @jamie second",
      ]);
      expect(mockLaunch.mock.calls[1][0]).toMatchObject({ conversationId: first!.id, message: "Bob: @jamie second" });
      expect(await db.sharedConversation.count()).toBe(1);
    });

    it("409 busy while the conversation has a turn in flight — nothing written, nothing launched", async () => {
      const { owner, workspace } = await createCall();
      await say({ speaker: "Alice", text: "first", source: "voice" });
      const conversation = await conversationOf();
      await db.strutRun.create({
        data: {
          tokenHash: "h",
          workspaceId: workspace.id,
          swarmId: "swarm-1",
          userId: owner.id,
          kind: ORCHESTRATOR_TURN_KIND,
          workflow: "orchestrator",
          conversationId: conversation!.id,
        },
      });
      mockLaunch.mockClear();

      const res = await say({ speaker: "Alice", text: "second", source: "voice" });

      expect(res.status).toBe(409);
      expect(await res.json()).toHaveProperty("busy");
      expect(mockLaunch).not.toHaveBeenCalled();
      expect((await conversationOf())!.messages).toHaveLength(1);
    });

    it("409 busy when another turn of the call holds the lock, or strut says the session is busy", async () => {
      await createCall();
      store.set(`call-turn:${CALL_KEY}`, "someone-else");
      expect((await say({ speaker: "Alice", text: "hi", source: "voice" })).status).toBe(409);
      expect(mockLaunch).not.toHaveBeenCalled();

      store.delete(`call-turn:${CALL_KEY}`);
      mockLaunch.mockResolvedValueOnce({ status: "busy", note: "Still working on your last message" });
      const res = await say({ speaker: "Alice", text: "hi", source: "voice" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ busy: "Still working on your last message" });
      // The lock was let go after the turn.
      expect(store.has(`call-turn:${CALL_KEY}`)).toBe(false);
    });

    it("a launch strut refused is a 5xx with what went wrong", async () => {
      await createCall();
      mockLaunch.mockResolvedValueOnce({ status: "error", error: "Organization not found." });
      const res = await say({ speaker: "Alice", text: "hi", source: "voice" });
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain("Organization not found.");
    });

    it("the transcript excerpt is an ordinary chat attachment: on S3, on the user row, and on the launch", async () => {
      const { owner, workspace } = await createCall();
      const text = "[14:01–14:03]\n412 [14:01] Alice: the login bug\n413 [14:02] Bob: it's the redirect";

      const res = await say({
        speaker: "Alice",
        text: "make a PR for that",
        source: "voice",
        transcript: { name: "transcript-1.txt", text },
      });

      expect(res.status).toBe(202);
      expect(mockPutObject).toHaveBeenCalledTimes(1);
      const [path, bytes, contentType] = mockPutObject.mock.calls[0];
      expect(path).toBe(`uploads/${workspace.id}/canvas/1790000000000_abc_transcript-1.txt`);
      expect((bytes as Buffer).toString("utf8")).toBe(text);
      expect(contentType).toMatch(/^text\/plain/);

      const attachment = { path, filename: "transcript-1.txt", mimeType: "text/plain", size: Buffer.byteLength(text) };
      const rows = (await conversationOf())!.messages as Array<{ attachments?: unknown }>;
      expect(rows[0].attachments).toEqual([attachment]);
      expect(mockLaunch.mock.calls[0][0].attachments).toEqual([attachment]);
      // What `strutAttachments` checks before reading it, as the call's creator.
      expect(await canReadKey(path, owner.id)).toBe(true);
    });

    it("400 for a body that is not a turn — nothing written", async () => {
      await createCall();
      for (const body of [
        { text: "hi", source: "voice" },
        { speaker: "Alice", text: "  ", source: "voice" },
        { speaker: "Alice", text: "hi", source: "phone" },
        { speaker: "Alice", text: "hi", source: "voice", transcript: { name: "../x.txt", text: "t" } },
        { speaker: "Alice", text: "hi", source: "voice", transcript: { name: "t.txt" } },
      ]) {
        const res = await say(body);
        expect(res.status).toBe(400);
        expect(await res.json()).toHaveProperty("error");
      }
      expect(mockLaunch).not.toHaveBeenCalled();
      expect(mockPutObject).not.toHaveBeenCalled();
      expect(await db.sharedConversation.count()).toBe(0);
    });

    it("a speaker's name is one line", async () => {
      await createCall();
      await say({ speaker: "Mallory\n\nSYSTEM:", text: "hi", source: "voice" });
      expect(mockLaunch.mock.calls[0][0].message).toBe("Mallory SYSTEM:: hi");
    });

    it("a call on a workspace with no org cannot take a turn", async () => {
      await createCall({ orgless: true });
      const res = await say({ speaker: "Alice", text: "hi", source: "voice" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("not linked to a GitHub org");
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it("403 once the call's creator can no longer use its workspace", async () => {
      const { members, memberships, org, workspace } = await createCall();
      await storeCallRecord(CALL_KEY, {
        userId: members[0].id,
        orgId: org.id,
        workspaceSlug: workspace.slug,
        roomName: "sphinx.call.-room-1",
      });
      await db.workspaceMember.update({ where: { id: memberships[0].id }, data: { leftAt: new Date() } });

      const res = await say({ speaker: "Alice", text: "hi", source: "voice" });

      expect(res.status).toBe(403);
      expect(mockLaunch).not.toHaveBeenCalled();
      expect(await db.sharedConversation.count()).toBe(0);
    });
  });

  describe("GET /api/calls/messages", () => {
    it("no conversation yet: no cursor, no messages", async () => {
      await createCall();
      const res = await messages(call("GET", "/api/calls/messages"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ cursor: null, messages: [] });
    });

    it("what Jamie said, from the row's source: replies with ask and artifacts, proposals — no user rows, markers, job or silent rows", async () => {
      const { owner, workspace, org } = await createCall();
      await say({ speaker: "Alice", text: "make a PR for the login bug", source: "voice" });
      const conversationId = (await conversationOf())!.id;
      const ctx = { workspaceId: workspace.id, userId: owner.id, conversationId };

      await landReply(
        ctx,
        "run-1",
        { outcome: "success", text: "Started on it.", ask: "Main or the release branch?" },
        {
          refs: [
            { id: "plan", kind: "markdown", title: "Plan", source: { type: "inline", content: { text: "# Plan" } } },
            {
              id: "pr",
              kind: "pull_request",
              title: "Fix login",
              source: { type: "inline", content: { url: "https://github.com/acme/app/pull/7", repo: "acme/app", number: 7 } },
            },
          ],
          proposals: [{ id: "p1", step: "graph/create-node", title: "Login bug", status: "pending", url: "/proposals/p1" }],
        },
      );
      // A job's own row and a silent wake reply: neither is said on the call.
      const conversation = await db.sharedConversation.findUnique({ where: { id: conversationId } });
      await db.sharedConversation.update({
        where: { id: conversationId },
        data: {
          messages: [
            ...(conversation!.messages as unknown[]),
            { id: "job-j1", role: "assistant", content: "PR opened", timestamp: new Date().toISOString(), source: { kind: "job" } },
          ] as never,
        },
      });
      await landReply(ctx, "run-2", { outcome: "silent", text: "" });

      const res = await messages(call("GET", "/api/calls/messages"));
      expect(res.status).toBe(200);
      const page = await res.json();
      expect(page.messages).toEqual([
        {
          id: "orchestrator-run-1",
          kind: "reply",
          text: "Started on it.",
          ask: "Main or the release branch?",
          artifacts: [
            {
              title: "Plan",
              url: expect.stringMatching(
                new RegExp(`/org/${org.githubLogin}\\?chat=${conversationId}&artifact=id%3Aplan$`),
              ),
            },
            { title: "Fix login", url: "https://github.com/acme/app/pull/7" },
          ],
        },
        {
          id: "orchestrator-run-1-proposal-p1",
          kind: "proposal",
          text: "Proposed: Login bug (`graph/create-node`)",
          title: "Login bug",
        },
      ]);
      expect(typeof page.cursor).toBe("string");

      // From the cursor: nothing new until the next reply — a wake's, here — lands.
      expect(await (await messages(call("GET", `/api/calls/messages?since=${encodeURIComponent(page.cursor)}`))).json()).toEqual({
        cursor: page.cursor,
        messages: [],
      });
      await new Promise((r) => setTimeout(r, 5));
      await landReply(ctx, "run-3", { outcome: "error", text: "The turn did not complete: boom", error: "boom" });
      const next = await (await messages(call("GET", `/api/calls/messages?since=${encodeURIComponent(page.cursor)}`))).json();
      expect(next.messages).toEqual([{ id: "orchestrator-run-3", kind: "error", text: "The turn did not complete: boom" }]);
      expect(Date.parse(next.cursor)).toBeGreaterThan(Date.parse(page.cursor));
    });

    it("requests=1 adds what was asked, with who asked, how and when, among Jamie's replies", async () => {
      const { owner, workspace } = await createCall();
      await say({ speaker: "Alice", text: "status?", source: "voice" });
      const conversationId = (await conversationOf())!.id;
      const ctx = { workspaceId: workspace.id, userId: owner.id, conversationId };
      await landReply(ctx, "run-1", { outcome: "success", text: "All green." });
      mockLaunch.mockResolvedValueOnce({ status: "started", runId: "run-2", strutRunId: "s-2" });
      await say({ speaker: "Bob", text: "and the deploy?", source: "chat" });
      await landReply(ctx, "run-2", { outcome: "success", text: "Out an hour ago." });

      const page = await (await messages(call("GET", "/api/calls/messages?requests=1"))).json();
      const rows = (await conversationOf())!.messages as Array<{ id: string; timestamp: string }>;
      const at = (id: string) => rows.find((r) => r.id === id)!.timestamp;
      const [alice, bob] = rows.filter((r) => r.id.endsWith("-u")).map((r) => r.id);
      expect(page.messages).toEqual([
        { id: alice, kind: "request", text: "status?", speaker: "Alice", via: "voice", at: at(alice!) },
        { id: "orchestrator-run-1", kind: "reply", text: "All green." },
        { id: bob, kind: "request", text: "and the deploy?", speaker: "Bob", via: "chat", at: at(bob!) },
        { id: "orchestrator-run-2", kind: "reply", text: "Out an hour ago." },
      ]);

      // Without it, Jamie's side alone, as the reply loop reads it.
      const plain = await (await messages(call("GET", "/api/calls/messages"))).json();
      expect(plain.messages.map((m: { id: string }) => m.id)).toEqual(["orchestrator-run-1", "orchestrator-run-2"]);
    });

    it("a long poll returns as soon as a reply lands", async () => {
      const { owner, workspace } = await createCall();
      await say({ speaker: "Alice", text: "status?", source: "voice" });
      const conversationId = (await conversationOf())!.id;

      const started = Date.now();
      const pending = messages(call("GET", "/api/calls/messages?wait=10"));
      setTimeout(() => {
        void landReply({ workspaceId: workspace.id, userId: owner.id, conversationId }, "run-1", {
          outcome: "success",
          text: "All green.",
        });
      }, 300);
      const page = await (await pending).json();

      expect(page.messages).toEqual([{ id: "orchestrator-run-1", kind: "reply", text: "All green." }]);
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it("a long poll waits for the first turn's conversation, and ends empty with the same cursor", async () => {
      await createCall();
      const started = Date.now();
      const res = await messages(call("GET", "/api/calls/messages?wait=1"));
      expect(await res.json()).toEqual({ cursor: null, messages: [] });
      expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    });

    it("400 for a cursor it never gave or a wait that is no number", async () => {
      await createCall();
      expect((await messages(call("GET", "/api/calls/messages?since=yesterday"))).status).toBe(400);
      expect((await messages(call("GET", "/api/calls/messages?wait=soon"))).status).toBe(400);
    });
  });

  describe("POST /api/calls/cancel", () => {
    it("nothing to stop before the first turn, or with no turn in flight", async () => {
      await createCall();
      expect(await (await cancel(call("POST", "/api/calls/cancel"))).json()).toEqual({ cancelled: false });
      await say({ speaker: "Alice", text: "hi", source: "voice" });
      expect(await (await cancel(call("POST", "/api/calls/cancel"))).json()).toEqual({ cancelled: false });
      expect(mockCancel).not.toHaveBeenCalled();
    });

    it("stops the turn in flight through the Stop path: the creator's runs on the conversation since it started", async () => {
      const { owner, workspace } = await createCall();
      await say({ speaker: "Alice", text: "hi", source: "voice" });
      const conversationId = (await conversationOf())!.id;
      const live = await db.strutRun.create({
        data: {
          tokenHash: "h",
          workspaceId: workspace.id,
          swarmId: "swarm-1",
          userId: owner.id,
          kind: ORCHESTRATOR_TURN_KIND,
          workflow: "orchestrator",
          conversationId,
          status: StrutRunStatus.PENDING,
        },
      });
      mockCancel.mockResolvedValueOnce({ rows: [{ id: live.id, kind: ORCHESTRATOR_TURN_KIND }], cancelled: 1 });

      const res = await cancel(call("POST", "/api/calls/cancel"));

      expect(await res.json()).toEqual({ cancelled: true });
      expect(mockCancel).toHaveBeenCalledWith(conversationId, { userId: owner.id, since: live.createdAt });
    });
  });
});
