/**
 * Unit tests for `services/strut-orchestrator.ts` — Jamie on strut: the
 * launch of one `orchestrator` turn through the REAL `dispatchStrutRun`
 * (strut reached through a mocked `fetch`), so the exact POST body and
 * headers strut receives are what is asserted:
 *
 *   - the target is the org default for THIS user (purpose `orchestrator`);
 *     the launch carries `x-api-token` + `x-strut-actor`; the body is
 *     exactly `{ input: { prompt (workspace line + message), session (the
 *     conversation), context: { line } }, callback: { url }, jobCallback:
 *     { url } }` — no job, no title, and `params` only for the person's
 *     model pick (`params.model`); the jobCallback is the
 *     row's job-events URL, which the jobs the turn starts inherit (strut
 *     CALLBACKS.md §5), and an older strut's 400 to it relaunches without;
 *   - the message's files ride as `attachments` (read from S3 as this
 *     user), one strut cannot take named after the message instead;
 *   - the row is the kind's, on the conversation; the run is registered for
 *     Stop; the launch-marker row is written AFTER strut accepted;
 *   - busy: a PENDING turn of the conversation refuses before any launch;
 *     strut's `session_busy:` / 409 reads as busy, not an error;
 *   - refusals: no `orchestrator` workflow on the swarm, no target;
 *   - the route's answer: a UI-message stream with no text for a launch,
 *     the notice as text for busy / refused, the conversation id on the
 *     header;
 *   - the wait of a caller that answers in-request (the sync route): the
 *     reply and its proposal rows once strut reported the run, never the
 *     launch marker; `null` past the deadline or for a run that is gone.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockStrutRun,
  mockOrgFindUnique,
  mockResolveStrutTarget,
  mockEnsureStrutDelegation,
  mockEnsureStrutActorSecrets,
  mockSetActiveRun,
  mockNotifyRunActive,
  mockAppendRows,
  mockHandler,
  mockCanReadKey,
  mockGetObject,
  mockConversationFindUnique,
} = vi.hoisted(() => ({
  mockStrutRun: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  mockOrgFindUnique: vi.fn(),
  mockResolveStrutTarget: vi.fn(),
  mockEnsureStrutDelegation: vi.fn(),
  mockEnsureStrutActorSecrets: vi.fn(),
  mockSetActiveRun: vi.fn(),
  mockNotifyRunActive: vi.fn(),
  mockAppendRows: vi.fn(),
  mockHandler: vi.fn(),
  mockCanReadKey: vi.fn(),
  mockGetObject: vi.fn(),
  mockConversationFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    strutRun: mockStrutRun,
    sourceControlOrg: { findUnique: mockOrgFindUnique },
    swarm: { findUnique: vi.fn() },
    sharedConversation: { findUnique: mockConversationFindUnique },
  },
}));
vi.mock("@/services/strut-target", () => ({
  resolveStrutTarget: mockResolveStrutTarget,
  describeStrutTargetError: (e: { type: string }) => `target: ${e.type}`,
}));
vi.mock("@/services/bifrost/strut-delegation", () => ({
  STRUT_ACTOR_HEADER: "x-strut-actor",
  ensureStrutDelegation: mockEnsureStrutDelegation,
  strutLabBaseUrl: (u: string) => `${u.replace("/api", ":3355")}/lab`,
}));
vi.mock("@/services/strut-actor-secret", () => ({ ensureStrutActorSecrets: mockEnsureStrutActorSecrets }));
vi.mock("@/services/canvas-active-runs-hooks", () => ({
  setActiveRun: mockSetActiveRun,
  notifyRunActive: mockNotifyRunActive,
}));
vi.mock("@/services/strut-runs/orchestrator-turn", () => ({
  appendOrchestratorRows: mockAppendRows,
  handleOrchestratorTurnSettled: mockHandler,
}));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: { getInstance: () => ({ decryptField: (_f: string, v: string) => v }) },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/ai/resolveMessageAttachments", () => ({ canReadKey: mockCanReadKey }));
vi.mock("@/services/s3", () => ({ getS3Service: () => ({ getObject: mockGetObject }) }));

import { logger } from "@/lib/logger";
import { orchestratorTribeLine } from "@/lib/strut-orchestrator";
import { awaitOrchestratorReply, launchOrchestratorTurn, runOrchestratorTurn } from "@/services/strut-orchestrator";

const TARGET = {
  swarmId: "swarm-1",
  workspaceId: "ws-default",
  workspaceSlug: "acme-default",
  orgId: "org-1",
  swarmUrl: "https://acme.sphinx.chat/api",
  mcpBase: "https://acme.sphinx.chat:3355",
  labBase: "https://acme.sphinx.chat:3355/lab",
  swarmApiKey: "swarm-key",
  actor: "alice-user-1",
};

const mockFetch = vi.fn();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const args = {
  userId: "user-1",
  orgId: "org-1",
  conversationId: "conv-1",
  message: "Add a Concept for billing retries",
  publicBaseUrl: "https://hive.example.com",
  timeZone: "Europe/London",
  now: new Date("2026-10-19T13:02:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockStrutRun.findFirst.mockResolvedValue(null); // no live turn
  mockStrutRun.create.mockResolvedValue({ id: "row-1" });
  mockStrutRun.update.mockResolvedValue({});
  mockStrutRun.updateMany.mockResolvedValue({ count: 1 });
  mockOrgFindUnique.mockResolvedValue({ githubLogin: "acme-gh" });
  mockResolveStrutTarget.mockResolvedValue({ ok: true, target: TARGET });
  mockEnsureStrutDelegation.mockResolvedValue(undefined);
  mockEnsureStrutActorSecrets.mockResolvedValue(undefined);
  mockSetActiveRun.mockResolvedValue({ abortSelf: false });
  mockNotifyRunActive.mockResolvedValue(undefined);
  mockAppendRows.mockResolvedValue({ appended: ["orchestrator-launch-row-1"], duplicate: [], skipped: false });
  mockFetch.mockResolvedValue(json(202, { runId: "1790000000001", callback: true }));
  mockCanReadKey.mockResolvedValue(true);
});

describe("launchOrchestratorTurn", () => {
  it("POSTs exactly the orchestrator's input with the conversation as the session, as this user, with a callback", async () => {
    const out = await launchOrchestratorTurn(args);
    expect(out).toEqual({ status: "started", runId: "row-1", strutRunId: "1790000000001" });

    // The target: the org default, for THIS user, by the org's login.
    expect(mockResolveStrutTarget).toHaveBeenCalledWith({
      purpose: "orchestrator",
      userId: "user-1",
      orgGithubLogin: "acme-gh",
    });

    // The row: the kind's, on the conversation, the launched input recorded.
    expect(mockStrutRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "ws-default",
          swarmId: "swarm-1",
          userId: "user-1",
          kind: "orchestrator_turn",
          workflow: "orchestrator",
          conversationId: "conv-1",
          input: {
            prompt: "@acme-default\nAdd a Concept for billing retries",
            session: "conv-1",
            context: { line: "Mon 19 Oct, 14:02, Europe/London. " },
          },
        }),
      }),
    );
    expect(mockStrutRun.create.mock.calls[0][0].data).not.toHaveProperty("jobId");

    // The launch strut receives.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://acme.sphinx.chat:3355/lab/workflows/orchestrator/run");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-api-token": "swarm-key",
      "x-strut-actor": "alice-user-1",
    });
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body).sort()).toEqual(["callback", "input", "jobCallback"]);
    expect(body.input).toEqual({
      prompt: "@acme-default\nAdd a Concept for billing retries",
      session: "conv-1",
      context: { line: "Mon 19 Oct, 14:02, Europe/London. " },
    });
    expect(body.callback.url).toMatch(
      /^https:\/\/hive\.example\.com\/api\/strut-runs\/webhook\?id=row-1&token=[0-9a-f]{64}$/,
    );
    // The jobs this turn starts report live to the row's events URL, same token.
    expect(body.jobCallback.url).toMatch(
      /^https:\/\/hive\.example\.com\/api\/strut-jobs\/events\?id=row-1&token=[0-9a-f]{64}$/,
    );
    expect(new URL(body.jobCallback.url).searchParams.get("token")).toBe(new URL(body.callback.url).searchParams.get("token"));

    // Registered for Stop; the launch marker written AFTER strut accepted, into the conversation.
    expect(mockSetActiveRun).toHaveBeenCalledWith(
      "conv-1",
      expect.objectContaining({ requestId: "row-1", workspaceId: "ws-default" }),
      "row-1",
    );
    expect(mockNotifyRunActive).toHaveBeenCalledWith("conv-1", true);
    expect(mockAppendRows).toHaveBeenCalledWith(
      { workspaceId: "ws-default", userId: "user-1", conversationId: "conv-1" },
      [{ id: "orchestrator-launch-row-1", content: "", source: { kind: "orchestrator_launch", runId: "row-1" } }],
    );
  });

  it("the person's model pick goes to strut as params.model, beside the input", async () => {
    await launchOrchestratorTurn({ ...args, model: "anthropic/claude-sonnet-5-5" });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.params).toEqual({ model: "anthropic/claude-sonnet-5-5" });
    expect(body.input).not.toHaveProperty("model");
  });

  it("strut honoring the jobCallback marks the row; an older strut's 400 to it is a launch without, not a failed turn", async () => {
    mockFetch.mockResolvedValueOnce(json(202, { runId: "1790000000001", callback: true, jobCallback: true }));
    await launchOrchestratorTurn(args);
    expect(mockStrutRun.update.mock.calls.at(-1)?.[0].data).toEqual({ strutRunId: "1790000000001", liveUpdates: true });

    vi.clearAllMocks();
    mockFetch
      .mockResolvedValueOnce(json(400, { error: "jobCallback belongs to a job: pass it with `job`" }))
      .mockResolvedValueOnce(json(202, { runId: "1790000000002", callback: true }));
    expect(await launchOrchestratorTurn(args)).toEqual({ status: "started", runId: "row-1", strutRunId: "1790000000002" });
    const bodies = mockFetch.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies.map((b) => Object.keys(b).sort())).toEqual([
      ["callback", "input", "jobCallback"],
      ["callback", "input"],
    ]);
    expect(mockStrutRun.update.mock.calls.at(-1)?.[0].data).toEqual({ strutRunId: "1790000000002" });
    expect(mockStrutRun.updateMany).not.toHaveBeenCalled();
  });

  it("a wake's launch marker carries the wake id — its idempotency mark — and strut's input is unchanged", async () => {
    await launchOrchestratorTurn({ ...args, wakeId: "job-row-7" });
    expect(mockAppendRows).toHaveBeenCalledWith(expect.anything(), [
      { id: "orchestrator-launch-row-1", content: "", source: { kind: "orchestrator_launch", runId: "row-1", wakeId: "job-row-7" } },
    ]);
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(Object.keys(body.input).sort()).toEqual(["context", "prompt", "session"]);
  });

  it("a turn asked from a canvas card tells strut the card as text and keeps the focus on the row only", async () => {
    const focus = {
      workspaceSlug: "acme",
      initiativeRefId: "init-1",
      initiativeName: "Self-serve onboarding",
      refId: "feat-1",
      refType: "InitiativeFeature",
      refLabel: "Repo picker",
    };
    await launchOrchestratorTurn({ ...args, focus });
    const line =
      'Mon 19 Oct, 14:02, Europe/London. On the canvas: initiative "Self-serve onboarding" (`init-1`), feature "Repo picker" (`feat-1`) in workspace `acme`. ';
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.input).toEqual({ prompt: "@acme-default\nAdd a Concept for billing retries", session: "conv-1", context: { line } });
    expect(mockStrutRun.create.mock.calls[0][0].data.input).toEqual({ ...body.input, focus });
  });

  it("a turn asked on a voice call ends the context line with the call line; the input is otherwise the same", async () => {
    await launchOrchestratorTurn({ ...args, message: "Alice: what are we working on?", call: true });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.input).toEqual({
      prompt: "@acme-default\nAlice: what are we working on?",
      session: "conv-1",
      context: {
        line:
          "Mon 19 Oct, 14:02, Europe/London. On a voice call. Your reply goes to the call's chat and may be read aloud: " +
          "say it the way you would out loud, short, with what matters first; links and detail belong in artifacts. " +
          "Names before a message are what the call shows, not verified. ",
      },
    });
  });

  it("a turn asked in a Sphinx tribe ends the context line with the tribe line — a text message, read on a phone; a wake on the tribe's conversation names no asker", async () => {
    await launchOrchestratorTurn({ ...args, message: "Alice: what are we working on?", tribe: { name: "Builders", alias: "Alice" } });
    let body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.input).toEqual({
      prompt: "@acme-default\nAlice: what are we working on?",
      session: "conv-1",
      context: { line: "Mon 19 Oct, 14:02, Europe/London. " + orchestratorTribeLine({ name: "Builders", alias: "Alice" }) },
    });
    expect(body.input.context.line).toMatch(
      /^Mon 19 Oct, 14:02, Europe\/London\. Asked in the Sphinx tribe #Builders by Alice\. Your reply is posted there, where not everyone is in this org, and read on a phone: say it the way you would in a text message, short/,
    );

    await launchOrchestratorTurn({ ...args, wakeId: "job-row-7", tribe: { name: "Builders" } });
    body = JSON.parse((mockFetch.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(body.input.context.line).toMatch(/^Mon 19 Oct, 14:02, Europe\/London\. In the Sphinx tribe #Builders\. Your reply is posted there/);
    expect(body.input.context.line).not.toContain("Names before a message");
  });

  it("a turn of the conversation still PENDING is busy — nothing is launched", async () => {
    mockStrutRun.findFirst.mockResolvedValue({ id: "row-0" });
    const out = await launchOrchestratorTurn(args);
    expect(out).toEqual({ status: "busy", note: expect.stringContaining("Still working on your last message") });
    expect(mockStrutRun.findFirst).toHaveBeenCalledWith({
      where: { conversationId: "conv-1", kind: "orchestrator_turn", status: "PENDING" },
      select: { id: true },
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockStrutRun.create).not.toHaveBeenCalled();
  });

  it("strut refusing the launch with session_busy (or a 409) is busy, not an error; no marker row", async () => {
    mockFetch.mockResolvedValue(
      json(409, { error: 'session_busy: session "conv-1" is in use by run 1 (orchestrator/turn)' }),
    );
    expect(await launchOrchestratorTurn(args)).toEqual({
      status: "busy",
      note: expect.stringContaining("Still working"),
    });
    expect(mockAppendRows).not.toHaveBeenCalled();
    expect(mockSetActiveRun).not.toHaveBeenCalled();
    // The row strut refused is retired as an error (dispatchStrutRun's bookkeeping).
    expect(mockStrutRun.updateMany).toHaveBeenCalled();
  });

  it("a swarm without the orchestrator workflow, or no target, is an error the person can act on", async () => {
    mockFetch.mockResolvedValue(json(404, { error: "no such workflow" }));
    expect(await launchOrchestratorTurn(args)).toEqual({
      status: "error",
      error: expect.stringContaining("no `orchestrator` workflow"),
    });

    mockResolveStrutTarget.mockResolvedValue({ ok: false, error: { type: "NO_ORG_SWARM" } });
    expect(await launchOrchestratorTurn(args)).toEqual({ status: "error", error: "target: NO_ORG_SWARM" });
    expect(mockStrutRun.create).toHaveBeenCalledTimes(1);
  });

  it("the message's files are read as this user and sent as `attachments` beside the input, never on the row", async () => {
    mockFetch.mockResolvedValue(json(202, { runId: "1790000000001", callback: true, attachments: true }));
    const shot = { path: "uploads/org/acme-gh/shot.png", filename: "shot.png", mimeType: "image/png", size: 5 };
    const notes = { path: "uploads/org/acme-gh/notes.md", filename: "notes.md", mimeType: "text/markdown", size: 7 };
    mockGetObject.mockImplementation(async (key: string) => Buffer.from(key === shot.path ? "PNG!!" : "# notes"));

    const out = await launchOrchestratorTurn({ ...args, attachments: [shot, notes] });
    expect(out.status).toBe("started");
    expect(mockCanReadKey).toHaveBeenCalledWith(shot.path, "user-1");
    expect(mockCanReadKey).toHaveBeenCalledWith(notes.path, "user-1");

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(Object.keys(body).sort()).toEqual(["attachments", "callback", "input", "jobCallback"]);
    expect(body.attachments).toEqual([
      { name: "shot.png", mediaType: "image/png", data: Buffer.from("PNG!!").toString("base64") },
      { name: "notes.md", mediaType: "text/markdown", data: Buffer.from("# notes").toString("base64") },
    ]);
    expect(body.input.prompt).toBe("@acme-default\nAdd a Concept for billing retries");
    expect(JSON.stringify(mockStrutRun.create.mock.calls)).not.toContain(Buffer.from("PNG!!").toString("base64"));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("a file strut cannot take is named after the message, and the rest still go", async () => {
    const readable = { path: "uploads/org/acme-gh/a.txt", filename: "a.txt", mimeType: "text/plain", size: 1 };
    const secret = { path: "uploads/org/other/b.txt", filename: "b.txt", mimeType: "text/plain", size: 1 };
    const huge = { path: "uploads/org/acme-gh/big.png", filename: "big.png", mimeType: "image/png", size: 6 * 1024 * 1024 };
    mockCanReadKey.mockImplementation(async (key: string) => key !== secret.path);
    mockGetObject.mockImplementation(async (key: string) => (key === huge.path ? Buffer.alloc(6 * 1024 * 1024) : Buffer.from("a")));

    await launchOrchestratorTurn({ ...args, message: "what's in these?", attachments: [readable, secret, huge] });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.attachments.map((a: { name: string }) => a.name)).toEqual(["a.txt"]);
    expect(body.input.prompt).toBe(
      "@acme-default\nwhat's in these?\n\n(Attached but not sent to you: b.txt — it could not be read; big.png — 6.0 MB, over the 5.0 MB limit for one image.)",
    );
    expect(mockGetObject).not.toHaveBeenCalledWith(secret.path);
  });

  it("a strut that ignores attachments (no `attachments: true` on the 202) still starts the turn, with a warning", async () => {
    const file = { path: "uploads/org/acme-gh/a.txt", filename: "a.txt", mimeType: "text/plain", size: 1 };
    mockGetObject.mockResolvedValue(Buffer.from("a"));
    expect((await launchOrchestratorTurn({ ...args, attachments: [file] })).status).toBe("started");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("predates run attachments"),
      expect.anything(),
      expect.objectContaining({ files: 1 }),
    );
  });
});

async function readStream(res: Response): Promise<string> {
  return new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));
}

describe("runOrchestratorTurn — the route's answer", () => {
  it("a launch answers an empty UI-message stream with the conversation id on the header", async () => {
    const res = await runOrchestratorTurn(args);
    expect(res.headers.get("X-Conversation-Id")).toBe("conv-1");
    expect(res.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    const text = await readStream(res);
    expect(text).toContain('data: {"type":"start"}');
    expect(text).toContain('data: {"type":"finish"}');
    expect(text).toContain("data: [DONE]");
    expect(text).not.toContain("text-delta");
  });

  it("busy and refused launches stream the notice as text", async () => {
    mockStrutRun.findFirst.mockResolvedValue({ id: "row-0" });
    const text = await readStream(await runOrchestratorTurn(args));
    expect(text).toContain('"type":"text-delta"');
    expect(text).toContain("Still working on your last message");
  });
});

describe("awaitOrchestratorReply", () => {
  const reply = { id: "orchestrator-row-1", role: "assistant", content: "Done.", source: { kind: "orchestrator" } };
  const proposal = { id: "orchestrator-row-1-proposal-p1", role: "assistant", content: "", source: { kind: "proposal" } };
  const marker = { id: "orchestrator-launch-row-1", role: "assistant", content: "", source: { kind: "orchestrator_launch" } };
  const other = { id: "orchestrator-row-10", role: "assistant", content: "another turn" };
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  };

  it("waits while the run is PENDING, then returns the reply and its proposals — never the marker or another turn's row", async () => {
    mockStrutRun.findUnique
      .mockResolvedValueOnce({ status: "PENDING" })
      .mockResolvedValueOnce({ status: "PENDING" })
      .mockResolvedValue({ status: "SUCCESS" });
    mockConversationFindUnique.mockResolvedValue({ messages: [{ id: "u", role: "user", content: "hi" }, marker, reply, proposal, other] });
    const rows = await awaitOrchestratorReply({ conversationId: "conv-1", runId: "row-1" }, clock());
    expect(rows).toEqual([reply, proposal]);
    expect(mockStrutRun.findUnique).toHaveBeenCalledTimes(3);
    expect(mockConversationFindUnique).toHaveBeenCalledTimes(1);
  });

  it("a settled run whose rows have not landed yet is read again", async () => {
    mockStrutRun.findUnique.mockResolvedValue({ status: "SUCCESS" });
    mockConversationFindUnique.mockResolvedValueOnce({ messages: [marker] }).mockResolvedValue({ messages: [marker, reply] });
    expect(await awaitOrchestratorReply({ conversationId: "conv-1", runId: "row-1" }, clock())).toEqual([reply]);
  });

  it("null past the deadline, or for a run that is gone", async () => {
    mockStrutRun.findUnique.mockResolvedValue({ status: "PENDING" });
    expect(await awaitOrchestratorReply({ conversationId: "conv-1", runId: "row-1", timeoutMs: 10_000 }, clock())).toBeNull();
    expect(mockConversationFindUnique).not.toHaveBeenCalled();

    mockStrutRun.findUnique.mockResolvedValue(null);
    expect(await awaitOrchestratorReply({ conversationId: "conv-1", runId: "row-1" }, clock())).toBeNull();
  });
});
