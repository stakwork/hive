// @vitest-environment node
/**
 * A strut job's claims on hive (`services/strut-jobs/claims.ts`, strut
 * plans/job-claims.md §7):
 *   - the ledger read off the job's swarm, enriched from the listing (the
 *     speaker, the open slots and their questions), and nothing when the
 *     swarm has no claims layer, the job is not there, or it did not answer;
 *   - the card: one id per job, the turn it is of, the turns numbered;
 *   - the actions, as the job's owner: Verify publishes the next version
 *     with the pass's outcomes, its line saying what changed against the
 *     card the conversation shows; a detached Verify is marked as the
 *     person's, and a pass's end publishes only for that mark — the job's
 *     agent verifying its own turn publishes nothing; Supports fills the slot and publishes; a
 *     refutation with a note fills the slot and becomes the job's next turn
 *     (`[claim-event] …`), publishing nothing itself; a new claim carries an
 *     external check.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, mockLab, mockActor, mockAppend, mockRedis } = vi.hoisted(() => ({
  mockDb: {
    strutRun: { findMany: vi.fn(), findFirst: vi.fn() },
    workspace: { findUnique: vi.fn() },
    sharedConversation: { findUnique: vi.fn() },
  },
  mockLab: vi.fn(),
  mockActor: vi.fn(),
  mockAppend: vi.fn(),
  mockRedis: { set: vi.fn(), del: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/redis", () => ({ redis: mockRedis }));
vi.mock("@/lib/ai/mcpTimeout", () => ({ withMcpTimeout: (fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/strut-runs", () => ({ labForRow: mockLab }));
vi.mock("@/services/bifrost/strut-delegation", () => ({ STRUT_ACTOR_HEADER: "x-strut-actor", resolveStrutActor: mockActor }));
vi.mock("@/services/strut-runs/job-turn", () => ({ appendJobClaimsRow: mockAppend }));

import {
  JobClaimsError,
  addJobClaim,
  answerJobClaim,
  claimsArtifact,
  claimsArtifactId,
  describeVerify,
  mergeClaims,
  publishVerifiedVersion,
  readJobClaims,
  readTurnClaimsCard,
  summarizeClaims,
  verifyJobClaims,
} from "@/services/strut-jobs/claims";
import type { StrutRunRow } from "@/services/strut-runs";

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const TURN_1 = "1792018000000";
const TURN_2 = "1792018615451";
const LAB = "https://swarm1.sphinx.chat:3355/lab";
const SHOT = `/jobs/${JOB}/files/shots/001.png`;

const mockFetch = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** strut's ledger (`GET /jobs/:id/claims`): no speaker, no slots — `planned` marks an open one. */
const LEDGER = [
  {
    id: "c-page",
    text: "The settings page renders",
    status: "supported",
    assertedOnly: false,
    unverified: 0,
    latest: { content: "/settings reached", observed_at: 1792018620, mode: "observed", check: "k-page", checkVersion: "browser/verify@v1", about: TURN_2, locator: { url: SHOT, file: "shots/001.png" } },
    checks: [{ id: "k-page", name: "browser/verify", lastVerify: { ran: true } }],
  },
  {
    id: "c-save",
    text: "A preference saved stays saved",
    status: "unknown",
    assertedOnly: false,
    unverified: 1,
    checks: [{ id: "k-save", name: "eyes", external: true, lastVerify: { planned: "ev-1" } }],
  },
];
/** The listing (`GET /claims?kind=job`): the speaker, the slots with their question and turn, a check's description. */
const LISTING = [
  { id: "c-page", speaker: "ai", slots: [], checks: [{ id: "k-page", name: "browser/verify", type: "browser/verify" }] },
  {
    id: "c-save",
    speaker: "person",
    slots: [{ evidence: "ev-1", check: "k-save", question: "Tick Email, save, reload.", run: { name: "job", runId: TURN_1 } }],
    checks: [{ id: "k-save", name: "eyes", external: true, description: "Tick Email, save, reload — still ticked?" }],
  },
];

/** Answers the lab by URL. */
function serve(routes: Record<string, () => Response>) {
  mockFetch.mockImplementation(async (url: string) => {
    const path = String(url).replace(LAB, "");
    for (const [prefix, answer] of Object.entries(routes)) if (path.startsWith(prefix)) return answer();
    return json(404, { error: "not found" });
  });
}

