/**
 * What voice reads off a call's conversation (`lib/calls/callMessages.ts`):
 * replies (wake replies too), proposals and failed turns, from the row's
 * `source`; never user rows, launch markers, job rows, decisions or silent
 * replies; the cursor is the last delivered row's timestamp.
 */
import { describe, expect, it } from "vitest";
import { callArtifactUrl, callMessagesSince } from "@/lib/calls/callMessages";
import { renderOrchestratorContent } from "@/services/strut-runs/orchestrator-turn";

const T0 = "2026-10-26T10:00:00.000Z";
const T1 = "2026-10-26T10:00:05.000Z";
const T2 = "2026-10-26T10:00:09.000Z";
const T3 = "2026-10-26T10:20:00.000Z";

const links = { base: "https://hive.example.com", conversationUrl: "https://hive.example.com/org/acme?chat=conv-1" };
const url = (ref: Parameters<typeof callArtifactUrl>[0]) => callArtifactUrl(ref, links);

const reply = (id: string, timestamp: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  role: "assistant",
  content: text,
  timestamp,
  source: { kind: "orchestrator", runId: id, strutRunId: "s", status: "success", ...extra },
});

const rows = [
  { id: "t1-u", role: "user", content: "Alice: what are we working on?", timestamp: T0 },
  { id: "orchestrator-launch-r1", role: "assistant", content: "", timestamp: T0, source: { kind: "orchestrator_launch", runId: "r1" } },
  reply("orchestrator-r1", T1, "The auth job and the billing page."),
  {
    id: "orchestrator-r1-proposal-p1",
    role: "assistant",
    content: "Proposed: Billing retries (`graph/create-node`) — asked on the call",
    timestamp: T1,
    source: { kind: "proposal", runId: "r1", proposalId: "p1", url: "/proposals/p1", step: "graph/create-node", status: "pending", title: "Billing retries" },
  },
  { id: "job-j1", role: "assistant", content: "Job done", timestamp: T2, source: { kind: "job" } },
  { id: "orchestrator-r2", role: "assistant", content: "", timestamp: T2, source: { kind: "orchestrator", runId: "r2", strutRunId: "s", status: "silent" } },
  { id: "proposal-result", role: "assistant", content: "Accepted", timestamp: T2, source: { kind: "proposal_result" } },
  reply("orchestrator-r3", T3, "The auth PR is up."),
];

