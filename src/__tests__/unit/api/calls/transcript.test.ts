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
    expire: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
  },
}));

const { mockAccess, mockDispatch } = vi.hoisted(() => ({ mockAccess: vi.fn(), mockDispatch: vi.fn() }));
vi.mock("@/services/workspace", () => ({ validateWorkspaceAccess: mockAccess }));
vi.mock("@/services/strut-runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/strut-runs")>()),
  dispatchStrutRun: mockDispatch,
}));

import { POST } from "@/app/api/calls/transcript/route";
import { storeCallRecord, setCallConversation, peekCallRecord } from "@/lib/calls/callRecord";
import { StrutDispatchError, type StrutDispatchFailureCode } from "@/services/strut-runs";

const VOICE_KEY = "test-voice-agent-key";
const CALL_KEY = "abc123def456abc123def456";
const WORKFLOW = "call-transcript";

const line = (n: number, speaker = "Ann", extra: Record<string, unknown> = {}) =>
  JSON.stringify({ n, at: "2026-01-01T00:00:00Z", speaker, source: "voice", text: "hi", ...extra });
const TEXT = [line(1, "Ann"), line(2, "Jamie"), "", line(3, "Ann")].join("\n");

const goodBody = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  startedAt: "2026-01-01T00:00:00Z",
  endedAt: "2026-01-01T00:10:00Z",
  name: "call.ndjson",
  text: TEXT,
  ...over,
});