const FIRST = {
  id: "row-1",
  workspaceId: "ws-1",
  swarmId: "swarm-1",
  userId: "user-1",
  conversationId: "conv-1",
  input: { prompt: "Add a settings page", title: "Settings page" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockLab.mockResolvedValue({ labBase: LAB, swarmApiKey: "swarm-key", swarmName: "swarm1" });
  mockActor.mockResolvedValue("user-1-octo");
  mockDb.strutRun.findMany.mockResolvedValue([{ strutRunId: TURN_1 }, { strutRunId: TURN_2 }]);
  mockDb.strutRun.findFirst.mockResolvedValue({ strutRunId: TURN_2 });
  mockDb.workspace.findUnique.mockResolvedValue({ slug: "acme" });
  mockAppend.mockResolvedValue("appended");
  mockRedis.set.mockResolvedValue("OK");
  mockRedis.del.mockResolvedValue(1);
  mockDb.sharedConversation.findUnique.mockResolvedValue(null);
});

const MARK = `strut-job:person-verify:${JOB}`;

/** The job's conversation showing `claims` as its card's newest version, after an older one. */
const showing = (claims: unknown[]) => ({
  messages: [
    { id: "m-1", artifacts: [{ id: claimsArtifactId(JOB), kind: "claims", source: { type: "inline", content: { workspace: "acme", swarmId: "swarm-1", job: JOB, turn: TURN_1, claims: [] } } }] },
    { id: "m-2", content: "hello" },
    { id: "m-3", artifacts: [{ id: "shot", kind: "image" }, { id: claimsArtifactId(JOB), kind: "claims", source: { type: "inline", content: { workspace: "acme", swarmId: "swarm-1", job: JOB, turn: TURN_1, claims } } }] },
  ],
});

describe("mergeClaims", () => {
  it("the ledger's verdicts and outcomes, the listing's speaker, slots and descriptions", () => {
    const merged = mergeClaims(LEDGER, LISTING);
    expect(merged.map((c) => [c.id, c.status, c.speaker])).toEqual([
      ["c-page", "supported", "ai"],
      ["c-save", "unknown", "person"],
    ]);
    expect(merged[0].latest).toEqual({ content: "/settings reached", mode: "observed", observedAt: 1792018620, checkVersion: "browser/verify@v1", about: TURN_2, locator: { url: SHOT, file: "shots/001.png" } });
    expect(merged[1].slots).toEqual([{ evidence: "ev-1", check: "k-save", runId: TURN_1, question: "Tick Email, save, reload." }]);
    expect(merged[1].checks[0]).toEqual({ id: "k-save", name: "eyes", external: true, description: "Tick Email, save, reload — still ticked?", lastVerify: { planned: "ev-1" } });
  });

  it("without the listing, an open slot is still known from the ledger's `planned`", () => {
    expect(mergeClaims(LEDGER)[1].slots).toEqual([{ evidence: "ev-1", check: "k-save" }]);
    expect(mergeClaims(LEDGER)[0].speaker).toBeUndefined();
  });
});

describe("readJobClaims", () => {
  it("reads the ledger and the listing off the lab with the swarm key", async () => {
    serve({ [`/jobs/${JOB}/claims`]: () => json(200, { enabled: true, job: JOB, claims: LEDGER }), "/claims?": () => json(200, { enabled: true, claims: LISTING }) });
    const claims = await readJobClaims({ labBase: LAB, swarmApiKey: "swarm-key" }, JOB);
    expect(claims?.map((c) => c.speaker)).toEqual(["ai", "person"]);
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([`${LAB}/jobs/${JOB}/claims`, `${LAB}/claims?kind=job&name=${JOB}`]);
    expect(mockFetch.mock.calls[0][1].headers).toEqual({ "x-api-token": "swarm-key" });
  });

  it("nothing when the swarm has no claims layer, the job is not there, or it did not answer — the listing failing is not one of them", async () => {
    const lab = { labBase: LAB, swarmApiKey: "k" };
    serve({ [`/jobs/${JOB}/claims`]: () => json(200, { enabled: false, job: JOB, claims: [] }) });
    expect(await readJobClaims(lab, JOB)).toBeNull();
    serve({});
    expect(await readJobClaims(lab, JOB)).toBeNull();
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await readJobClaims(lab, JOB)).toBeNull();
    serve({ [`/jobs/${JOB}/claims`]: () => json(200, { enabled: true, claims: LEDGER }), "/claims?": () => json(500, {}) });
    expect((await readJobClaims(lab, JOB))?.length).toBe(2);
  });
});

