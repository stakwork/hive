/**
 * POST /api/tribes/log (`docs/plans/jamie-in-tribes.md`, "The log"): Jamie
 * hands Hive a batch of what was said in a linked tribe, and Hive launches
 * the strut workflow TRIBE_MESSAGES_STRUT_WORKFLOW_NAME names with the batch
 * as the run's attachment, as the person who linked the tribe.
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
  },
}));

const { mockFindLink, mockAccess, mockDispatch } = vi.hoisted(() => ({
  mockFindLink: vi.fn(),
  mockAccess: vi.fn(),
  mockDispatch: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { tribeLink: { findUnique: mockFindLink } } }));
vi.mock("@/services/workspace", () => ({ validateWorkspaceAccess: mockAccess }));
vi.mock("@/services/strut-runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/strut-runs")>()),
  dispatchStrutRun: mockDispatch,
}));

import { POST } from "@/app/api/tribes/log/route";
import { batchAliases, batchFile, parseBatch } from "@/lib/tribes/tribeLog";
import { StrutDispatchError } from "@/services/strut-runs";

const TOKEN = "test-jamie-token";
const WORKFLOW = "tribe-messages";
const PUBKEY = "02" + "a".repeat(64);
const LINK = { name: "Builders", tribeHost: "tribes.v2.sphinx.chat", workspaceSlug: "acme", userId: "user-1" };

const msg = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  time: "2026-10-30T14:03:12Z",
  alias: "Alice",
  owner: false,
  text: `said ${id}`,
  ...over,
});

const goodBody = (over: Record<string, unknown> = {}) => ({
  batch: "b-1",
  tribe: { pubkey: PUBKEY, name: "Builders" },
  messages: [
    msg("m-1", { owner: true }),
    msg("m-2", { alias: "Jamie", mine: true, time: "2026-10-30T14:03:40Z", replyTo: "m-1", thread: "m-1" }),
    msg("m-3", { alias: "Bob", time: "2026-10-30T14:05:00Z" }),
  ],
  ...over,
});

function send(body: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return POST(
    new NextRequest("http://localhost:3000/api/tribes/log", { method: "POST", headers, body: JSON.stringify(body) }),
  );
}

describe("POST /api/tribes/log", () => {
  const origToken = process.env.JAMIE_SERVICE_TOKEN;
  const origWorkflow = process.env.TRIBE_MESSAGES_STRUT_WORKFLOW_NAME;

  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    process.env.JAMIE_SERVICE_TOKEN = TOKEN;
    process.env.TRIBE_MESSAGES_STRUT_WORKFLOW_NAME = WORKFLOW;
    mockFindLink.mockResolvedValue(LINK);
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, workspace: { id: "ws-1" } });
    mockDispatch.mockResolvedValue({ runId: "run-1", strutRunId: "s-1", swarmId: "sw-1" });
  });

  afterEach(() => {
    if (origToken === undefined) delete process.env.JAMIE_SERVICE_TOKEN;
    else process.env.JAMIE_SERVICE_TOKEN = origToken;
    if (origWorkflow === undefined) delete process.env.TRIBE_MESSAGES_STRUT_WORKFLOW_NAME;
    else process.env.TRIBE_MESSAGES_STRUT_WORKFLOW_NAME = origWorkflow;
  });

  it("401 without Jamie's token; 503 while Jamie is not configured", async () => {
    expect((await send(goodBody(), "wrong")).status).toBe(401);
    expect((await send(goodBody(), null)).status).toBe(401);
    delete process.env.JAMIE_SERVICE_TOKEN;
    expect((await send(goodBody())).status).toBe(503);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("is off when the env is unset: 200, nothing read or launched", async () => {
    delete process.env.TRIBE_MESSAGES_STRUT_WORKFLOW_NAME;
    const res = await send(goodBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "off" });
    expect(mockFindLink).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  describe("400", () => {
    const cases: Array<[string, () => unknown]> = [
      ["no batch", () => goodBody({ batch: undefined })],
      ["empty batch", () => goodBody({ batch: " " })],
      ["a bad tribe pubkey", () => goodBody({ tribe: { pubkey: "nope" } })],
      ["no messages", () => goodBody({ messages: [] })],
      ["messages not a list", () => goodBody({ messages: {} })],
      ["over 500 messages", () => goodBody({ messages: Array.from({ length: 501 }, (_, i) => msg(`m-${i}`)) })],
      ["a message with no id", () => goodBody({ messages: [msg("")] })],
      ["a message with a bad time", () => goodBody({ messages: [msg("m-1", { time: "yesterday" })] })],
      ["a message with no text", () => goodBody({ messages: [msg("m-1", { text: "  " })] })],
      ["a message over 20k characters", () => goodBody({ messages: [msg("m-1", { text: "x".repeat(20_001) })] })],
      ["a message that is not an object", () => goodBody({ messages: ["hi"] })],
      ["an array body", () => []],
      ["a null body", () => null],
    ];
    it.each(cases)("%s", async (_n, make) => {
      const res = await send(make());
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  it("404 for a tribe that is not linked", async () => {
    mockFindLink.mockResolvedValue(null);
    expect((await send(goodBody())).status).toBe(404);
    expect(mockFindLink).toHaveBeenCalledWith(expect.objectContaining({ where: { tribePubkey: PUBKEY } }));
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("403 when the linker can no longer use the workspace", async () => {
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: false, workspace: { id: "ws-1" } });
    expect((await send(goodBody())).status).toBe(403);
    mockAccess.mockResolvedValue({ hasAccess: false, canRead: false });
    expect((await send(goodBody())).status).toBe(403);
    expect(mockAccess).toHaveBeenCalledWith("acme", "user-1");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("launches the workflow as the linker, with the batch as the run's attachment", async () => {
    const res = await send(goodBody());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ run: "run-1" });
    const args = mockDispatch.mock.calls[0][0];
    expect(args).toMatchObject({
      workspaceId: "ws-1",
      userId: "user-1",
      kind: "tribe_messages",
      purpose: "tribe_messages",
      workflow: WORKFLOW,
      input: {
        tribe: { pubkey: PUBKEY, name: "Builders", host: "tribes.v2.sphinx.chat" },
        workspace: "acme",
        from: "2026-10-30T14:03:12.000Z",
        to: "2026-10-30T14:05:00.000Z",
        messages: 3,
        aliases: ["Alice", "Bob"],
        file: "tribe-messages.jsonl",
      },
    });
    expect(args.attachments).toHaveLength(1);
    expect(args.attachments[0]).toMatchObject({ name: "tribe-messages.jsonl", mediaType: "application/x-ndjson" });
    const lines = Buffer.from(args.attachments[0].data, "base64")
      .toString("utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { id: "m-1", time: "2026-10-30T14:03:12.000Z", alias: "Alice", owner: true, mine: false, text: "said m-1" },
      {
        id: "m-2",
        time: "2026-10-30T14:03:40.000Z",
        alias: "Jamie",
        owner: false,
        mine: true,
        text: "said m-2",
        replyTo: "m-1",
        thread: "m-1",
      },
      { id: "m-3", time: "2026-10-30T14:05:00.000Z", alias: "Bob", owner: false, mine: false, text: "said m-3" },
    ]);
  });

  it("names the tribe as the link has it when the batch does not", async () => {
    await send(goodBody({ tribe: { pubkey: PUBKEY } }));
    expect(mockDispatch.mock.calls[0][0].input.tribe).toEqual({
      pubkey: PUBKEY,
      name: "Builders",
      host: "tribes.v2.sphinx.chat",
    });
  });

  it("a retry of a batch gets the first answer and launches once; another batch launches again", async () => {
    expect((await send(goodBody())).status).toBe(202);
    const retry = await send(goodBody());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ run: "run-1" });
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    mockDispatch.mockResolvedValue({ runId: "run-2", strutRunId: "s-2", swarmId: "sw-1" });
    const other = await send(goodBody({ batch: "b-2" }));
    expect(other.status).toBe(202);
    expect(await other.json()).toEqual({ run: "run-2" });
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });

  it("503 while the same batch is being sent", async () => {
    store.set(`tribe-log:${PUBKEY}:b-1`, "pending");
    expect((await send(goodBody())).status).toBe(503);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("a failed launch frees the batch for the retry: 502 for strut, 422 for no strut or no workflow", async () => {
    mockDispatch.mockRejectedValueOnce(
      new StrutDispatchError("unreachable", "Could not reach strut on the workspace swarm."),
    );
    expect((await send(goodBody())).status).toBe(502);
    expect(store.has(`tribe-log:${PUBKEY}:b-1`)).toBe(false);

    mockDispatch.mockRejectedValueOnce(new StrutDispatchError("workflow_missing", "No such workflow."));
    expect((await send(goodBody())).status).toBe(422);
    mockDispatch.mockRejectedValueOnce(new StrutDispatchError("no_target", "No strut for this org."));
    expect((await send(goodBody())).status).toBe(422);

    expect((await send(goodBody())).status).toBe(202);
  });
});

describe("the batch file", () => {
  it("one JSON object per message, in the order sent; an alias is one line, and a message with none names someone", () => {
    const batch = parseBatch(
      goodBody({
        messages: [
          msg("m-1", { alias: "  Ann \n Lee " }),
          msg("m-2", { alias: undefined }),
          msg("m-3", { alias: "Ann Lee" }),
        ],
      }),
    );
    if (typeof batch === "string") throw new Error(batch);
    expect(batch.messages.map((m) => m.alias)).toEqual(["Ann Lee", "A member", "Ann Lee"]);
    expect(batchAliases(batch.messages)).toEqual(["Ann Lee", "A member"]);
    expect(
      batchFile(batch.messages)
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l).id),
    ).toEqual(["m-1", "m-2", "m-3"]);
  });

  it("Jamie's own messages are kept, never among the aliases", () => {
    const batch = parseBatch(goodBody({ messages: [msg("m-1", { alias: "Jamie", mine: true })] }));
    if (typeof batch === "string") throw new Error(batch);
    expect(batch.messages[0].mine).toBe(true);
    expect(batchAliases(batch.messages)).toEqual([]);
  });
});

describe("parseBatch: a deleted line", () => {
  const line = { id: "m1", time: "2026-10-31T14:03:12Z", alias: "Bob", owner: false, mine: false };

  it("carries no text and keeps `deleted`; a line with no text and no `deleted` is refused", () => {
    const ok = parseBatch({ batch: "b1", tribe: { pubkey: "02" + "a".repeat(64) }, messages: [{ ...line, text: "", deleted: true }] });
    expect(typeof ok).not.toBe("string");
    expect((ok as { messages: unknown[] }).messages[0]).toEqual({ ...line, time: "2026-10-31T14:03:12.000Z", text: "", deleted: true });
    expect(parseBatch({ batch: "b1", tribe: { pubkey: "02" + "a".repeat(64) }, messages: [{ ...line, text: "" }] })).toBe(
      "messages[0].text is required",
    );
  });
});

describe("parseBatch: a line that is not words", () => {
  const tribe = { pubkey: "02" + "a".repeat(64) };
  const line = { id: "b1", time: "2026-10-31T14:03:12Z", alias: "Bob", owner: false, mine: false };

  it("keeps its kind, and a boost's sats and the message it boosts; an unknown kind or odd sats is refused", () => {
    const ok = parseBatch({ batch: "b1", tribe, messages: [{ ...line, text: "(boosted Carol's message, 100 sats)", kind: "boost", sats: 100, replyTo: "c1" }] });
    expect((ok as { messages: unknown[] }).messages[0]).toEqual({
      ...line,
      time: "2026-10-31T14:03:12.000Z",
      text: "(boosted Carol's message, 100 sats)",
      kind: "boost",
      sats: 100,
      replyTo: "c1",
    });
    const join = parseBatch({ batch: "b2", tribe, messages: [{ ...line, text: "(joined)", kind: "join" }] });
    expect((join as { messages: Array<{ kind?: string; sats?: number }> }).messages[0]).toMatchObject({ kind: "join" });
    expect((join as { messages: Array<{ sats?: number }> }).messages[0].sats).toBeUndefined();
    expect(parseBatch({ batch: "b3", tribe, messages: [{ ...line, text: "x", kind: "dance" }] })).toBe(
      "messages[0].kind must be call, join, leave, boost or file",
    );
    expect(parseBatch({ batch: "b4", tribe, messages: [{ ...line, text: "x", kind: "boost", sats: 1.5 }] })).toBe(
      "messages[0].sats must be a whole number of sats",
    );
  });
});
