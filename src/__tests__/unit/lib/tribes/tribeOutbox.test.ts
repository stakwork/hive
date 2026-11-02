/**
 * The pure parts of Jamie's outbox and tribe links (`lib/tribes/`): what a
 * reply posts as, what its metadata carries, where the cursor moves after an
 * ack, which mention a wake's reply threads under, and how a tribe and
 * Jamie's account are read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { orchestratorTribeLine, type StrutArtifactEnvelope } from "@/lib/strut-orchestrator";
import { jamieAccount } from "@/lib/tribes/jamie";
import { parseTribeRef, tribeJoinLink, tribeName } from "@/lib/tribes/tribeLinks";
import {
  advanceTribeCursor,
  MAX_TRIBE_METADATA_BYTES,
  MAX_TRIBE_TEXT_CHARS,
  opensInConversation,
  parseTribeMessageId,
  pendingTribeMessages,
  threadChain,
  tribeEnvelope,
  tribeMessageId,
  tribeText,
  type PendingTribeMessage,
} from "@/lib/tribes/tribeOutbox";

const PUBKEY = "02" + "a".repeat(64);
const opts = { approver: "Evan", conversationUrl: "https://hive.example.com/org/acme?chat=c1" };

describe("opensInConversation", () => {
  it("is the conversation's own deep link: same origin and path, the same chat; another chat, another page or no link is not", () => {
    const conversation = "https://hive.example.com/org/acme?chat=c1";
    expect(opensInConversation("https://hive.example.com/org/acme?chat=c1&artifact=id%3Aplan", conversation)).toBe(true);
    expect(opensInConversation("https://hive.example.com/org/acme?chat=c2&artifact=id%3Aplan", conversation)).toBe(false);
    expect(opensInConversation("https://hive.example.com/org/other?chat=c1", conversation)).toBe(false);
    expect(opensInConversation("https://github.com/acme/app/pull/7", conversation)).toBe(false);
    expect(opensInConversation("not a url", conversation)).toBe(false);
  });
});

describe("tribeText", () => {
  it("a reply: its words, the question, then a link for each deliverable with an address of its own — one that only opens the conversation in Hive gets no line", () => {
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
    ).toBe("Started on it.\n\nMain or the release branch?\n\nFix login: https://github.com/acme/app/pull/7");
  });

  it("a reply whose only deliverable is a Hive card posts its words alone: Peel draws the card from the metadata", () => {
    expect(
      tribeText(
        {
          id: "r",
          kind: "reply",
          text: "The page is attached.",
          artifacts: [{ title: "Plan & status", url: "https://hive.example.com/org/acme?chat=c1&artifact=graph%3Ax%3A%2Fjobs%2Fj%2Ffiles%2Findex.html" }],
          strut: { workspace: "acme", artifacts: [{ id: "index", kind: "html", title: "Plan & status", url: "/jobs/j/files/index.html" }] },
        },
        opts,
      ),
    ).toBe("The page is attached.");
  });

  it("a proposal waits for the linker", () => {
    expect(tribeText({ id: "p", kind: "proposal", text: "Proposed: x", title: "Login bug" }, opts)).toBe(
      "Waiting for Evan to approve: Login bug",
    );
  });

  it("a decision posts its outcome line as it is", () => {
    expect(tribeText({ id: "d", kind: "decision", text: "Applied: Login bug", title: "Login bug" }, opts)).toBe(
      "Applied: Login bug",
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

/** strut's card at its largest: 12 fields of 500 characters. */
const BIG_CARD = {
  v: 1,
  title: "Login bug",
  summary: "A Bug node under Auth.",
  fields: Array.from({ length: 12 }, (_, i) => ({ label: `field ${i}`, value: "x".repeat(500) })),
  actions: { accept: "Create", reject: "Don't" },
  full: true,
};
const bytesOf = (strut: StrutArtifactEnvelope) => Buffer.byteLength(JSON.stringify({ strut }), "utf8");

