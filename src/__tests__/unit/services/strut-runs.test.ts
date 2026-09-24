/**
 * Unit tests for `services/strut-runs.ts` — dispatch, completion,
 * reconcile, cancel.
 *
 * Coverage:
 *   - dispatch: the target comes from the resolver (purpose threaded); a
 *     PENDING row with the target's swarmId and the launched input; the
 *     delegation and the actor secrets are pushed to THAT target before the
 *     launch; the launch carries `x-api-token` + `x-strut-actor` and a
 *     callback URL whose token's SHA-256 is what the row stores; the run id
 *     is stored and the run URL built on the lab base.
 *   - dispatch refusals: no target → throws, no row; unreachable / non-2xx
 *     / 404 (workflow not seeded) / 202 without `callback: true` (run
 *     cancelled best-effort) / no run id → row ERROR + throw.
 *   - completion: token-gated claim PENDING → terminal writes status /
 *     output / error / durationMs; the kind handler runs on the SETTLED row;
 *     a lost claim re-runs the handler (replayed); a handler throw → retry.
 *   - reconcile: 404 → LOST (+ handler); terminal summary → completion;
 *     running → left alone; `stale` → re-probed after a wait, LOST only if
 *     still stale (a run strut is about to auto-resume is not declared
 *     dead); no run id past the threshold → LOST.
 *   - cancel: POST …/cancel on the ROW's swarm, never the policy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { Prisma } from "@prisma/client";

const {
  mockStrutRun,
  mockSwarmFindUnique,
  mockResolveStrutTarget,
  mockEnsureStrutDelegation,
  mockEnsureStrutActorSecrets,
  mockHandler,
  mockLandHandler,
  mockDecrypt,
} = vi.hoisted(() => ({
  mockStrutRun: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  mockSwarmFindUnique: vi.fn(),
  mockResolveStrutTarget: vi.fn(),
  mockEnsureStrutDelegation: vi.fn(),
  mockEnsureStrutActorSecrets: vi.fn(),
  mockHandler: vi.fn(),
  mockLandHandler: vi.fn(),
  mockDecrypt: vi.fn((_f: string, v: string) => `dec(${v})`),
}));

vi.mock("@/lib/db", () => ({ db: { strutRun: mockStrutRun, swarm: { findUnique: mockSwarmFindUnique } } }));
vi.mock("@/services/strut-target", () => ({
  resolveStrutTarget: mockResolveStrutTarget,
  describeStrutTargetError: (e: { type: string }) => `err:${e.type}`,
}));
vi.mock("@/services/bifrost/strut-delegation", () => ({
  STRUT_ACTOR_HEADER: "x-strut-actor",
  ensureStrutDelegation: mockEnsureStrutDelegation,
  strutLabBaseUrl: (u: string) => `${u.replace("/api", ":3355")}/lab`,
}));
vi.mock("@/services/strut-actor-secret", () => ({ ensureStrutActorSecrets: mockEnsureStrutActorSecrets }));
vi.mock("@/services/strut-runs/code-change-propose", () => ({ handleCodeChangeProposeSettled: mockHandler }));
vi.mock("@/services/strut-runs/code-change-land", () => ({ handleCodeChangeLandSettled: mockLandHandler }));
vi.mock("@/lib/encryption", () => ({ EncryptionService: { getInstance: () => ({ decryptField: mockDecrypt }) } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  cancelPendingStrutRunsForConversation,
  cancelStrutRun,
  completeStrutRun,
  dispatchStrutRun,
  probeStrutRun,
  reconcileStrutRuns,
  StrutDispatchError,
  strutRunUrl,
  type StrutRunRow,
} from "@/services/strut-runs";

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

const TOKEN = "raw-token";
const HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");

function row(over: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    tokenHash: HASH,
    workspaceId: "ws-1",
    swarmId: "swarm-1",
    userId: "user-1",
    kind: "code_change_propose",
    workflow: "code-change-propose",
    strutRunId: "1790000000000",
    status: "PENDING",
    input: { repo: "https://github.com/acme/widgets", prompt: "p" },
    output: null,
    error: null,
    durationMs: null,
    conversationId: "conv-1",
    proposalId: "prop-1",
    createdAt: new Date("2026-09-23T10:00:00Z"),
    settledAt: null,
    ...over,
  } as unknown as StrutRunRow & { tokenHash: string };
}

const dispatchArgs = {
  workspaceId: "ws-1",
  userId: "user-1",
  kind: "code_change_propose",
  workflow: "code-change-propose",
  input: { repo: "https://github.com/acme/widgets", prompt: "fix it" },
  purpose: "code_change" as const,
  publicBaseUrl: "https://hive.example.com",
  conversationId: "conv-1",
  proposalId: "prop-1",
  actorSecrets: { GITHUB_TOKEN: "ghp_secret" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockResolveStrutTarget.mockResolvedValue({ ok: true, target: TARGET });
  mockEnsureStrutDelegation.mockResolvedValue({ status: "skipped-gate" });
  mockEnsureStrutActorSecrets.mockResolvedValue({ GITHUB_TOKEN: "pushed" });
  mockStrutRun.create.mockResolvedValue({ id: "row-1" });
  mockStrutRun.update.mockResolvedValue({});
  mockStrutRun.updateMany.mockResolvedValue({ count: 1 });
  mockHandler.mockResolvedValue(undefined);
  mockSwarmFindUnique.mockResolvedValue({ swarmUrl: "https://acme.sphinx.chat/api", swarmApiKey: "enc" });
});
afterEach(() => vi.unstubAllGlobals());

describe("dispatchStrutRun", () => {
  it("resolves the target once, creates the row, pushes, launches with a callback, stores the run id", async () => {
    mockFetch.mockResolvedValue(json(202, { runId: "1790000000000", callback: true }));

    const out = await dispatchStrutRun(dispatchArgs);

    expect(mockResolveStrutTarget).toHaveBeenCalledWith({ purpose: "code_change", userId: "user-1", workspaceId: "ws-1" });

    const created = mockStrutRun.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      workspaceId: "ws-1",
      swarmId: "swarm-1",
      userId: "user-1",
      kind: "code_change_propose",
      workflow: "code-change-propose",
      input: dispatchArgs.input,
      conversationId: "conv-1",
      proposalId: "prop-1",
    });
    expect(JSON.stringify(created)).not.toContain("ghp_secret");

    // Pushes go to the TARGET, before the launch.
    expect(mockEnsureStrutDelegation).toHaveBeenCalledWith(
      { workspaceId: "ws-default", workspaceSlug: "acme-default", userId: "user-1" },
      { swarmUrl: TARGET.swarmUrl, swarmApiKey: "swarm-key" },
      { actor: "alice-user-1" },
    );
    expect(mockEnsureStrutActorSecrets).toHaveBeenCalledWith(
      { labBase: TARGET.labBase, swarmApiKey: "swarm-key" },
      "alice-user-1",
      { GITHUB_TOKEN: "ghp_secret" },
    );
    expect(mockEnsureStrutDelegation.mock.invocationCallOrder[0]).toBeLessThan(mockFetch.mock.invocationCallOrder[0]);
    expect(mockEnsureStrutActorSecrets.mock.invocationCallOrder[0]).toBeLessThan(mockFetch.mock.invocationCallOrder[0]);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://acme.sphinx.chat:3355/lab/workflows/code-change-propose/run");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-token"]).toBe("swarm-key");
    expect(headers["x-strut-actor"]).toBe("alice-user-1");
    const body = JSON.parse(init.body as string);
    expect(body.input).toEqual(dispatchArgs.input);
    expect(JSON.stringify(body)).not.toContain("ghp_secret");
    const cb = new URL(body.callback.url);
    expect(cb.origin + cb.pathname).toBe("https://hive.example.com/api/strut-runs/webhook");
    expect(cb.searchParams.get("id")).toBe("row-1");
    const token = cb.searchParams.get("token")!;
    expect(crypto.createHash("sha256").update(token).digest("hex")).toBe(created.tokenHash);

    expect(mockStrutRun.update).toHaveBeenCalledWith({ where: { id: "row-1" }, data: { strutRunId: "1790000000000" } });
    expect(out).toEqual({
      runId: "row-1",
      strutRunId: "1790000000000",
      swarmId: "swarm-1",
      runUrl: "https://acme.sphinx.chat:3355/lab/?wf=code-change-propose&run=1790000000000",
    });
  });

  it("throws without creating a row when the resolver has no target", async () => {
    mockResolveStrutTarget.mockResolvedValue({ ok: false, error: { type: "NO_ORG_SWARM" } });
    await expect(dispatchStrutRun(dispatchArgs)).rejects.toMatchObject({ code: "no_target", message: "err:NO_ORG_SWARM" });
    expect(mockStrutRun.create).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("marks the row ERROR and throws when strut is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(dispatchStrutRun(dispatchArgs)).rejects.toBeInstanceOf(StrutDispatchError);
    expect(mockStrutRun.updateMany).toHaveBeenCalledWith({
      where: { id: "row-1", status: "PENDING" },
      data: expect.objectContaining({ status: "ERROR", error: "initiation_failed: ECONNREFUSED" }),
    });
  });

  it("404 = the workflow is not seeded on that strut", async () => {
    mockFetch.mockResolvedValue(json(404, { error: "no such workflow" }));
    await expect(dispatchStrutRun(dispatchArgs)).rejects.toMatchObject({ code: "workflow_missing" });
    expect(mockStrutRun.updateMany.mock.calls[0][0].data).toMatchObject({ status: "ERROR", error: "strut_http_404: no such workflow" });
  });

  it("400 = strut refused the callback URL", async () => {
    mockFetch.mockResolvedValue(json(400, { error: "callback.url must be http(s)" }));
    await expect(dispatchStrutRun(dispatchArgs)).rejects.toMatchObject({ code: "bad_callback_url" });
  });

  it("a 202 without `callback: true` is refused: the row fails and the run is cancelled best-effort", async () => {
    mockFetch
      .mockResolvedValueOnce(json(202, { runId: "1790000000000" }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    await expect(dispatchStrutRun(dispatchArgs)).rejects.toMatchObject({ code: "callbacks_unsupported" });
    expect(mockStrutRun.updateMany.mock.calls[0][0].data).toMatchObject({ status: "ERROR", error: "strut_callbacks_unsupported" });
    // Let the fire-and-forget cancel land.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch.mock.calls[1][0]).toBe(
      "https://acme.sphinx.chat:3355/lab/workflows/code-change-propose/runs/1790000000000/cancel",
    );
    expect(mockStrutRun.update).not.toHaveBeenCalled();
  });

  it("a 202 without a run id is refused", async () => {
    mockFetch.mockResolvedValue(json(202, { callback: true }));
    await expect(dispatchStrutRun(dispatchArgs)).rejects.toMatchObject({ code: "no_run_id" });
    expect(mockStrutRun.updateMany.mock.calls[0][0].data).toMatchObject({ status: "ERROR", error: "no_run_id" });
  });

  it("refuses an unknown kind before touching anything", async () => {
    await expect(dispatchStrutRun({ ...dispatchArgs, kind: "nope" })).rejects.toThrow(/No strut-run handler/);
    expect(mockResolveStrutTarget).not.toHaveBeenCalled();
  });

  it("an input function receives the row's id; its result is stored on the row before the launch and is what strut gets", async () => {
    mockFetch.mockResolvedValue(json(202, { runId: "1790000000000", callback: true }));
    const input = vi.fn((runId: string) => ({ repo: "https://github.com/acme/widgets", branch: `jamie/abc-${runId.slice(-6)}` }));

    await dispatchStrutRun({ ...dispatchArgs, kind: "code_change_land", workflow: "code-change-land", input });

    expect(input).toHaveBeenCalledWith("row-1");
    expect(mockStrutRun.create.mock.calls[0][0].data.input).toBe(Prisma.DbNull);
    expect(mockStrutRun.update.mock.calls[0][0]).toEqual({
      where: { id: "row-1" },
      data: { input: { repo: "https://github.com/acme/widgets", branch: "jamie/abc-row-1" } },
    });
    expect(mockStrutRun.update.mock.invocationCallOrder[0]).toBeLessThan(mockFetch.mock.invocationCallOrder[0]);
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.input).toEqual({ repo: "https://github.com/acme/widgets", branch: "jamie/abc-row-1" });
  });
});

describe("completeStrutRun", () => {
  it("claims PENDING → SUCCESS with the output, then runs the kind's handler on the settled row", async () => {
    const settled = row({ status: "SUCCESS", output: { diff: "d", filesChanged: 1 }, durationMs: 4200 });
    mockStrutRun.findUnique.mockResolvedValue(settled);

    const out = await completeStrutRun(
      { id: "row-1", tokenHash: HASH },
      { status: "success", output: { diff: "d", filesChanged: 1 }, durationMs: 4200.4 },
    );

    expect(out).toBe("claimed");
    expect(mockStrutRun.updateMany).toHaveBeenCalledWith({
      where: { id: "row-1", tokenHash: HASH, status: "PENDING" },
      data: expect.objectContaining({
        status: "SUCCESS",
        output: { diff: "d", filesChanged: 1 },
        error: null,
        durationMs: 4200,
        settledAt: expect.any(Date),
      }),
    });
    expect(mockHandler).toHaveBeenCalledWith(settled);
  });

  it("an error completion stores the message; a cancelled one no error and no output", async () => {
    mockStrutRun.findUnique.mockResolvedValue(row({ status: "ERROR", error: "checkout failed" }));
    await completeStrutRun({ id: "row-1", tokenHash: HASH }, { status: "error", error: "checkout failed", output: { x: 1 } });
    expect(mockStrutRun.updateMany.mock.calls[0][0].data).toMatchObject({ status: "ERROR", error: "checkout failed" });
    expect(mockStrutRun.updateMany.mock.calls[0][0].data.output).not.toEqual({ x: 1 });

    mockStrutRun.findUnique.mockResolvedValue(row({ status: "CANCELLED" }));
    await completeStrutRun({ id: "row-1", tokenHash: HASH }, { status: "cancelled" });
    expect(mockStrutRun.updateMany.mock.calls[1][0].data).toMatchObject({ status: "CANCELLED", error: null });
  });

  it("a lost claim still runs the handler against the settled row (replayed)", async () => {
    mockStrutRun.updateMany.mockResolvedValue({ count: 0 });
    mockStrutRun.findUnique.mockResolvedValue(row({ status: "SUCCESS", output: { diff: "d", filesChanged: 1 } }));
    const out = await completeStrutRun({ id: "row-1", tokenHash: HASH }, { status: "success", output: {} });
    expect(out).toBe("replayed");
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });

  it("a handler throw asks for a retry", async () => {
    mockStrutRun.findUnique.mockResolvedValue(row({ status: "SUCCESS" }));
    mockHandler.mockRejectedValue(new Error("db down"));
    expect(await completeStrutRun({ id: "row-1", tokenHash: HASH }, { status: "success" })).toBe("retry");
  });

  it("code_change_land is a registered kind: its own handler runs on the settled row", async () => {
    const settled = row({ kind: "code_change_land", workflow: "code-change-land", status: "SUCCESS", output: { url: "u" } });
    mockStrutRun.findUnique.mockResolvedValue(settled);
    expect(await completeStrutRun({ id: "row-1", tokenHash: HASH }, { status: "success", output: { url: "u" } })).toBe("claimed");
    expect(mockLandHandler).toHaveBeenCalledWith(settled);
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it("unclaimed when the row is still PENDING afterwards (token mismatch)", async () => {
    mockStrutRun.updateMany.mockResolvedValue({ count: 0 });
    mockStrutRun.findUnique.mockResolvedValue(row());
    expect(await completeStrutRun({ id: "row-1", tokenHash: "other" }, { status: "success" })).toBe("unclaimed");
    expect(mockHandler).not.toHaveBeenCalled();
  });
});

describe("cancelStrutRun / cancelPendingStrutRunsForConversation", () => {
  it("POSTs cancel on the ROW's swarm (decrypted key), never re-resolving the policy", async () => {
    mockFetch.mockResolvedValue(json(200, { ok: true }));
    expect(await cancelStrutRun(row())).toBe(true);
    expect(mockSwarmFindUnique).toHaveBeenCalledWith({ where: { id: "swarm-1" }, select: { swarmUrl: true, swarmApiKey: true } });
    expect(mockResolveStrutTarget).not.toHaveBeenCalled();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://acme.sphinx.chat:3355/lab/workflows/code-change-propose/runs/1790000000000/cancel");
    expect((init.headers as Record<string, string>)["x-api-token"]).toBe("dec(enc)");
  });

  it("no run id / no swarm / a throw → false, never throws", async () => {
    expect(await cancelStrutRun(row({ strutRunId: null }))).toBe(false);
    mockSwarmFindUnique.mockResolvedValueOnce(null);
    expect(await cancelStrutRun(row())).toBe(false);
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await cancelStrutRun(row())).toBe(false);
  });

  it("cancels every PENDING run of a conversation and reports the rows", async () => {
    mockStrutRun.findMany.mockResolvedValue([
      { id: "row-1", kind: "code_change_propose", swarmId: "swarm-1", workflow: "code-change-propose", strutRunId: "1" },
      { id: "row-2", kind: "code_change_propose", swarmId: "swarm-1", workflow: "code-change-propose", strutRunId: null },
    ]);
    mockFetch.mockResolvedValue(json(200, { ok: true }));
    const out = await cancelPendingStrutRunsForConversation("conv-1");
    expect(mockStrutRun.findMany.mock.calls[0][0].where).toEqual({ conversationId: "conv-1", status: "PENDING" });
    expect(out).toEqual({ rows: [{ id: "row-1", kind: "code_change_propose" }, { id: "row-2", kind: "code_change_propose" }], cancelled: 1 });
  });
});

describe("probeStrutRun / reconcileStrutRuns", () => {
  it("probes the ROW's swarm: 404 → missing, partial → running, terminal → settled", async () => {
    mockFetch.mockResolvedValueOnce(json(404, { error: "nope" }));
    expect(await probeStrutRun(row())).toEqual({ kind: "missing" });

    mockFetch.mockResolvedValueOnce(json(200, { partial: true, status: "running" }));
    expect(await probeStrutRun(row())).toEqual({ kind: "running", status: "running" });

    mockFetch.mockResolvedValueOnce(json(200, { partial: true, status: "stale" }));
    expect(await probeStrutRun(row())).toEqual({ kind: "running", status: "stale" });

    mockFetch.mockResolvedValueOnce(json(200, { status: "error", error: { message: "boom" }, durationMs: 12 }));
    expect(await probeStrutRun(row())).toEqual({
      kind: "settled",
      completion: { status: "error", output: undefined, error: "boom", durationMs: 12 },
    });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://acme.sphinx.chat:3355/lab/workflows/code-change-propose/runs/1790000000000",
    );
  });

  it("settles a row whose summary is terminal through the same completion", async () => {
    mockStrutRun.findMany.mockResolvedValue([row()]);
    mockFetch.mockResolvedValue(json(200, { status: "success", output: { diff: "d", filesChanged: 1 }, durationMs: 5 }));
    mockStrutRun.findUnique
      .mockResolvedValueOnce({ id: "row-1", tokenHash: HASH })
      .mockResolvedValueOnce(row({ status: "SUCCESS", output: { diff: "d", filesChanged: 1 } }));

    const stats = await reconcileStrutRuns({ now: new Date("2026-09-23T11:00:00Z") });

    expect(stats).toMatchObject({ swept: 1, settled: 1, lost: 0, running: 0 });
    expect(mockStrutRun.findMany.mock.calls[0][0].where).toEqual({
      status: "PENDING",
      createdAt: { lt: new Date("2026-09-23T10:50:00Z") },
    });
    expect(mockStrutRun.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "row-1", tokenHash: HASH, status: "PENDING" },
      data: expect.objectContaining({ status: "SUCCESS" }),
    });
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });

  it("marks a run strut never saw LOST and delivers that; leaves a running one alone", async () => {
    mockStrutRun.findMany.mockResolvedValue([row({ id: "lost" }), row({ id: "live" })]);
    mockFetch.mockResolvedValueOnce(json(404, {})).mockResolvedValueOnce(json(200, { partial: true, status: "running" }));
    mockStrutRun.findUnique.mockResolvedValueOnce(row({ id: "lost", status: "LOST" }));

    const stats = await reconcileStrutRuns();

    expect(stats).toMatchObject({ swept: 2, lost: 1, running: 1, settled: 0 });
    expect(mockStrutRun.updateMany).toHaveBeenCalledWith({
      where: { id: "lost", status: "PENDING" },
      data: expect.objectContaining({ status: "LOST" }),
    });
    expect(mockHandler).toHaveBeenCalledWith(expect.objectContaining({ id: "lost", status: "LOST" }));
  });

  it("a stale run is re-probed after the wait and LOST only if still stale", async () => {
    const stale = () => json(200, { partial: true, status: "stale" });
    mockStrutRun.findMany.mockResolvedValue([row({ id: "dead" }), row({ id: "resuming" }), row({ id: "finished" })]);
    mockFetch
      // first pass: all three look stale
      .mockResolvedValueOnce(stale())
      .mockResolvedValueOnce(stale())
      .mockResolvedValueOnce(stale())
      // re-check: one still stale, one picked up by auto-resume, one already done
      .mockResolvedValueOnce(stale())
      .mockResolvedValueOnce(json(200, { partial: true, status: "running" }))
      .mockResolvedValueOnce(json(200, { status: "success", output: { diff: "d", filesChanged: 1 } }));
    mockStrutRun.findUnique
      .mockResolvedValueOnce(row({ id: "dead", status: "LOST" }))
      .mockResolvedValueOnce({ id: "finished", tokenHash: HASH })
      .mockResolvedValueOnce(row({ id: "finished", status: "SUCCESS", output: { diff: "d", filesChanged: 1 } }));

    const stats = await reconcileStrutRuns({ staleRecheckMs: 0 });

    expect(stats).toMatchObject({ swept: 3, lost: 1, running: 1, settled: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(6);
    expect(mockStrutRun.updateMany).toHaveBeenCalledWith({
      where: { id: "dead", status: "PENDING" },
      data: expect.objectContaining({ status: "LOST", error: expect.stringContaining("did not resume") }),
    });
    expect(mockStrutRun.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: "resuming", status: "PENDING" } }));
    expect(mockHandler).toHaveBeenCalledWith(expect.objectContaining({ id: "dead", status: "LOST" }));
    expect(mockHandler).toHaveBeenCalledWith(expect.objectContaining({ id: "finished", status: "SUCCESS" }));
  });

  it("a row with no run id past the threshold is LOST (the dispatch died)", async () => {
    mockStrutRun.findMany.mockResolvedValue([row({ strutRunId: null })]);
    mockStrutRun.findUnique.mockResolvedValueOnce(row({ strutRunId: null, status: "LOST" }));
    const stats = await reconcileStrutRuns();
    expect(stats).toMatchObject({ swept: 1, lost: 1 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("strutRunUrl escapes the run id", () => {
    expect(strutRunUrl("https://x:3355/lab", "wf", "a b")).toBe("https://x:3355/lab/?wf=wf&run=a%20b");
  });
});
