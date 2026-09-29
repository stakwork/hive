// @vitest-environment jsdom
/**
 * Unit tests for `getStrutChatsFromMessages` and `StrutChatCard`.
 */

import React from "react";
import { describe, test, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StrutChatCard, getStrutChatsFromMessages } from "@/app/org/[githubLogin]/_components/StrutChatCard";
import type { CanvasChatMessage } from "@/app/org/[githubLogin]/_state/canvasChatStore";

// ── Helpers ──────────────────────────────────────────────────────────────────

function dispatch(
  id: string,
  over: { title?: string; chatId?: string; output?: Record<string, unknown> | null } = {},
): CanvasChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: new Date(),
    toolCalls: [
      {
        id: `tc-${id}`,
        toolName: "dispatch_strut",
        input: {
          workspace: "acme",
          title: over.title ?? "Build clipper",
          prompt: "Build it",
          ...(over.chatId ? { chatId: over.chatId } : {}),
        },
        status: "output-available",
        ...(over.output === null ? {} : { output: over.output ?? { status: "dispatched", chatId: "chat-9" } }),
      },
    ],
  };
}

function reply(
  id: string,
  over: Partial<Extract<NonNullable<CanvasChatMessage["source"]>, { kind: "strut" }>> = {},
): CanvasChatMessage {
  return {
    id,
    role: "assistant",
    content: "**Strut · acme · chat `chat-9`** — Build clipper\n\nDone.",
    timestamp: new Date(),
    source: {
      kind: "strut",
      runId: "run-1",
      title: "Build clipper",
      workspaceSlug: "acme",
      chatId: "chat-9",
      turn: 0,
      event: "turn.end",
      status: "done",
      settled: true,
      parked: false,
      ...over,
    },
  };
}

const ACTIVITY = {
  workflows: [{ name: "youtube-clip", version: "v2", action: "created" }],
  runs: [
    { workflow: "youtube-clip", runId: "1789585940643", status: "error" },
    { workflow: "youtube-clip", runId: "1789586040109", status: "running" },
  ],
};

/** What `StrutView` hands the strut frame for a Hive link. */
const strutParams = (href: string | null) =>
  Object.fromEntries(new URLSearchParams(new URL(href ?? "", "https://hive.test").searchParams.get("strut") ?? ""));

// ── getStrutChatsFromMessages ────────────────────────────────────────────────

