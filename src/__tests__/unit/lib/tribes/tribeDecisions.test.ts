/**
 * A reply to Jamie's proposal post as a decision (`lib/tribes/tribeDecisions.ts`):
 * whether its words decide — the card's own button words first, then a few
 * plain ones, nothing else — and which proposal a reply is about.
 */
import { describe, expect, it } from "vitest";
import { decisionOfText, hasDecisionRow, lastOpenProposal, proposalOfRow } from "@/lib/tribes/tribeDecisions";

const install = { accept: "Install", reject: "Don't install" };

describe("decisionOfText", () => {
  it("the card's own words, as Peel sends them", () => {
    expect(decisionOfText("Install", { actions: install })).toBe("accept");
    expect(decisionOfText("Don't install", { actions: install })).toBe("reject");
  });

  it("the card's words before the plain ones: a card whose reject is 'ok' rejects on 'ok'", () => {
    expect(decisionOfText("ok", { actions: { accept: "Go", reject: "OK" } })).toBe("reject");
  });

  it("the plain words, whatever the card", () => {
    for (const w of ["accept", "approve", "yes", "ok"]) expect(decisionOfText(w, { actions: install })).toBe("accept");
    for (const w of ["reject", "decline", "no"]) expect(decisionOfText(w)).toBe("reject");
  });

  it("case, spacing, a closing . or !, a curly apostrophe and a leading @jamie don't matter", () => {
    expect(decisionOfText("  YES! ")).toBe("accept");
    expect(decisionOfText("don’t   INSTALL.", { actions: install })).toBe("reject");
    expect(decisionOfText("@jamie approve")).toBe("accept");
    expect(decisionOfText("@Jamie_2, no")).toBe("reject");
    expect(decisionOfText("@Bot approve", { alias: "Bot" })).toBe("accept");
  });

  it("anything else in the text is no decision", () => {
    expect(decisionOfText("yes please, and also fix the footer")).toBeNull();
    expect(decisionOfText("approve?")).toBeNull();
    expect(decisionOfText("@bob yes")).toBeNull();
    expect(decisionOfText("@jamiex yes")).toBeNull();
    expect(decisionOfText("@jamie")).toBeNull();
    expect(decisionOfText("Install now", { actions: install })).toBeNull();
  });
});

const turn = (runId: string) => ({
  id: `orchestrator-${runId}`,
  role: "assistant",
  source: { kind: "orchestrator", runId, status: "success" },
});
const proposal = (runId: string, proposalId: string, extra: Record<string, unknown> = {}) => ({
  id: `orchestrator-${runId}-proposal-${proposalId}`,
  role: "assistant",
  source: {
    kind: "proposal",
    runId,
    proposalId,
    step: "package/install",
    status: "pending",
    title: `Install ${proposalId}`,
    ...extra,
  },
});
const decided = (proposalId: string, status: string) => ({
  id: `decided-${proposalId}-${status}`,
  role: "assistant",
  source: { kind: "proposal_result", runId: "r1", proposalId, status, title: "x" },
});
const card = { v: 1, title: "Install", fields: [], actions: install, full: true };

describe("which proposal a reply is about", () => {
  it("the post's row, when it is a proposal's, with its card's words", () => {
    const rows = [turn("r1"), proposal("r1", "p1", { card })];
    expect(proposalOfRow(rows, "orchestrator-r1-proposal-p1")).toEqual({
      rowId: "orchestrator-r1-proposal-p1",
      runId: "r1",
      proposalId: "p1",
      title: "Install p1",
      actions: install,
    });
    expect(proposalOfRow(rows, "orchestrator-r1")).toBeNull();
    expect(proposalOfRow(rows, "nope")).toBeNull();
  });

  it("no post named: the one proposal the newest turn left open", () => {
    expect(lastOpenProposal([turn("r1"), proposal("r1", "p1")])?.proposalId).toBe("p1");
    expect(lastOpenProposal([turn("r1"), proposal("r1", "p1"), decided("p1", "failed")])?.proposalId).toBe("p1");
    expect(
      lastOpenProposal([turn("r1"), proposal("r1", "p1"), proposal("r1", "p2"), decided("p2", "rejected")])?.proposalId,
    ).toBe("p1");
  });

  it("none when a newer turn came after it, it was decided, or two are open", () => {
    expect(lastOpenProposal([turn("r1"), proposal("r1", "p1"), turn("r2")])).toBeNull();
    expect(lastOpenProposal([turn("r1"), proposal("r1", "p1"), decided("p1", "applied")])).toBeNull();
    expect(lastOpenProposal([turn("r1"), proposal("r1", "p1"), proposal("r1", "p2")])).toBeNull();
    expect(lastOpenProposal([])).toBeNull();
  });

  it("whether the conversation already says a proposal is at a status", () => {
    const rows = [proposal("r1", "p1"), decided("p1", "applied")];
    expect(hasDecisionRow(rows, "p1", "applied")).toBe(true);
    expect(hasDecisionRow(rows, "p1", "rejected")).toBe(false);
    expect(hasDecisionRow(rows, "p2", "applied")).toBe(false);
  });
});