describe("the card", () => {
  it("one id per job, the turn it is of, a sentence about where things stand", () => {
    const claims = mergeClaims(LEDGER, LISTING);
    expect(claimsArtifactId(JOB)).toBe(`claims-${JOB}`);
    // The claim waiting on a person counts once, as that — never also as unknown.
    expect(summarizeClaims(claims)).toBe("1 supported, 1 needs a look");
    const [page, save] = claims;
    expect(summarizeClaims([save, { ...save, id: "c-2" }])).toBe("2 need a look");
    // A refutation outranks the look; a claim with no slot and no verdict is unknown.
    expect(summarizeClaims([{ ...save, status: "refuted" }, { ...page, status: "unknown", slots: [] }])).toBe("1 refuted, 1 unknown");
    expect(claimsArtifact({ jobId: JOB, title: "Settings page", workspace: "acme", swarmId: "swarm-1", turn: TURN_2, turns: { [TURN_2]: 2 }, claims })).toEqual({
      id: `claims-${JOB}`,
      kind: "claims",
      title: "Settings page",
      summary: "1 supported, 1 needs a look",
      source: { type: "inline", content: { workspace: "acme", swarmId: "swarm-1", job: JOB, turn: TURN_2, turns: { [TURN_2]: 2 }, claims } },
    });
  });

  it("a turn's card is read off the ROW's swarm, the turns numbered; none without claims, and never a throw", async () => {
    const row = { ...FIRST, id: "row-2", strutRunId: TURN_2 } as unknown as StrutRunRow;
    serve({ [`/jobs/${JOB}/claims`]: () => json(200, { enabled: true, claims: LEDGER }), "/claims?": () => json(200, { claims: LISTING }) });
    const card = await readTurnClaimsCard(row, JOB, 8_000);
    expect(mockLab).toHaveBeenCalledWith(row);
    // Numbered: the card's turn and each verdict's — what the card names.
    expect(card?.source).toEqual({ type: "inline", content: expect.objectContaining({ workspace: "acme", swarmId: "swarm-1", job: JOB, turn: TURN_2, turns: { [TURN_2]: 2 } }) });

    serve({ [`/jobs/${JOB}/claims`]: () => json(200, { enabled: true, claims: [] }) });
    expect(await readTurnClaimsCard(row, JOB, 8_000)).toBeNull();
    mockDb.workspace.findUnique.mockRejectedValue(new Error("db down"));
    serve({ [`/jobs/${JOB}/claims`]: () => json(200, { enabled: true, claims: LEDGER }) });
    expect(await readTurnClaimsCard(row, JOB, 8_000)).toBeNull();
  });
});

describe("describeVerify", () => {
  const after = mergeClaims(LEDGER, LISTING);
  const was = (status: string) => mergeClaims(LEDGER.map((c) => (c.id === "c-page" ? { ...c, status } : c)), LISTING);

  it("each claim whose pill moved, from → to; a claim the card did not show is new", () => {
    expect(describeVerify("turn 2", was("unknown"), after)).toBe('Verified turn 2: "The settings page renders" unknown → supported.');
    expect(describeVerify("turn 2", [], after)).toBe('Verified turn 2: "The settings page renders" new → supported; "A preference saved stays saved" new → needs a look.');
  });

  it("no change says so, with where things stand; no card to compare with is the tally alone", () => {
    expect(describeVerify("turn 2", after, after)).toBe("Verified turn 2: no change (1 supported, 1 needs a look).");
    expect(describeVerify("the newest turn", null, after)).toBe("Verified the newest turn: 1 supported, 1 needs a look.");
    expect(describeVerify("turn 2", null, [])).toBe("Verified turn 2: no claims.");
  });

  it("a long claim is cut short; past three changes, the rest are counted", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...LEDGER[0], id: `c-${i}`, text: i === 0 ? "x".repeat(80) : `Claim ${i}` }));
    const line = describeVerify("turn 2", [], mergeClaims(many));
    expect(line).toContain(`"${"x".repeat(59)}…" new → supported`);
    expect(line).toMatch(/"Claim 2" new → supported; 2 more changed\.$/);
  });
});

