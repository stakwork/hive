// @vitest-environment jsdom
/**
 * Unit tests for `getResearchRunsFromMessages` and `ResearchRunCard`.
 */

import React from "react";
import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  getResearchRunsFromMessages,
  ResearchRunCard,
} from "@/app/org/[githubLogin]/_components/ResearchRunCard";
import type { CanvasChatMessage } from "@/app/org/[githubLogin]/_state/canvasChatStore";

// ── Helpers ──────────────────────────────────────────────────────────────────

function outboundDispatch(
  id: string,
  researchId: string | undefined,
  overrides: { slug?: string; topic?: string; title?: string } = {},
): CanvasChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: new Date(),
    toolCalls: [
      {
        id: `tc-${id}`,
        toolName: "dispatch_research",
        input: {
          slug: overrides.slug ?? "my-topic",
          topic: overrides.topic ?? "My Topic",
          title: overrides.title ?? "My Title",
        },
        status: "output-available",
        output: researchId
          ? {
              researchId,
              slug: overrides.slug ?? "my-topic",
              topic: overrides.topic ?? "My Topic",
              title: overrides.title ?? "My Title",
              status: "dispatched",
              awaitingReply: true,
            }
          : {},
      },
    ],
  };
}

function inboundFanout(
  id: string,
  researchId: string,
  status: "ready" | "failed",
  overrides: { slug?: string; topic?: string; title?: string; initiativeId?: string } = {},
): CanvasChatMessage {
  return {
    id,
    role: "assistant",
    content: status === "ready" ? "Research ready" : "Research failed",
    timestamp: new Date(),
    source: {
      kind: "research",
      researchId,
      slug: overrides.slug ?? "my-topic",
      topic: overrides.topic ?? "My Topic",
      title: overrides.title ?? "My Title",
      status,
      ...(overrides.initiativeId ? { initiativeId: overrides.initiativeId } : {}),
    },
  };
}

// ── getResearchRunsFromMessages ───────────────────────────────────────────────

describe("getResearchRunsFromMessages", () => {
  test("outbound-only: dispatch_research tool call → status dispatched", () => {
    const messages: CanvasChatMessage[] = [outboundDispatch("msg-1", "res-1")];
    const runs = getResearchRunsFromMessages(messages);
    expect(runs).toHaveLength(1);
    expect(runs[0].researchId).toBe("res-1");
    expect(runs[0].status).toBe("dispatched");
    expect(runs[0].anchorMessageId).toBe("msg-1");
    expect(runs[0].slug).toBe("my-topic");
    expect(runs[0].topic).toBe("My Topic");
    expect(runs[0].title).toBe("My Title");
  });

  test("inbound-only: source.kind === 'research' row → correct status", () => {
    const messages: CanvasChatMessage[] = [
      inboundFanout("msg-2", "res-2", "ready"),
    ];
    const runs = getResearchRunsFromMessages(messages);
    expect(runs).toHaveLength(1);
    expect(runs[0].researchId).toBe("res-2");
    expect(runs[0].status).toBe("ready");
    expect(runs[0].anchorMessageId).toBe("msg-2");
  });

  test("outbound + inbound pair: inbound wins status and anchor", () => {
    const messages: CanvasChatMessage[] = [
      outboundDispatch("msg-out", "res-3"),
      inboundFanout("msg-in", "res-3", "ready"),
    ];
    const runs = getResearchRunsFromMessages(messages);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("ready");
    expect(runs[0].anchorMessageId).toBe("msg-in");
  });

  test("inbound row before outbound: inbound is authoritative, outbound is no-op", () => {
    // If somehow inbound arrives first (shouldn't in practice, but defensive):
    const messages: CanvasChatMessage[] = [
      inboundFanout("msg-in", "res-4", "failed"),
      outboundDispatch("msg-out", "res-4"),
    ];
    const runs = getResearchRunsFromMessages(messages);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    // Anchor stays at the inbound row (first to set it)
    expect(runs[0].anchorMessageId).toBe("msg-in");
  });

  test("multiple dispatches: each researchId produces a distinct ResearchRun", () => {
    const messages: CanvasChatMessage[] = [
      outboundDispatch("msg-a", "res-a", { topic: "Topic A" }),
      outboundDispatch("msg-b", "res-b", { topic: "Topic B" }),
      inboundFanout("msg-c", "res-a", "ready", { topic: "Topic A" }),
    ];
    const runs = getResearchRunsFromMessages(messages);
    expect(runs).toHaveLength(2);
    const a = runs.find((r) => r.researchId === "res-a")!;
    const b = runs.find((r) => r.researchId === "res-b")!;
    expect(a.status).toBe("ready");
    expect(a.anchorMessageId).toBe("msg-c");
    expect(b.status).toBe("dispatched");
    expect(b.anchorMessageId).toBe("msg-b");
  });

  test("missing researchId on tool output → filtered out", () => {
    // output has no researchId
    const messages: CanvasChatMessage[] = [outboundDispatch("msg-x", undefined)];
    const runs = getResearchRunsFromMessages(messages);
    expect(runs).toHaveLength(0);
  });

  test("non-dispatch tool calls are ignored", () => {
    const msg: CanvasChatMessage = {
      id: "msg-y",
      role: "assistant",
      content: "",
      timestamp: new Date(),
      toolCalls: [
        {
          id: "tc-1",
          toolName: "web_search",
          input: { query: "hello" },
          status: "output-available",
          output: { results: [] },
        },
      ],
    };
    const runs = getResearchRunsFromMessages([msg]);
    expect(runs).toHaveLength(0);
  });

  test("initiativeId is preserved from inbound row", () => {
    const messages: CanvasChatMessage[] = [
      inboundFanout("msg-1", "res-1", "ready", { initiativeId: "init-42" }),
    ];
    const runs = getResearchRunsFromMessages(messages);
    expect(runs[0].initiativeId).toBe("init-42");
  });

  test("empty messages array returns empty array", () => {
    expect(getResearchRunsFromMessages([])).toEqual([]);
  });
});

// ── ResearchRunCard ───────────────────────────────────────────────────────────

describe("ResearchRunCard status pill", () => {
  const baseRun = {
    researchId: "res-1",
    slug: "my-topic",
    topic: "My Topic",
    title: "My Title",
    anchorMessageId: "msg-1",
  };

  test("dispatched status renders spinner and 'Researching…' pill", () => {
    render(
      <ResearchRunCard
        run={{ ...baseRun, status: "dispatched" }}
        githubLogin="my-org"
      />,
    );
    expect(screen.getByText(/Researching/)).toBeTruthy();
  });

  test("ready status renders 'Ready' pill", () => {
    render(
      <ResearchRunCard
        run={{ ...baseRun, status: "ready" }}
        githubLogin="my-org"
      />,
    );
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  test("failed status renders 'Failed' pill", () => {
    render(
      <ResearchRunCard
        run={{ ...baseRun, status: "failed" }}
        githubLogin="my-org"
      />,
    );
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  test("renders topic in collapsed header", () => {
    render(
      <ResearchRunCard
        run={{ ...baseRun, status: "dispatched" }}
        githubLogin="my-org"
      />,
    );
    expect(screen.getByText("My Topic")).toBeTruthy();
  });
});
