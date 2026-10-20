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
 *     { url } }` — no job, no title, no params; the jobCallback is the
 *     row's job-events URL, which the jobs the turn starts inherit (strut
 *     CALLBACKS.md §5), and an older strut's 400 to it relaunches without;
 *   - the row is the kind's, on the conversation; the run is registered for
 *     Stop; the launch-marker row is written AFTER strut accepted;
 *   - busy: a PENDING turn of the conversation refuses before any launch;
 *     strut's `session_busy:` / 409 reads as busy, not an error;
 *   - refusals: no `orchestrator` workflow on the swarm, no target;
 *   - the route's answer: a UI-message stream with no text for a launch,
 *     the notice as text for busy / refused, the conversation id on the
 *     header.
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
}));

vi.mock("@/lib/db", () => ({
  db: { strutRun: mockStrutRun, sourceControlOrg: { findUnique: mockOrgFindUnique }, swarm: { findUnique: vi.fn() } },
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

import { launchOrchestratorTurn, runOrchestratorTurn } from "@/services/strut-orchestrator";

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