describe("callMessagesSince", () => {
  it("from the start: replies and proposals in order, nothing else", () => {
    const page = callMessagesSince(rows, null, url);
    expect(page.messages.map((m) => [m.id, m.kind])).toEqual([
      ["orchestrator-r1", "reply"],
      ["orchestrator-r1-proposal-p1", "proposal"],
      ["orchestrator-r3", "reply"],
    ]);
    expect(page.messages[1]).toEqual({
      id: "orchestrator-r1-proposal-p1",
      kind: "proposal",
      text: "Proposed: Billing retries (`graph/create-node`) — asked on the call",
      title: "Billing retries",
    });
    expect(page.cursor).toBe(T3);
  });

  it("after a cursor: only what landed later, and the cursor moves to it", () => {
    expect(callMessagesSince(rows, T1, url)).toEqual({
      cursor: T3,
      messages: [{ id: "orchestrator-r3", kind: "reply", text: "The auth PR is up." }],
    });
  });

  it("nothing new: the same cursor and no messages", () => {
    expect(callMessagesSince(rows, T3, url)).toEqual({ cursor: T3, messages: [] });
    expect(callMessagesSince([], null, url)).toEqual({ cursor: null, messages: [] });
  });

  it("a cursor on rows that are left out does not move", () => {
    expect(callMessagesSince(rows.slice(0, 2), null, url)).toEqual({ cursor: null, messages: [] });
  });

  it("ask comes verbatim from the source, and the reply's text without the rendered question", () => {
    const ask = "Open the PR against main or the release branch?";
    const content = renderOrchestratorContent({ outcome: "success", text: "The fix is ready.", ask }, []);
    const [message] = callMessagesSince([reply("orchestrator-r4", T1, content, { ask })], null, url).messages;
    expect(message).toEqual({ id: "orchestrator-r4", kind: "reply", text: "The fix is ready.", ask });
  });

  it("a turn that failed, was stopped or was lost is an error, with what the row says", () => {
    const failed = (status: string, text: string) => ({
      id: `orchestrator-${status}`,
      role: "assistant",
      content: text,
      timestamp: T1,
      source: { kind: "orchestrator", runId: status, strutRunId: "s", status },
    });
    const page = callMessagesSince(
      [failed("error", "The turn did not complete: boom"), failed("cancelled", "The turn was stopped."), failed("lost", "Strut lost track")],
      null,
      url,
    );
    expect(page.messages).toEqual([
      { id: "orchestrator-error", kind: "error", text: "The turn did not complete: boom" },
      { id: "orchestrator-cancelled", kind: "error", text: "The turn was stopped." },
      { id: "orchestrator-lost", kind: "error", text: "Strut lost track" },
    ]);
  });

  it("artifacts as title + absolute url", () => {
    const row = {
      ...reply("orchestrator-r5", T1, "Here it is."),
      artifacts: [
        { id: "pr", kind: "pull_request", title: "Fix login", source: { type: "inline", content: { url: "https://github.com/acme/app/pull/7", repo: "acme/app", number: 7 } } },
        { id: "shot", kind: "image", title: "Screenshot", source: { type: "inline", content: { url: "/api/files/shot.png" } } },
        { id: "plan", kind: "markdown", title: "Plan", source: { type: "inline", content: { text: "# Plan" } } },
        { id: "bad", title: "Not a ref" },
      ],
    };
    const [message] = callMessagesSince([row], null, url).messages;
    expect(message.artifacts).toEqual([
      { title: "Fix login", url: "https://github.com/acme/app/pull/7" },
      { title: "Screenshot", url: "https://hive.example.com/api/files/shot.png" },
      { title: "Plan", url: "https://hive.example.com/org/acme?chat=conv-1&artifact=id%3Aplan" },
    ]);
  });

  it("the row's strut entries ride along untouched; a malformed envelope is left out", () => {
    const strut = {
      workspace: "acme",
      artifacts: [
        { id: "plan", kind: "markdown", title: "Plan", url: "/jobs/j-1/files/plan.md" },
        { id: "shot", kind: "image", title: "Shot", peer: "web", via: "billing", job: "peer/j-7", path: "a.png" },
      ],
    };
    const [kept, noWorkspace, empty, none] = callMessagesSince(
      [
        { ...reply("orchestrator-r6", T1, "Here."), strut },
        { ...reply("orchestrator-r7", T1, "Here."), strut: { artifacts: strut.artifacts } },
        { ...reply("orchestrator-r8", T1, "Here."), strut: { workspace: "acme", artifacts: [] } },
        reply("orchestrator-r9", T1, "Here."),
      ],
      null,
      url,
    ).messages;
    expect(kept.strut).toEqual(strut);
    expect([noWorkspace.strut, empty.strut, none.strut]).toEqual([undefined, undefined, undefined]);
    expect("strut" in none).toBe(false);
  });
});

describe("callArtifactUrl", () => {
  it("a file on a swarm opens in the conversation, by its identity", () => {
    expect(
      callArtifactUrl(
        { id: "f", kind: "markdown", title: "Notes", source: { type: "graph", swarmId: "sw1", key: "/jobs/j1/files/notes.md" } },
        links,
      ),
    ).toBe(
      `https://hive.example.com/org/acme?chat=conv-1&artifact=${encodeURIComponent("graph:sw1:/jobs/j1/files/notes.md")}`,
    );
  });
});
