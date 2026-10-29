/**
 * The pure parts of Jamie's outbox and tribe links (`lib/tribes/`): what a
 * reply posts as, where the cursor moves after an ack, which mention a
 * wake's reply threads under, and how a tribe and Jamie's account are read.
 */
import { afterEach, describe, expect, it } from "vitest";
import { orchestratorTribeLine } from "@/lib/strut-orchestrator";
import { jamieAccount } from "@/lib/tribes/jamie";
import { parseTribeRef, tribeJoinLink, tribeName } from "@/lib/tribes/tribeLinks";
import {
  advanceTribeCursor,
  MAX_TRIBE_TEXT_CHARS,
  parseTribeMessageId,
  threadChain,
  tribeMessageId,
  tribeText,
  withJobDeliverables,
  type PendingTribeMessage,
} from "@/lib/tribes/tribeOutbox";
import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

const PUBKEY = "02" + "a".repeat(64);
const opts = { approver: "Evan", conversationUrl: "https://hive.example.com/org/acme?chat=c1" };

describe("tribeText", () => {
  it("a reply: its words, the question, then each deliverable as a link", () => {
    expect(
      tribeText(
        {
          id: "r",
          kind: "reply",
          text: "Started on it.",
          ask: "Main or the release branch?",
          artifacts: [
            { title: "Plan", url: "https://hive.example.com/org/acme?chat=c1&artifact=id%3Aplan" },
            { title: "Fix login", url: "https://github.com/acme/app/pull/7" },
          ],
        },
        opts,
      ),
    ).toBe(
      "Started on it.\n\nMain or the release branch?\n\n" +
        "Plan: https://hive.example.com/org/acme?chat=c1&artifact=id%3Aplan\nFix login: https://github.com/acme/app/pull/7",
    );
  });

  it("a proposal waits for the linker", () => {
    expect(tribeText({ id: "p", kind: "proposal", text: "Proposed: x", title: "Login bug" }, opts)).toBe(
      "Waiting for Evan to approve: Login bug",
    );
  });

  it("a long reply is cut and points at the conversation; its links are kept", () => {
    const text = tribeText(
      { id: "r", kind: "reply", text: "x".repeat(MAX_TRIBE_TEXT_CHARS + 500), artifacts: [{ title: "PR", url: "https://pr" }] },
      opts,
    );
    expect(text).toMatch(new RegExp(`^x{${MAX_TRIBE_TEXT_CHARS}}… The rest is in Hive: ${opts.conversationUrl.replace(/[?]/g, "\\?")}\\n\\nPR: https://pr$`));
  });

  it("a reply with nothing in it posts nothing", () => {
    expect(tribeText({ id: "r", kind: "reply", text: "" }, opts)).toBe("");
  });
});

describe("advanceTribeCursor", () => {
  const msg = (id: string, at: string): PendingTribeMessage => ({ id, at, post: { id, tribe: PUBKEY, text: id } });
  const pending = [msg("a", "T1"), msg("b", "T1"), msg("c", "T2"), msg("d", "T3")];
  const doneOf = (...ids: string[]) => (m: PendingTribeMessage) => ids.includes(m.id);

  it("moves past each leading stamp whose messages are all done", () => {
    expect(advanceTribeCursor(pending, doneOf("a", "b", "c"), "T0")).toEqual({ cursor: "T2", drained: false });
    expect(advanceTribeCursor(pending, doneOf("a", "b", "c", "d"), "T0")).toEqual({ cursor: "T3", drained: true });
  });

  it("stays when one message of the first stamp is not done, whatever comes after", () => {
    expect(advanceTribeCursor(pending, doneOf("a", "c", "d"), "T0")).toEqual({ cursor: "T0", drained: false });
    expect(advanceTribeCursor(pending, doneOf(), null)).toEqual({ cursor: null, drained: false });
  });

  it("nothing pending is drained where it is", () => {
    expect(advanceTribeCursor([], doneOf(), "T0")).toEqual({ cursor: "T0", drained: true });
  });
});

