// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProposalBatchActions } from "@/app/org/[githubLogin]/_components/ProposalBatchActions";
import type { ProposalOutput } from "@/lib/proposals/types";

let state: any;
const listeners = new Set<() => void>();
const setState = (s: any) => {
  state = s;
  listeners.forEach((l) => l());
};

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => {
  const hook: any = (selector: (s: any) => any) => selector(state);
  hook.getState = () => state;
  hook.subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return { useCanvasChatStore: hook };
});

const sendMock = vi.fn();
vi.mock("@/app/org/[githubLogin]/_state/useSendCanvasChatMessage", () => ({
  useSendCanvasChatMessage: () => sendMock,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const concept = (id: string, name: string): ProposalOutput =>
  ({ kind: "conceptCreate", proposalId: id, payload: { name } }) as any;
const feature = (id: string): ProposalOutput =>
  ({ kind: "feature", proposalId: id, payload: { title: id } }) as any;

function init(messages: any[] = [], activeTurn?: unknown) {
  setState({
    activeConversationId: "c1",
    canvasViewport: null,
    conversations: { c1: { messages, context: { currentCanvasRef: "root" }, activeTurn } },
  });
}

/** Simulates a successful (or failed) turn by appending to the transcript. */
function simulate(failIds: string[] = []) {
  sendMock.mockImplementation(async (args: any) => {
    const msgs = [...state.conversations.c1.messages];
    msgs.push({
      id: `u${msgs.length}`,
      role: "user",
      content: args.content,
      ...(args.approval && { approval: args.approval }),
      ...(args.rejection && { rejection: args.rejection }),
    });
    if (args.approval && !failIds.includes(args.approval.proposalId)) {
      msgs.push({
        id: `a${msgs.length}`,
        role: "assistant",
        content: "ok",
        approvalResult: { proposalId: args.approval.proposalId },
      });
    }
    setState({
      ...state,
      conversations: { c1: { ...state.conversations.c1, messages: msgs } },
    });
  });
}

describe("ProposalBatchActions", () => {
  beforeEach(() => {
    sendMock.mockReset();
    init();
  });

  it("is hidden with fewer than 2 pending batchable proposals", () => {
    const { container } = render(<ProposalBatchActions proposals={[concept("a", "A")]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores non-batchable kinds", () => {
    const { container } = render(
      <ProposalBatchActions proposals={[concept("a", "A"), feature("f1"), feature("f2")]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Approve all (N) counting only pending batchable proposals", () => {
    init([{ id: "u", role: "user", content: "", rejection: { proposalId: "c" } }]);
    render(
      <ProposalBatchActions
        proposals={[concept("a", "A"), concept("b", "B"), concept("c", "C"), feature("f")]}
      />,
    );
    expect(screen.getByText("Approve all (2)")).toBeTruthy();
    expect(screen.getByText("Reject all")).toBeTruthy();
  });

  it("disables the bar while a turn is running", () => {
    init([], { turnId: "t" });
    render(<ProposalBatchActions proposals={[concept("a", "A"), concept("b", "B")]} />);
    expect((screen.getByText("Approve all (2)").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("approves sequentially in order with the single-card intent", async () => {
    simulate();
    render(<ProposalBatchActions proposals={[concept("a", "A"), concept("b", "B")]} />);
    fireEvent.click(screen.getByText("Approve all (2)"));
    await waitFor(() => expect(screen.getByText("2 approved")).toBeTruthy());
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0][0]).toEqual({
      conversationId: "c1",
      content: "Approved: A",
      approval: { proposalId: "a", currentRef: "root", viewport: { x: 40, y: 40 } },
    });
    expect(sendMock.mock.calls[1][0].approval.proposalId).toBe("b");
  });

  it("continues past a failure and counts it in the summary", async () => {
    simulate(["a"]);
    render(
      <ProposalBatchActions proposals={[concept("a", "Alpha"), concept("b", "B"), concept("c", "C")]} />,
    );
    fireEvent.click(screen.getByText("Approve all (3)"));
    await waitFor(() => expect(screen.getByText(/2 approved, 1 failed \(Alpha\)/)).toBeTruthy());
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it("reject all sends rejections", async () => {
    simulate();
    render(<ProposalBatchActions proposals={[concept("a", "A"), concept("b", "B")]} />);
    fireEvent.click(screen.getByText("Reject all"));
    await waitFor(() => expect(screen.getByText("2 rejected")).toBeTruthy());
    expect(sendMock.mock.calls.map((c) => c[0])).toEqual([
      { conversationId: "c1", content: "Rejected: A", rejection: { proposalId: "a" } },
      { conversationId: "c1", content: "Rejected: B", rejection: { proposalId: "b" } },
    ]);
  });
});