describe("the card's actions", () => {
  it("Verify runs the pass as the job's owner and publishes the next version with its outcomes", async () => {
    const passed = LEDGER.map((c) => (c.id === "c-save" ? c : { ...c, checks: [{ id: "k-page", name: "browser/verify", lastVerify: { ran: true } }] }));
    serve({ [`/jobs/${JOB}/verify`]: () => json(200, { job: JOB, runId: TURN_2, checks: [], evidence: 1, slots: 1, costUsd: 0, claims: passed }), "/claims?": () => json(200, { claims: LISTING }) });
    const { card, summary } = await verifyJobClaims(FIRST, JOB);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${LAB}/jobs/${JOB}/verify`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "x-api-token": "swarm-key", "x-strut-actor": "user-1-octo" });
    expect(mockActor).toHaveBeenCalledWith("user-1");
    expect(summary).toBe("1 supported, 1 needs a look");
    expect(mockAppend).toHaveBeenCalledWith(FIRST, {
      content: "Verified turn 2: 1 supported, 1 needs a look.",
      source: { kind: "job_claims", jobId: JOB, title: "Settings page" },
      artifacts: [card],
    });
    expect(card?.source).toMatchObject({ content: { turn: TURN_2, swarmId: "swarm-1" } });
  });

  it("a job whose live updates reach hive verifies DETACHED: strut starts the pass and nothing is published until it ends", async () => {
    mockDb.strutRun.findFirst.mockResolvedValue({ strutRunId: TURN_2, liveUpdates: true });
    serve({ [`/jobs/${JOB}/verify`]: () => json(202, { job: JOB, started: true }) });
    expect(await verifyJobClaims(FIRST, JOB)).toEqual({ card: null, summary: "", started: true });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ detach: true });
    expect(mockRedis.set).toHaveBeenCalledWith(MARK, "1", "EX", 1800);
    expect(mockRedis.del).not.toHaveBeenCalled();
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("a mark Redis cannot take waits on the pass instead — the person still gets the line", async () => {
    mockDb.strutRun.findFirst.mockResolvedValue({ strutRunId: TURN_2, liveUpdates: true });
    mockRedis.set.mockRejectedValue(new Error("redis down"));
    serve({ [`/jobs/${JOB}/verify`]: () => json(200, { job: JOB, runId: TURN_2, checks: [], evidence: 1, slots: 1, costUsd: 0, claims: LEDGER }), "/claims?": () => json(200, { claims: LISTING }) });
    await verifyJobClaims(FIRST, JOB);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({});
    expect(mockAppend).toHaveBeenCalledTimes(1);
  });

  it("a refused detached Verify takes its mark back, so a later pass of the agent's does not publish", async () => {
    mockDb.strutRun.findFirst.mockResolvedValue({ strutRunId: TURN_2, liveUpdates: true });
    serve({ [`/jobs/${JOB}/verify`]: () => json(404, { error: `No job "${JOB}"` }) });
    await expect(verifyJobClaims(FIRST, JOB)).rejects.toMatchObject({ status: 404 });
    expect(mockRedis.del).toHaveBeenCalledWith(MARK);
  });

  it("an older strut ignores detach and answers with the pass: it is published as before", async () => {
    mockDb.strutRun.findFirst.mockResolvedValue({ strutRunId: TURN_2, liveUpdates: true });
    serve({ [`/jobs/${JOB}/verify`]: () => json(200, { job: JOB, runId: TURN_2, checks: [], evidence: 1, slots: 1, costUsd: 0, claims: LEDGER }), "/claims?": () => json(200, { claims: LISTING }) });
    const out = await verifyJobClaims(FIRST, JOB);
    expect(out.started).toBeUndefined();
    expect(out.card).not.toBeNull();
    expect(mockAppend).toHaveBeenCalledTimes(1);
    // Published here: the mark is taken back, so the pass's end does not publish it again.
    expect(mockRedis.del).toHaveBeenCalledWith(MARK);
  });

  it("a job without live updates waits on the pass, as before — no detach asked", async () => {
    serve({ [`/jobs/${JOB}/verify`]: () => json(200, { job: JOB, runId: TURN_2, checks: [], evidence: 1, slots: 1, costUsd: 0, claims: LEDGER }), "/claims?": () => json(200, { claims: LISTING }) });
    await verifyJobClaims(FIRST, JOB);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({});
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("when a detached Verify ends, the ledger as it is now is the card's next version", async () => {
    serve({ [`/jobs/${JOB}/claims`]: () => json(200, { enabled: true, claims: LEDGER }), "/claims?": () => json(200, { claims: LISTING }) });
    const card = await publishVerifiedVersion(FIRST, JOB, TURN_2);
    expect(mockRedis.del).toHaveBeenCalledWith(MARK);
    expect(card?.source).toMatchObject({ content: { turn: TURN_2, swarmId: "swarm-1" } });
    expect(mockAppend).toHaveBeenCalledWith(FIRST, {
      content: "Verified turn 2: 1 supported, 1 needs a look.",
      source: { kind: "job_claims", jobId: JOB, title: "Settings page" },
      artifacts: [card],
    });
    mockLab.mockResolvedValue(null);
    expect(await publishVerifiedVersion(FIRST, JOB, TURN_2)).toBeNull();
  });

  it("a pass's end with no person's Verify waiting — the job's agent verifying its own turn — publishes nothing", async () => {
    mockRedis.del.mockResolvedValue(0);
    expect(await publishVerifiedVersion(FIRST, JOB, TURN_2)).toBeNull();
    mockRedis.del.mockRejectedValue(new Error("redis down"));
    expect(await publishVerifiedVersion(FIRST, JOB, TURN_2)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("the line says what changed against the card the conversation shows", async () => {
    mockDb.sharedConversation.findUnique.mockResolvedValue(showing(mergeClaims(LEDGER.map((c) => (c.id === "c-page" ? { ...c, status: "unknown", latest: undefined } : c)), LISTING)));
    serve({ [`/jobs/${JOB}/claims`]: () => json(200, { enabled: true, claims: LEDGER }), "/claims?": () => json(200, { claims: LISTING }) });
    await publishVerifiedVersion(FIRST, JOB, TURN_2);
    expect(mockDb.sharedConversation.findUnique).toHaveBeenCalledWith({ where: { id: "conv-1" }, select: { messages: true } });
    expect(mockAppend.mock.calls[0][1].content).toBe('Verified turn 2: "The settings page renders" unknown → supported.');
  });

  it("strut's refusals come back as the route answers them", async () => {
    serve({ [`/jobs/${JOB}/verify`]: () => json(409, { error: "claims are off on this workspace" }) });
    await expect(verifyJobClaims(FIRST, JOB)).rejects.toMatchObject({ status: 409 });
    serve({ [`/jobs/${JOB}/verify`]: () => json(404, { error: `No job "${JOB}"` }) });
    await expect(verifyJobClaims(FIRST, JOB)).rejects.toBeInstanceOf(JobClaimsError);
    mockLab.mockResolvedValue(null);
    await expect(verifyJobClaims(FIRST, JOB)).rejects.toMatchObject({ status: 502 });
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("Supports fills the slot on its turn and publishes; no turn", async () => {
    serve({ "/claims/c-save/evidence": () => json(200, { ok: true, evidence: "ev-1", filled: true }), [`/jobs/${JOB}/claims`]: () => json(200, { enabled: true, claims: LEDGER }), "/claims?": () => json(200, { claims: LISTING }) });
    const launch = vi.fn();
    const out = await answerJobClaim(FIRST, JOB, { claimId: "c-save", slot: "ev-1", runId: TURN_1, supports: true }, launch);

    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ job: JOB, runId: TURN_1, supports: true, content: "Looked: it holds.", slot: "ev-1" });
    expect(launch).not.toHaveBeenCalled();
    expect(out.card?.kind).toBe("claims");
    expect(mockAppend.mock.calls[0][1].content).toBe('Answered "A preference saved stays saved": supports.');
  });

  it("a refutation with a note fills the slot first, then becomes the job's next turn, and publishes nothing itself", async () => {
    serve({ "/claims/c-save/evidence": () => json(200, { ok: true, evidence: "ev-1", filled: true }), [`/jobs/${JOB}/claims`]: () => json(200, { enabled: true, claims: LEDGER }) });
    const launch = vi.fn().mockResolvedValue({ runId: "row-9" });
    const out = await answerJobClaim(FIRST, JOB, { claimId: "c-save", slot: "ev-1", runId: TURN_1, supports: false, note: "It unticks\nafter the reload." }, launch);

    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ job: JOB, runId: TURN_1, supports: false, content: "It unticks\nafter the reload.", slot: "ev-1" });
    expect(launch).toHaveBeenCalledWith('[claim-event] refuted "A preference saved stays saved": It unticks after the reload.');
    expect(out).toEqual({ card: null, turn: { runId: "row-9" } });
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("a new claim is the person's, with an external check", async () => {
    serve({ "/claims/": () => json(404, {}), "/claims": () => json(200, { ok: true, id: "c-new", checks: ["k-new"] }), [`/jobs/${JOB}/claims`]: () => json(200, { enabled: true, claims: LEDGER }) });
    await addJobClaim(FIRST, JOB, { text: "The page works on a phone", description: "Open it at 375 px wide." });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${LAB}/claims`);
    expect(JSON.parse(init.body)).toEqual({ subjects: [{ kind: "job", name: JOB }], text: "The page works on a phone", checks: [{ description: "Open it at 375 px wide." }] });
    expect(mockAppend.mock.calls[0][1].content).toBe('Added a claim: "The page works on a phone".');
    // A version made without a Verify is of the job's newest turn.
    expect(mockAppend.mock.calls[0][1].artifacts[0].source.content.turn).toBe(TURN_2);
  });
});