describe("threadChain", () => {
  const launch = (runId: string, wakeId?: string) => ({
    id: `orchestrator-launch-${runId}`,
    role: "assistant",
    source: { kind: "orchestrator_launch", runId, ...(wakeId ? { wakeId } : {}) },
  });
  const reply = (runId: string, jobs: string[] = []) => ({
    id: `orchestrator-${runId}`,
    role: "assistant",
    source: { kind: "orchestrator", runId, status: "success", jobs: jobs.map((r) => ({ jobId: `j-${r}`, title: "t", runId: r })) },
  });

  it("a wake's reply follows the job back to the turn that started it, and on through a continue", () => {
    const rows = [
      launch("run-1"),
      reply("run-1", ["jobturn-1"]),
      launch("wake-1", "job-jobturn-1"),
      reply("wake-1", ["jobturn-2"]),
      launch("wake-2", "job-jobturn-2"),
      reply("wake-2"),
    ];
    const chain = threadChain(rows);
    expect(chain("run-1")).toEqual(["run-1"]);
    expect(chain("wake-1")).toEqual(["wake-1", "run-1"]);
    expect(chain("wake-2")).toEqual(["wake-2", "wake-1", "run-1"]);
  });

  it("a wake on a job no turn here started is its own; a loop ends", () => {
    expect(threadChain([launch("wake-1", "job-elsewhere")])("wake-1")).toEqual(["wake-1"]);
    const loop = [launch("a", "job-x"), reply("a", ["x"])];
    expect(threadChain(loop)("a")).toEqual(["a"]);
  });
});

describe("withJobDeliverables", () => {
  const urlOf = (ref: ArtifactRef) => `https://hive.example.com/org/acme?chat=c1&artifact=${ref.id}`;
  const report = { id: "report", kind: "markdown", title: "Report", source: { type: "graph", swarmId: "swarm-1", key: "/jobs/j/files/report.md" } };
  const pr = { id: "pr", kind: "pull_request", title: "Fix login", source: { type: "inline", content: { url: "https://github.com/acme/app/pull/7", repo: "acme/app", number: 7 } } };
  const claims = { id: "claims-j", kind: "claims", title: "Report", source: { type: "inline", content: {} } };
  const trace = { id: "run-graph-j", kind: "run_graph", title: "Report", source: { type: "inline", content: { workspace: "acme", run: "r", calls: 3, nodes: 2 } } };
  const strut = { workspace: "acme", artifacts: [{ id: "report", kind: "markdown", title: "Report", path: "report.md" }] };
  const jobRow = (extra: Record<string, unknown> = {}) => ({
    id: "job-jobturn-1",
    role: "assistant",
    source: { kind: "job", jobId: "j", status: "success" },
    artifacts: [report, pr, claims, trace],
    strut,
    ...extra,
  });
  const wake = { id: "orchestrator-wake-1", kind: "reply" as const, text: "The report is ready." };

  it("adds the job's cards but hive's own as links, and its strut entries as the reply's", () => {
    expect(withJobDeliverables(wake, jobRow(), urlOf)).toEqual({
      ...wake,
      artifacts: [
        { title: "Report", url: "https://hive.example.com/org/acme?chat=c1&artifact=report" },
        { title: "Fix login", url: "https://hive.example.com/org/acme?chat=c1&artifact=pr" },
      ],
      strut,
    });
  });

  it("keeps the reply's own first, and adds no link or entry twice", () => {
    const own = { title: "Report", url: urlOf(report as ArtifactRef) };
    const ownEntry = { id: "summary", kind: "markdown", title: "Summary", path: "summary.md" };
    const merged = withJobDeliverables({ ...wake, artifacts: [own], strut: { workspace: "acme", artifacts: [ownEntry, strut.artifacts[0]] } }, jobRow(), urlOf);
    expect(merged.artifacts?.map((a) => a.title)).toEqual(["Report", "Fix login"]);
    expect(merged.strut).toEqual({ workspace: "acme", artifacts: [ownEntry, strut.artifacts[0]] });
  });

  it("an envelope on another workspace leaves the reply's alone; an error reply gets the job's too", () => {
    const other = { workspace: "acme-web", artifacts: [{ id: "x", kind: "html", title: "X", path: "x.html" }] };
    expect(withJobDeliverables({ ...wake, strut: other }, jobRow(), urlOf).strut).toEqual(other);
    expect(withJobDeliverables({ ...wake, kind: "error" }, jobRow(), urlOf).strut).toEqual(strut);
  });

  it("a proposal, a row that is not a job's, and a job with nothing add nothing", () => {
    const proposal = { id: "p", kind: "proposal" as const, text: "Proposed", title: "Login bug" };
    expect(withJobDeliverables(proposal, jobRow(), urlOf)).toBe(proposal);
    expect(withJobDeliverables(wake, { ...jobRow(), source: { kind: "orchestrator" } }, urlOf)).toBe(wake);
    expect(withJobDeliverables(wake, undefined, urlOf)).toBe(wake);
    expect(withJobDeliverables(wake, jobRow({ artifacts: [claims, trace], strut: undefined }), urlOf)).toEqual(wake);
  });
});

