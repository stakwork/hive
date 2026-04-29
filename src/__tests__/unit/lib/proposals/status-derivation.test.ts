import { describe, it, expect } from "vitest";
import {
  getProposalStatus,
  type ApprovalResult,
} from "@/lib/proposals/types";

// Helper to build a minimal message-like object inline.
function msg(
  role: "user" | "assistant",
  extra: Record<string, unknown> = {},
) {
  return { role, ...extra } as Parameters<typeof getProposalStatus>[0][number];
}

describe("getProposalStatus", () => {
  it("returns pending when no matching events exist", () => {
    expect(getProposalStatus([], "p_1")).toEqual({ status: "pending" });
    expect(
      getProposalStatus(
        [msg("user", { content: "hello" }), msg("assistant", {})],
        "p_1",
      ),
    ).toEqual({ status: "pending" });
  });

  it("returns approved when an assistant message carries a matching approvalResult", () => {
    const result: ApprovalResult = {
      proposalId: "p_1",
      kind: "initiative",
      createdEntityId: "init_xyz",
      landedOn: "",
    };
    const msgs = [
      msg("user", { approval: { proposalId: "p_1" } }),
      msg("assistant", { approvalResult: result }),
    ];
    expect(getProposalStatus(msgs, "p_1")).toEqual({
      status: "approved",
      result,
    });
  });

  it("returns rejected when a user message carries a matching rejection", () => {
    const msgs = [
      msg("user", { rejection: { proposalId: "p_1" } }),
    ];
    expect(getProposalStatus(msgs, "p_1")).toEqual({ status: "rejected" });
  });

  it("returns pending-in-flight when approval was sent but no result yet", () => {
    const msgs = [
      msg("user", { approval: { proposalId: "p_1" } }),
      msg("assistant", { content: "(no approvalResult yet)" }),
    ];
    expect(getProposalStatus(msgs, "p_1")).toEqual({
      status: "pending-in-flight",
    });
  });

  it("approved wins over rejected when both somehow appear (DB is authoritative)", () => {
    const result: ApprovalResult = {
      proposalId: "p_1",
      kind: "feature",
      createdEntityId: "feat_a",
      landedOn: "ws:ws_1",
    };
    const msgs = [
      msg("user", { approval: { proposalId: "p_1" } }),
      msg("assistant", { approvalResult: result }),
      msg("user", { rejection: { proposalId: "p_1" } }), // shouldn't normally happen
    ];
    expect(getProposalStatus(msgs, "p_1")).toEqual({
      status: "approved",
      result,
    });
  });

  it("scans across multiple proposals independently", () => {
    const result1: ApprovalResult = {
      proposalId: "p_1",
      kind: "initiative",
      createdEntityId: "init_a",
      landedOn: "",
    };
    const msgs = [
      msg("user", { approval: { proposalId: "p_1" } }),
      msg("assistant", { approvalResult: result1 }),
      msg("user", { rejection: { proposalId: "p_2" } }),
      msg("user", { approval: { proposalId: "p_3" } }),
    ];
    expect(getProposalStatus(msgs, "p_1")).toEqual({
      status: "approved",
      result: result1,
    });
    expect(getProposalStatus(msgs, "p_2")).toEqual({ status: "rejected" });
    expect(getProposalStatus(msgs, "p_3")).toEqual({
      status: "pending-in-flight",
    });
    expect(getProposalStatus(msgs, "p_4")).toEqual({ status: "pending" });
  });

  it("ignores approvalResult on user messages and rejection on assistant messages", () => {
    // approvalResult is supposed to ride on assistant messages only;
    // a user message with one shouldn't flip status (defensive).
    const result: ApprovalResult = {
      proposalId: "p_1",
      kind: "initiative",
      createdEntityId: "init_a",
      landedOn: "",
    };
    const msgs = [
      msg("user", { approvalResult: result }),
      msg("assistant", { rejection: { proposalId: "p_1" } }),
    ];
    expect(getProposalStatus(msgs, "p_1")).toEqual({ status: "pending" });
  });
});