describe("getStrutChatsFromMessages", () => {
  test("a dispatch is a running chat, anchored on the dispatch", () => {
    expect(getStrutChatsFromMessages([dispatch("m1")])).toEqual([
      { chatId: "chat-9", title: "Build clipper", status: "running", workflows: [], runs: [], anchorMessageId: "m1" },
    ]);
  });

  test("a dispatch that has not returned, or was refused, is no card", () => {
    expect(getStrutChatsFromMessages([dispatch("m1", { output: null })])).toEqual([]);
    expect(getStrutChatsFromMessages([dispatch("m1", { output: { status: "error", error: "no swarm" } })])).toEqual([]);
  });

  test("the chat follows strut's replies: interim, then settled", () => {
    const interim = [dispatch("m1"), reply("m2", { settled: false, activity: ACTIVITY })];
    expect(getStrutChatsFromMessages(interim)).toMatchObject([
      { status: "running", anchorMessageId: "m2", workflows: ACTIVITY.workflows, runs: ACTIVITY.runs },
    ]);

    const done = [...interim, reply("m3", { turn: 1 })];
    expect(getStrutChatsFromMessages(done)).toMatchObject([{ status: "done", anchorMessageId: "m3" }]);
  });

  test("a reply strut could not be read for keeps the last activity", () => {
    const [chat] = getStrutChatsFromMessages([reply("m1", { settled: false, activity: ACTIVITY }), reply("m2")]);
    expect(chat.runs).toHaveLength(2);
    expect(chat.workflows).toHaveLength(1);
  });

  test("failed, paused, and a strut that will not report back", () => {
    expect(getStrutChatsFromMessages([reply("m1", { status: "error" })])[0].status).toBe("failed");
    expect(getStrutChatsFromMessages([reply("m1", { settled: false, parked: true })])[0].status).toBe("paused");
    expect(
      getStrutChatsFromMessages([
        dispatch("m1", { output: { status: "dispatched_without_callback", chatId: "chat-9" } }),
      ])[0].status,
    ).toBe("sent");
  });

  test("continuing a settled chat sets it running again, under the new dispatch", () => {
    const messages = [
      dispatch("m1"),
      reply("m2", { activity: ACTIVITY }),
      dispatch("m3", { title: "Add captions", chatId: "chat-9" }),
    ];
    expect(getStrutChatsFromMessages(messages)).toMatchObject([
      { chatId: "chat-9", title: "Add captions", status: "running", anchorMessageId: "m3", runs: ACTIVITY.runs },
    ]);
  });

  test("a busy chat is still running; a refused continue changes nothing", () => {
    const busy = dispatch("m2", { chatId: "chat-9", output: { status: "busy", chatId: "chat-9" } });
    expect(getStrutChatsFromMessages([reply("m1", { settled: false }), busy])[0].status).toBe("running");

    const refused = dispatch("m2", { chatId: "chat-9", output: { status: "error", error: "not found" } });
    expect(getStrutChatsFromMessages([reply("m1"), refused])).toMatchObject([
      { status: "done", anchorMessageId: "m1" },
    ]);
  });

  test("two chats are two cards", () => {
    const chats = getStrutChatsFromMessages([
      dispatch("m1"),
      dispatch("m2", { title: "Other", output: { status: "dispatched", chatId: "chat-10" } }),
      reply("m3"),
    ]);
    expect(chats.map((c) => [c.chatId, c.status, c.anchorMessageId])).toEqual([
      ["chat-9", "done", "m3"],
      ["chat-10", "running", "m2"],
    ]);
  });

  test("malformed stored activity is dropped, not rendered", () => {
    const [chat] = getStrutChatsFromMessages([
      reply("m1", { activity: { workflows: "nope", runs: [{ workflow: "w" }, { workflow: "w", runId: "1" }] } }),
    ]);
    expect(chat.workflows).toEqual([]);
    expect(chat.runs).toEqual([{ workflow: "w", runId: "1", status: "running" }]);
  });
});

// ── StrutChatCard ────────────────────────────────────────────────────────────

describe("StrutChatCard", () => {
  const [chat] = getStrutChatsFromMessages([dispatch("m1"), reply("m2", { settled: false, activity: ACTIVITY })]);

  test("says the chat is running and links to it in the org strut view", () => {
    render(<StrutChatCard chat={chat} githubLogin="acme-org" />);
    expect(screen.getByText("Build clipper")).toBeInTheDocument();
    expect(within(screen.getByTestId("strut-chat-card")).getAllByText("Running")[0]).toBeInTheDocument();

    const link = screen.getByTestId("strut-chat-link");
    expect(link.getAttribute("href")).toMatch(/^\/org\/acme-org\/strut\?strut=/);
    expect(strutParams(link.getAttribute("href"))).toEqual({ chat: "chat-9" });
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("each workflow and each run has its own link", () => {
    render(<StrutChatCard chat={chat} githubLogin="acme-org" />);

    const workflow = screen.getByTestId("strut-workflow-link");
    expect(workflow).toHaveTextContent("youtube-clip");
    expect(workflow).toHaveTextContent("v2");
    expect(workflow).toHaveTextContent("created");
    expect(strutParams(workflow.getAttribute("href"))).toEqual({ wf: "youtube-clip" });

    const runs = screen.getAllByTestId("strut-run-link");
    expect(runs.map((r) => strutParams(r.getAttribute("href")))).toEqual([
      { wf: "youtube-clip", run: "1789585940643" },
      { wf: "youtube-clip", run: "1789586040109" },
    ]);
    expect(runs[0]).toHaveTextContent("Failed");
    expect(runs[1]).toHaveTextContent("Running");
  });

  test("a finished chat with nothing built is just the header", () => {
    const [done] = getStrutChatsFromMessages([reply("m1")]);
    render(<StrutChatCard chat={done} githubLogin="acme-org" />);
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Workflows")).not.toBeInTheDocument();
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
  });
});