function send(body: unknown, opts: { key?: string | null; callKey?: string | null } = {}) {
  const { key = VOICE_KEY, callKey = CALL_KEY } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== null) headers.Authorization = `Bearer ${key}`;
  if (callKey !== null) headers["X-Call-Key"] = callKey;
  return POST(
    new NextRequest("http://localhost:3000/api/calls/transcript", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function makeCall(orgId: string | null = "org-1") {
  await storeCallRecord(CALL_KEY, { userId: "user-1", orgId, workspaceSlug: "ws-slug", roomName: "room-1" });
}

describe("POST /api/calls/transcript", () => {
  const origVoice = process.env.VOICE_AGENT_API_KEY;
  const origWorkflow = process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME;

  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    process.env.VOICE_AGENT_API_KEY = VOICE_KEY;
    process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME = WORKFLOW;
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, workspace: { id: "ws-1" } });
    mockDispatch.mockResolvedValue({ runId: "run-1", strutRunId: "s-1", swarmId: "sw-1" });
  });

  afterEach(() => {
    if (origVoice === undefined) delete process.env.VOICE_AGENT_API_KEY;
    else process.env.VOICE_AGENT_API_KEY = origVoice;
    if (origWorkflow === undefined) delete process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME;
    else process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME = origWorkflow;
  });

  it("401 without the voice key, 404 for an unknown call", async () => {
    await makeCall();
    expect((await send(goodBody(), { key: "wrong" })).status).toBe(401);
    expect((await send(goodBody(), { callKey: "nope" })).status).toBe(404);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("is off when the env is unset", async () => {
    await makeCall();
    delete process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME;
    const res = await send(goodBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "off" });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect([...store.keys()].some((k) => k.startsWith("call-transcript:"))).toBe(false);
  });

  it("is off for a call with no org", async () => {
    await makeCall(null);
    const res = await send(goodBody());
    expect(await res.json()).toEqual({ status: "off" });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect([...store.keys()].some((k) => k.startsWith("call-transcript:"))).toBe(false);
  });

  describe("400", () => {
    beforeEach(makeCall.bind(null, "org-1"));
    const cases: Array<[string, () => unknown]> = [
      ["name with a slash", () => goodBody({ name: "a/b.ndjson" })],
      ["name with a backslash", () => goodBody({ name: "a\\b" })],
      ["name '..'", () => goodBody({ name: ".." })],
      ["empty name", () => goodBody({ name: "" })],
      ["no id", () => goodBody({ id: undefined })],
      ["empty id", () => goodBody({ id: "" })],
      ["bad startedAt", () => goodBody({ startedAt: "nope" })],
      ["empty text", () => goodBody({ text: "  \n" })],
      ["text over 4 MB", () => goodBody({ text: "x".repeat(4 * 1024 * 1024 + 1) })],
      ["non-JSON line", () => goodBody({ text: `${line(1)}\nnot json` })],
      ["array line", () => goodBody({ text: "[1,2]" })],
      ["missing field", () => goodBody({ text: JSON.stringify({ n: 1, at: "x", speaker: "A", source: "voice" }) })],
      ["non-numeric n", () => goodBody({ text: line(1, "Ann", { n: "1" }) })],
      ["array body", () => []],
      ["null body", () => null],
    ];
    it.each(cases)("%s", async (_n, make) => {
      const res = await send(make());
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(store.has(`call-transcript:${CALL_KEY}:job-1`)).toBe(false);
    });
  });

  it("403 when the starter lost the workspace", async () => {
    await makeCall();
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: false, workspace: { id: "ws-1" } });
    expect((await send(goodBody())).status).toBe(403);
    mockAccess.mockResolvedValue({ hasAccess: false, canRead: false });
    expect((await send(goodBody())).status).toBe(403);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("launches a strut run with the transcript as an attachment", async () => {
    await makeCall();
    const res = await send(goodBody());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ run: "run-1" });
    expect(mockAccess).toHaveBeenCalledWith("ws-slug", "user-1");
    const args = mockDispatch.mock.calls[0][0];
    expect(args).toMatchObject({
      workspaceId: "ws-1",
      userId: "user-1",
      kind: "call_transcript",
      purpose: "call_transcript",
      workflow: WORKFLOW,
      input: {
        room: "room-1",
        workspace: "ws-slug",
        conversation: null,
        startedAt: "2026-01-01T00:00:00Z",
        endedAt: "2026-01-01T00:10:00Z",
        lines: 3,
        speakers: ["Ann", "Jamie"],
        file: "call.ndjson",
      },
    });
    expect(args.attachments).toHaveLength(1);
    expect(args.attachments[0].name).toBe("call.ndjson");
    expect(args.attachments[0].mediaType).toBe("application/x-ndjson");
    expect(Buffer.from(args.attachments[0].data, "base64").toString("utf8")).toBe(TEXT);
  });

  it("passes the call's conversation id", async () => {
    await makeCall();
    await setCallConversation(CALL_KEY, (await peekCallRecord(CALL_KEY))!, "conv-9");
    await send(goodBody());
    expect(mockDispatch.mock.calls[0][0].input.conversation).toBe("conv-9");
  });

  it("a retry gets the first response and launches once; another id launches again", async () => {
    await makeCall();
    expect((await send(goodBody())).status).toBe(202);
    const retry = await send(goodBody());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ run: "run-1" });
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    mockDispatch.mockResolvedValue({ runId: "run-2", strutRunId: "s-2", swarmId: "sw-1" });
    const other = await send(goodBody({ id: "job-2" }));
    expect(other.status).toBe(202);
    expect(await other.json()).toEqual({ run: "run-2" });
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });

  it("503 while the first attempt is still pending", async () => {
    await makeCall();
    store.set(`call-transcript:${CALL_KEY}:job-1`, "pending");
    expect((await send(goodBody())).status).toBe(503);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("clears the key when the launch fails so a retry launches", async () => {
    await makeCall();
    mockDispatch.mockRejectedValueOnce(new StrutDispatchError("unreachable", "down"));
    expect((await send(goodBody())).status).toBe(502);
    expect(store.has(`call-transcript:${CALL_KEY}:job-1`)).toBe(false);
    expect((await send(goodBody())).status).toBe(202);
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });

  it.each<[StrutDispatchFailureCode, number]>([
    ["no_target", 422],
    ["workflow_missing", 422],
    ["unreachable", 502],
    ["strut_http", 502],
  ])("maps %s to %i", async (code, status) => {
    await makeCall();
    mockDispatch.mockRejectedValueOnce(new StrutDispatchError(code, `msg ${code}`));
    const res = await send(goodBody());
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: `msg ${code}` });
  });

  it("500 on an unexpected error", async () => {
    await makeCall();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDispatch.mockRejectedValueOnce(new Error("boom"));
    expect((await send(goodBody())).status).toBe(500);
  });
});