describe("tribeEnvelope", () => {
  it("a proposal is its stub: id, step, title, status and url, never the card, summary, rationale or when it was made", () => {
    expect(
      tribeEnvelope({
        workspace: "acme",
        artifacts: [],
        proposals: [
          {
            id: "p1",
            step: "graph/create-node",
            title: "Login bug",
            status: "pending",
            summary: "A Bug node under Auth.",
            card: BIG_CARD,
            url: "/proposals/p1",
            rationale: "The user asked for it.",
            createdAt: "2026-11-01T10:00:00Z",
          },
        ],
      }),
    ).toEqual({
      workspace: "acme",
      artifacts: [],
      proposals: [{ id: "p1", step: "graph/create-node", title: "Login bug", status: "pending", url: "/proposals/p1" }],
    });
  });

  it("a decision keeps its error, one line", () => {
    const [stack, long] = tribeEnvelope({
      workspace: "acme",
      artifacts: [],
      proposals: [
        { id: "p1", step: "package/install", title: "Install acme/board", status: "failed", error: "\n no such   package\n    at install (install.ts:1)" },
        { id: "p2", step: "package/install", title: "Install acme/chart", status: "failed", error: "y".repeat(500) },
      ],
    })!.proposals!;
    expect(stack).toEqual({ id: "p1", step: "package/install", title: "Install acme/board", status: "failed", error: "no such package" });
    expect(long.error).toHaveLength(200);
    expect(long.error!.endsWith("…")).toBe(true);
  });

  it("a deliverable is its name and its address: a url loses the inline content beside it, an app keeps its object, a peer's file its tags", () => {
    const app = { name: "board", version: "v3", hash: "h", builtAt: "2026-11-01T10:00:00Z" };
    expect(
      tribeEnvelope({
        workspace: "acme",
        artifacts: [
          {
            id: "index",
            kind: "html",
            title: "Plan & status",
            url: "/jobs/j/files/index.html",
            path: "index.html",
            content: "<html>" + "x".repeat(800) + "</html>",
            summary: "The plan",
            label: "Page",
          },
          { id: "board", kind: "app", title: "Board", app, url: "/apps/board/v3/files/dist/index.html", label: "App" },
          { id: "report", kind: "markdown", title: "Report", path: "report.md", peer: "openhealth", via: "lab", job: "peer/j-1", summary: "s" },
        ],
      }),
    ).toEqual({
      workspace: "acme",
      artifacts: [
        { id: "index", kind: "html", title: "Plan & status", url: "/jobs/j/files/index.html" },
        { id: "board", kind: "app", title: "Board", app },
        { id: "report", kind: "markdown", title: "Report", path: "report.md", peer: "openhealth", via: "lab", job: "peer/j-1" },
      ],
    });
  });

  it("over the cap, the last deliverables go first and the proposals stay; what is kept fits", () => {
    const artifacts = Array.from({ length: 20 }, (_, i) => ({
      id: `file-${i}`,
      kind: "markdown",
      title: `A deliverable with a fairly long title, number ${i}`,
      url: `/jobs/a-job-with-a-long-id/files/reports/deliverable-number-${i}.md`,
    }));
    const proposals = [
      { id: "p1", step: "graph/create-node", title: "Login bug", status: "pending" as const, url: "/proposals/p1", card: BIG_CARD },
      { id: "p2", step: "graph/create-node", title: "Signup bug", status: "pending" as const, url: "/proposals/p2", card: BIG_CARD },
    ];
    const out = tribeEnvelope({ workspace: "acme", artifacts, proposals })!;

    expect(out.proposals?.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(out.artifacts.length).toBeGreaterThan(0);
    expect(out.artifacts.length).toBeLessThan(artifacts.length);
    expect(out.artifacts).toEqual(artifacts.slice(0, out.artifacts.length));
    expect(bytesOf(out)).toBeLessThanOrEqual(MAX_TRIBE_METADATA_BYTES);
    const withNext = { ...out, artifacts: [...out.artifacts, artifacts[out.artifacts.length]] };
    expect(bytesOf(withNext)).toBeGreaterThan(MAX_TRIBE_METADATA_BYTES);
  });

  it("nothing left — no entry with an address, or none that fits — is no envelope", () => {
    expect(tribeEnvelope({ workspace: "acme", artifacts: [{ id: "note", title: "Note", content: "inline only" }] })).toBeNull();
    expect(
      tribeEnvelope({ workspace: "acme", artifacts: [{ id: "big", title: "y".repeat(MAX_TRIBE_METADATA_BYTES), url: "/artifacts/r/big.md" }] }),
    ).toBeNull();
  });
});

describe("pendingTribeMessages: a post's metadata", () => {
  const at = "2026-11-01T10:00:00.000Z";
  const thread = {
    id: "t1",
    conversationId: "c1",
    cursor: null,
    readAt: null,
    link: { id: "l1", tribePubkey: PUBKEY, userId: "u-evan", org: { githubLogin: "acme" }, user: { name: "Evan" } },
  };
  const proposalRow = {
    id: "orchestrator-run-1-proposal-p1",
    role: "assistant",
    content: "Proposed: Login bug",
    timestamp: at,
    source: {
      kind: "proposal",
      runId: "run-1",
      proposalId: "p1",
      url: "/proposals/p1",
      step: "graph/create-node",
      status: "pending",
      title: "Login bug",
      summary: "A Bug node under Auth.",
      card: BIG_CARD,
      rationale: "The user asked for it.",
      createdAt: at,
      workspace: "acme",
    },
  };
  const replyRow = {
    id: "orchestrator-run-1",
    role: "assistant",
    content: "Here is the note.",
    timestamp: at,
    source: { kind: "orchestrator", runId: "run-1", strutRunId: "s-1", status: "success" },
    strut: { workspace: "acme", artifacts: [{ id: "note", title: "Note", content: "inline only" }] },
  };

  it("a proposal's post: the same words, and the stub as its metadata, nothing more", async () => {
    vi.mocked(db.tribeMention.findMany).mockResolvedValue([{ runId: "run-1", mentionId: "msg-1" }] as never);
    vi.mocked(db.strutRun.findMany).mockResolvedValue([{ id: "run-1", userId: "u-evan" }] as never);
    const [message] = await pendingTribeMessages(thread, [proposalRow], "https://hive.example.com");
    expect(message.post).toEqual({
      id: "t1:orchestrator-run-1-proposal-p1",
      tribe: PUBKEY,
      thread: "t1",
      text: "Waiting for Evan to approve: Login bug",
      replyTo: "msg-1",
      metadata: {
        strut: {
          workspace: "acme",
          artifacts: [],
          proposals: [{ id: "p1", step: "graph/create-node", title: "Login bug", status: "pending", url: "/proposals/p1" }],
        },
      },
    });
  });

  it("a proposal of a turn that ran as a member the tribe named waits for them, by name, else by Sphinx alias", async () => {
    vi.mocked(db.tribeMention.findMany).mockResolvedValue([{ runId: "run-1", mentionId: "msg-1" }] as never);
    vi.mocked(db.strutRun.findMany).mockResolvedValue([{ id: "run-1", userId: "u-alice" }] as never);
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: "u-alice", name: null, sphinxAlias: "alice" }] as never);
    const [message] = await pendingTribeMessages(thread, [proposalRow], "https://hive.example.com");
    expect(message.post?.text).toBe("Waiting for alice to approve: Login bug");
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["u-alice"] } } }));
  });

  it("a reply whose entries leave nothing to reference posts its words with no metadata", async () => {
    vi.mocked(db.tribeMention.findMany).mockResolvedValue([]);
    const [message] = await pendingTribeMessages(thread, [replyRow], "https://hive.example.com");
    expect(message.post).toEqual({ id: "t1:orchestrator-run-1", tribe: PUBKEY, thread: "t1", text: "Here is the note." });
    // No proposal: nobody's turn is read.
    expect(db.strutRun.findMany).not.toHaveBeenCalled();
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

  it("a turn that runs as the member the tribe named says so, and keeps the rest", () => {
    const line = orchestratorTribeLine({ name: "Builders", alias: "Alice", asker: true });
    expect(line).toMatch(
      /^Asked in the Sphinx tribe #Builders by Alice, a member of this org; this turn runs as them\. Your reply is posted there, where not everyone is in this org, /,
    );
    expect(line).toMatch(/Names before a message are what the tribe shows, not verified\. $/);
    expect(orchestratorTribeLine({ name: null, alias: "Bob", owner: true, asker: true })).toMatch(
      /^Asked in a Sphinx tribe by Bob \(the tribe's owner\), a member of this org; this turn runs as them\. /,
    );
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
