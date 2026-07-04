/**
 * @vitest-environment jsdom
 *
 * Tests for ChatDetailCaptureWrapper — the client component that adds
 * per-turn Flag buttons to canvas/chat conversation pages.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ── Captured props ────────────────────────────────────────────────────────────
let capturedOnFlagTurn: ((i: number) => void) | undefined;

vi.mock("@/components/agent-logs/LogDetailContent", () => ({
  LogDetailContent: (props: { onFlagTurn?: (i: number) => void; [key: string]: unknown }) => {
    capturedOnFlagTurn = props.onFlagTurn;
    return React.createElement("div", {
      "data-testid": "log-detail-content",
      onClick: props.onFlagTurn ? () => props.onFlagTurn!(0) : undefined,
    });
  },
}));

let capturedModalProps: Record<string, unknown> = {};

vi.mock("@/components/evals/AgentSessionCaptureModal", () => ({
  AgentSessionCaptureModal: (props: Record<string, unknown>) => {
    capturedModalProps = props;
    return props.open
      ? React.createElement("div", {
          "data-testid": "capture-modal",
          "data-log-id": props.logId,
          "data-default-agent": props.defaultAgent,
        })
      : null;
  },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

const baseConversation = [{ role: "assistant", content: "hello" }];
const baseStats = { messageCount: 1, tokenEstimate: 5, toolUsage: {}, bashCommands: [] };

async function renderWrapper(slug: string) {
  capturedOnFlagTurn = undefined;
  capturedModalProps = {};
  vi.resetModules();

  const { ChatDetailCaptureWrapper } = await import(
    "@/app/w/[slug]/agent-logs/chat/[conversationId]/_components/ChatDetailCaptureWrapper"
  );

  return render(
    React.createElement(ChatDetailCaptureWrapper, {
      slug,
      conversationId: "conv-abc",
      conversation: baseConversation as never,
      stats: baseStats as never,
      rawContent: "",
    })
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("ChatDetailCaptureWrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes onFlagTurn to LogDetailContent for 'stakwork' slug", async () => {
    await renderWrapper("stakwork");
    expect(typeof capturedOnFlagTurn).toBe("function");
  });

  it("passes onFlagTurn to LogDetailContent for 'hive' slug", async () => {
    await renderWrapper("hive");
    expect(typeof capturedOnFlagTurn).toBe("function");
  });

  it("does NOT pass onFlagTurn for non-allowlisted slugs", async () => {
    await renderWrapper("other-org");
    expect(capturedOnFlagTurn).toBeUndefined();
  });

  it("renders AgentSessionCaptureModal with conversationId as logId and defaultAgent='canvas-agent' for hive", async () => {
    await renderWrapper("hive");
    // Modal starts closed — check the props passed via mock
    expect(capturedModalProps.logId).toBe("conv-abc");
    expect(capturedModalProps.defaultAgent).toBe("canvas-agent");
    expect(capturedModalProps.slug).toBe("hive");
  });

  it("does NOT render AgentSessionCaptureModal for non-allowlisted slugs", async () => {
    await renderWrapper("other-org");
    expect(screen.queryByTestId("capture-modal")).toBeNull();
    // capturedModalProps stays empty — modal was never mounted
    expect(capturedModalProps).toEqual({});
  });

  it("opens modal when onFlagTurn is called (click simulation)", async () => {
    await renderWrapper("hive");

    // Simulate clicking the LogDetailContent (which calls onFlagTurn(0))
    const content = screen.getByTestId("log-detail-content");
    await userEvent.click(content);

    await waitFor(() => {
      expect(screen.getByTestId("capture-modal")).toBeTruthy();
    });
  });
});
