/**
 * POST /api/tribes/messages with a `sender` (`docs/plans/jamie-in-tribes.md`,
 * "A mention"; stakwork/sphinx `docs/tribe-sender-identity.md`): the body's
 * `sender` checked, the turn run as the member the tribe names, and a reply
 * to a proposal post decided by the person the proposing turn ran as.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

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
    expire: vi.fn(async () => 1),
    eval: vi.fn(async (_lua: string, _n: number, key: string) => (store.delete(key) ? 1 : 0)),
  },
}));

const m = vi.hoisted(() => ({
  findLink: vi.fn(),
  findThread: vi.fn(),
  createThread: vi.fn(),
  findConversation: vi.fn(),
  findMention: vi.fn(),
  findMentions: vi.fn(),
  createMention: vi.fn(),
  createMentions: vi.fn(),
  createOutbox: vi.fn(),
  findOrg: vi.fn(),
  findUser: vi.fn(),
  transaction: vi.fn(),
  userByPubkey: vi.fn(),
  access: vi.fn(),
  launch: vi.fn(),
  live: vi.fn(),
  persist: vi.fn(),
  resolveTurn: vi.fn(),
  decide: vi.fn(),
  appendResult: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    tribeLink: { findUnique: m.findLink, update: vi.fn() },
    tribeThread: { findFirst: m.findThread, create: m.createThread },
    sharedConversation: { findUnique: m.findConversation },
    tribeMention: {
      findUnique: m.findMention,
      findMany: m.findMentions,
      create: m.createMention,
      createMany: m.createMentions,
      delete: vi.fn(),
    },
    tribeOutboxEntry: { create: m.createOutbox, findFirst: vi.fn() },
    sourceControlOrg: { findUnique: m.findOrg },
    user: { findUnique: m.findUser },
    $transaction: m.transaction,
  },
}));
vi.mock("@/lib/auth/lightning-pubkey", () => ({ userByLightningPubkey: m.userByPubkey }));
vi.mock("@/services/workspace", () => ({ validateWorkspaceAccess: m.access }));
vi.mock("@/services/strut-orchestrator", () => ({ launchOrchestratorTurn: m.launch, orchestratorHasLiveTurn: m.live }));
vi.mock("@/services/org-canvas-conversation", () => ({ persistCanvasUserMessage: m.persist }));
vi.mock("@/lib/ai/resolve-model", () => ({ loadUserChatAgentModel: vi.fn(async () => null) }));
vi.mock("@/lib/pusher", () => ({ notifyInitiativeUpdated: vi.fn() }));
vi.mock("@/services/s3", () => ({ getS3Service: vi.fn() }));
vi.mock("@/services/strut-proposals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/strut-proposals")>()),
  resolveProposalTurn: m.resolveTurn,
  decideStrutProposal: m.decide,
  appendProposalResultRow: m.appendResult,
}));

import { POST } from "@/app/api/tribes/messages/route";

const TOKEN = "test-jamie-token";
const TRIBE = "02" + "a".repeat(64);
const ALICE_KEY = "03" + "a1".repeat(32);
const BOB_KEY = "03" + "b2".repeat(32);
const LINKER = "u-linker";
const LINK = { id: "l1", tribePubkey: TRIBE, name: "Builders", orgId: "org-1", workspaceSlug: "acme", userId: LINKER };
const USERS: Record<string, string> = { [ALICE_KEY]: "u-alice", [BOB_KEY]: "u-bob" };

const body = (over: Record<string, unknown> = {}) => ({
  id: "msg-1",
  tribe: { pubkey: TRIBE, name: "Builders" },
  alias: "Alice",
  owner: false,
  text: "@jamie open a PR for the login bug",
  ...over,
});

function send(json: unknown) {
  return POST(
    new NextRequest("http://localhost:3000/api/tribes/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(json),
    }),
  );
}

describe("POST /api/tribes/messages: who is speaking", () => {
  const saved = process.env.JAMIE_SERVICE_TOKEN;

  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    process.env.JAMIE_SERVICE_TOKEN = TOKEN;
    m.findLink.mockResolvedValue(LINK);
    m.userByPubkey.mockImplementation(async (pubkey: string) => (USERS[pubkey] ? { id: USERS[pubkey] } : null));
    m.access.mockImplementation(async (_slug: string, userId: string) =>
      userId === "u-outsider"
        ? { hasAccess: false, canRead: false }
        : { hasAccess: true, canRead: true, workspace: { id: "ws-1" } },
    );
    m.findMentions.mockResolvedValue([]);
    m.findMention.mockResolvedValue(null);
    m.findThread.mockResolvedValue(null);
    m.createThread.mockResolvedValue({ id: "t-new" });
    m.live.mockResolvedValue(false);
    m.persist.mockResolvedValue("c-new");
    m.findUser.mockResolvedValue({ timezone: "UTC" });
    m.launch.mockResolvedValue({ status: "started", runId: "run-1", strutRunId: "s-1" });
    m.transaction.mockResolvedValue([]);
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.JAMIE_SERVICE_TOKEN;
    else process.env.JAMIE_SERVICE_TOKEN = saved;
  });

  describe("the body's sender", () => {
    it("a malformed sender, or a burst line's, is a 400 with the others' errors", async () => {
      for (const [over, error] of [
        [{ sender: "02abc" }, "sender must be a Sphinx pubkey (66 hex characters)"],
        [{ sender: 7 }, "sender must be a Sphinx pubkey (66 hex characters)"],
        [
          { earlier: [{ id: "msg-0", alias: "Bob", text: "and this", sender: "nope" }] },
          "earlier[0].sender must be a Sphinx pubkey (66 hex characters)",
        ],
      ] as const) {
        const res = await send(body(over));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error });
      }
      expect(m.findLink).not.toHaveBeenCalled();
    });

    it("a valid sender in any case, an empty one, or none is a mention", async () => {
      for (const sender of [ALICE_KEY.toUpperCase(), "", null, undefined]) {
        m.findLink.mockResolvedValueOnce(null);
        const res = await send(body({ sender, earlier: [{ id: "msg-0", alias: "Bob", text: "x", sender: BOB_KEY }] }));
        expect(res.status).toBe(404);
      }
    });
  });

  describe("the turn", () => {
    it("a sender Hive knows as a member of the workspace: the turn runs as them, the conversation stays the linker's", async () => {
      const res = await send(body({ sender: ALICE_KEY.toUpperCase() }));

      expect(res.status).toBe(202);
      expect(m.userByPubkey).toHaveBeenCalledWith(ALICE_KEY);
      expect(m.access).toHaveBeenCalledWith("acme", LINKER);
      expect(m.access).toHaveBeenCalledWith("acme", "u-alice");
      expect(m.persist).toHaveBeenCalledWith(expect.objectContaining({ userId: LINKER }));
      expect(m.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "u-alice",
          conversationId: "c-new",
          tribe: { name: "Builders", alias: "Alice", asker: true },
        }),
      );
    });

    it("no sender, a pubkey Hive does not know, or a member who cannot use the workspace: the linker's turn, as before", async () => {
      USERS["02" + "c3".repeat(32)] = "u-outsider";
      for (const sender of [undefined, "02" + "ff".repeat(32), "02" + "c3".repeat(32)]) {
        m.launch.mockClear();
        store.clear();
        expect((await send(body({ sender }))).status).toBe(202);
        expect(m.launch).toHaveBeenCalledWith(
          expect.objectContaining({ userId: LINKER, tribe: { name: "Builders", alias: "Alice" } }),
        );
      }
      delete USERS["02" + "c3".repeat(32)];
    });

    it("the linker's access stays the first gate, whoever asks", async () => {
      m.access.mockResolvedValueOnce({ hasAccess: false, canRead: false });
      m.createOutbox.mockResolvedValue({});
      const res = await send(body({ sender: ALICE_KEY }));
      expect(res.status).toBe(403);
      expect(m.launch).not.toHaveBeenCalled();
    });
  });

  describe("deciding by reply", () => {
    const AT = "2026-11-01T10:00:00.000Z";
    const rows = [
      {
        id: "orchestrator-run-1",
        role: "assistant",
        content: "Proposed.",
        timestamp: AT,
        source: { kind: "orchestrator", runId: "run-1" },
      },
      {
        id: "orchestrator-run-1-proposal-p1",
        role: "assistant",
        content: "Proposed: Login bug",
        timestamp: AT,
        source: { kind: "proposal", runId: "run-1", proposalId: "p1", title: "Login bug", status: "pending" },
      },
    ];
    const reply = (over: Record<string, unknown>) =>
      send(body({ id: "msg-2", thread: "t1", replyTo: "t1:orchestrator-run-1-proposal-p1", text: "approve", ...over }));
    /** The proposing turn ran as `turnUser`. */
    const proposedBy = (turnUser: string) => {
      m.findThread.mockResolvedValue({ id: "t1", conversationId: "c1" });
      m.findConversation.mockResolvedValue({ messages: rows });
      m.findOrg.mockResolvedValue({ githubLogin: "acme" });
      m.resolveTurn.mockResolvedValue({
        id: "run-1",
        workspaceId: "ws-1",
        swarmId: "sw-1",
        userId: turnUser,
        workflow: "orchestrator",
        strutRunId: "s-1",
        conversationId: "c1",
        workspaceSlug: "acme",
      });
      m.decide.mockResolvedValue({
        status: 200,
        proposal: { id: "p1", status: "applied", title: "Login bug", workspaceSlug: "acme" },
      });
      m.findUser.mockResolvedValue({ name: "Alice Smith", sphinxAlias: "alice" });
    };

    it("the member the turn ran as, named by the reply's sender, decides it as them; no turn", async () => {
      proposedBy("u-alice");

      const res = await reply({ sender: ALICE_KEY });

      expect(await res.json()).toEqual({ decided: "applied" });
      expect(m.decide).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u-alice" }),
        "p1",
        { action: "accept" },
        "u-alice",
      );
      // Read as the linker (whose conversation it is), then checked as the member, as Hive's card checks its clicker.
      expect(m.resolveTurn.mock.calls.map((c) => c[0].userId)).toEqual([LINKER, "u-alice"]);
      expect(m.launch).not.toHaveBeenCalled();
    });

    it("another member the tribe names is told whose it is; nothing is decided", async () => {
      proposedBy("u-alice");

      const res = await reply({ sender: BOB_KEY, alias: "Bob" });

      expect(await res.json()).toEqual({ refused: "Alice Smith's to decide." });
      expect(m.findUser).toHaveBeenCalledWith({ where: { id: "u-alice" }, select: { name: true, sphinxAlias: true } });
      expect(m.decide).not.toHaveBeenCalled();
      expect(m.launch).not.toHaveBeenCalled();
    });

    it("the owner's reply with no sender decides a turn that ran as the linker, as before senders", async () => {
      proposedBy(LINKER);

      const res = await reply({ owner: true });

      expect(await res.json()).toEqual({ decided: "applied" });
      expect(m.decide).toHaveBeenCalledWith(
        expect.objectContaining({ userId: LINKER }),
        "p1",
        { action: "accept" },
        LINKER,
      );
      expect(m.resolveTurn).toHaveBeenCalledTimes(1);
    });

    it("the owner's reply with no sender on a member's turn is told whose it is; anyone unnamed on the linker's, only the owner", async () => {
      proposedBy("u-alice");
      expect(await (await reply({ owner: true })).json()).toEqual({ refused: "Alice Smith's to decide." });

      proposedBy(LINKER);
      m.findUser.mockResolvedValue({ name: null, sphinxAlias: null });
      expect(await (await reply({ id: "msg-3" })).json()).toEqual({
        refused: "Only the tribe's owner can decide this one.",
      });
      expect(m.decide).not.toHaveBeenCalled();
    });

    it("the linker named by the reply's sender decides their own turn without the owner flag", async () => {
      USERS["02" + "dd".repeat(32)] = LINKER;
      proposedBy(LINKER);
      expect(await (await reply({ sender: "02" + "dd".repeat(32) })).json()).toEqual({ decided: "applied" });
      expect(m.decide).toHaveBeenCalledWith(expect.anything(), "p1", { action: "accept" }, LINKER);
      delete USERS["02" + "dd".repeat(32)];
    });
  });
});