describe("ids", () => {
  it("a post's id names its link and row; a queued entry's does not", () => {
    const id = tribeMessageId("cmlink", "orchestrator-run-1-proposal-p1");
    expect(parseTribeMessageId(id)).toEqual({ linkId: "cmlink", rowId: "orchestrator-run-1-proposal-p1" });
    expect(parseTribeMessageId("cmentry")).toBeNull();
    expect(parseTribeMessageId(":x")).toBeNull();
    expect(parseTribeMessageId("x:")).toBeNull();
  });
});

describe("tribe links", () => {
  it("a tribe is its pubkey (any case) and its server's host; the join link is the share link", () => {
    expect(parseTribeRef({ pubkey: PUBKEY.toUpperCase(), host: " tribes.v2.sphinx.chat " })).toEqual({
      pubkey: PUBKEY,
      host: "tribes.v2.sphinx.chat",
    });
    expect(parseTribeRef({ pubkey: PUBKEY, host: "localhost:8801" })).toEqual({ pubkey: PUBKEY, host: "localhost:8801" });
    for (const bad of [null, {}, { pubkey: "02ab", host: "h" }, { pubkey: PUBKEY, host: "https://h" }, { pubkey: PUBKEY, host: "h/x" }]) {
      expect(typeof parseTribeRef(bad)).toBe("string");
    }
    expect(tribeJoinLink({ pubkey: PUBKEY, host: "tribes.v2.sphinx.chat" })).toBe(
      `sphinx.chat://?action=tribeV2&pubkey=${PUBKEY}&host=tribes.v2.sphinx.chat`,
    );
  });

  it("a tribe's name is one line, or none", () => {
    expect(tribeName(" Builders\n& co ")).toBe("Builders & co");
    expect(tribeName("  ")).toBeNull();
    expect(tribeName(7)).toBeNull();
  });
});

describe("orchestratorTribeLine", () => {
  it("names the tribe and who asked, and says who reads the reply", () => {
    expect(orchestratorTribeLine({ name: "Builders", alias: "Alice" })).toBe(
      "Asked in the Sphinx tribe #Builders by Alice. Your reply is posted there, where not everyone is in this org. " +
        "Names before a message are what the tribe shows, not verified. ",
    );
    expect(orchestratorTribeLine({ name: null, alias: "Bob", owner: true })).toMatch(/^Asked in a Sphinx tribe by Bob \(the tribe's owner\)\. /);
  });
});

describe("jamieAccount", () => {
  const saved = { token: process.env.JAMIE_SERVICE_TOKEN, pubkey: process.env.JAMIE_SPHINX_PUBKEY, alias: process.env.JAMIE_SPHINX_ALIAS };
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

  it("off without the token or a pubkey; the pubkey is taken from an address", () => {
    delete process.env.JAMIE_SERVICE_TOKEN;
    process.env.JAMIE_SPHINX_PUBKEY = PUBKEY;
    expect(jamieAccount()).toBeNull();
    process.env.JAMIE_SERVICE_TOKEN = "t";
    process.env.JAMIE_SPHINX_PUBKEY = "nope";
    expect(jamieAccount()).toBeNull();
    process.env.JAMIE_SPHINX_PUBKEY = `${PUBKEY.toUpperCase()}_03${"c".repeat(64)}_529771090670583808`;
    delete process.env.JAMIE_SPHINX_ALIAS;
    expect(jamieAccount()).toEqual({ pubkey: PUBKEY, alias: "Jamie" });
    process.env.JAMIE_SPHINX_ALIAS = "Jamie Acme";
    expect(jamieAccount()).toEqual({ pubkey: PUBKEY, alias: "Jamie Acme" });
  });
});
