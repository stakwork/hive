import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockHandleApproval, mockAppendTurnMessages } = vi.hoisted(() => ({
  mockHandleApproval: vi.fn(),
  mockAppendTurnMessages: vi.fn(),
}));

vi.mock("@/lib/proposals/handleApproval", () => ({
  handleApproval: mockHandleApproval,
  handleRejection: vi.fn(),
}));
vi.mock("@/services/canvas-turn-persistence", () => ({
  appendTurnMessages: mockAppendTurnMessages,
}));

import { runProposalIntent } from "@/lib/proposals/runProposalIntent";

function transcriptFor(kind: string) {
  return [
    {
      role: "assistant",
      toolCalls: [{ toolName: "propose_x", output: { kind, proposalId: "p-1" } }],
    },
  ];
}

async function failureText(kind: string): Promise<string> {
  mockHandleApproval.mockResolvedValue({ ok: false, error: "boom", status: 502 });
  const res = await runProposalIntent({
    orgId: "org-1",
    userId: "user-1",
    transcript: transcriptFor(kind),
    approvalIntent: { proposalId: "p-1" },
  });
  return res.text();
}

describe("runProposalIntent failure wording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["graphNodeDelete", "graphEdgeDelete"])("says 'delete' for %s", async (kind) => {
    const text = await failureText(kind);
    expect(text).toContain("I couldn't delete that: boom");
    expect(text).not.toContain("I couldn't create that");
  });

  it.each(["graphNodeCreate", "graphNodeEdit", "initiative"])("keeps 'create' for %s", async (kind) => {
    expect(await failureText(kind)).toContain("I couldn't create that: boom");
  });
});
