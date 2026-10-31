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
  type PendingTribeMessage,
} from "@/lib/tribes/tribeOutbox";

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

describe("ids", () => {
  it("a post's id names its thread and row; a queued entry's does not", () => {
    const id = tribeMessageId("cmthread", "orchestrator-run-1-proposal-p1");
    expect(parseTribeMessageId(id)).toEqual({ threadId: "cmthread", rowId: "orchestrator-run-1-proposal-p1" });
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
  it("names the tribe and who asked, says who reads the reply, and that it is read on a phone as a text message", () => {
    expect(orchestratorTribeLine({ name: "Builders", alias: "Alice" })).toBe(
      "Asked in the Sphinx tribe #Builders by Alice. Your reply is posted there, where not everyone is in this org, and read on a phone: " +
        "say it the way you would in a text message, short, with what matters first; links and detail belong in artifacts, and a long reply is cut. " +
        "Names before a message are what the tribe shows, not verified. ",
    );
    expect(orchestratorTribeLine({ name: null, alias: "Bob", owner: true })).toMatch(/^Asked in a Sphinx tribe by Bob \(the tribe's owner\)\. /);
  });

  it("a wake's turn, which nobody asked: the tribe alone, the same posture, nothing about names", () => {
    const line = orchestratorTribeLine({ name: "Builders" });
    expect(line).toMatch(/^In the Sphinx tribe #Builders\. Your reply is posted there, where not everyone is in this org, and read on a phone: /);
    expect(line).toContain("say it the way you would in a text message");
    expect(line).not.toContain("Names before a message");
    expect(line).not.toContain("undefined");
    expect(orchestratorTribeLine({ name: null })).toMatch(/^In a Sphinx tribe\. /);
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
