/**
 * Unit tests for the pure control panel helpers
 * (`src/services/orgs/control-panel-state.ts`).
 *
 * Covered:
 *   - Plan state precedence: done → halted → question → awaiting reply →
 *     review → running → plain status.
 *   - Running labels: planner only, agents only, both.
 *   - Search, newest-activity ordering, the stand-in row for the chat
 *     on stage, and the one-line preview.
 *   - Hierarchy + day groups: plans nest under their chat, orphan plans
 *     are left out, a chat floats up with its newest plan, day labels.
 */
import { describe, expect, test } from "vitest";
import type { ControlPanelItem } from "@/types/control-panel";
import {
  activeChatItem,
  buildControlPanelGroups,
  derivePlanState,
  matchesControlPanelQuery,
  overlayActiveChat,
  previewLine,
  sortControlPanelItems,
} from "@/services/orgs/control-panel-state";

const noMessage = null;
const assistantForm = { role: "ASSISTANT", hasForm: true };
const assistantText = { role: "ASSISTANT", hasForm: false };
const userText = { role: "USER", hasForm: false };

describe("derivePlanState", () => {
  test("completed and cancelled plans are done regardless of workflow", () => {
    expect(
      derivePlanState({
        status: "COMPLETED",
        workflowStatus: "IN_PROGRESS",
        tasks: [{ status: "TODO", workflowStatus: "IN_PROGRESS" }],
        lastMessage: assistantForm,
      }),
    ).toEqual({ state: "done", label: "Completed" });
    expect(
      derivePlanState({ status: "CANCELLED", workflowStatus: null, tasks: [], lastMessage: noMessage }).state,
    ).toBe("done");
  });

  test("halted wins over a pending question", () => {
    const result = derivePlanState({
      status: "IN_PROGRESS",
      workflowStatus: "HALTED",
      tasks: [],
      lastMessage: assistantForm,
    });
    expect(result.state).toBe("halted");
    expect(result.label).toBe("Halted");
  });

  test("a FAILED child task halts the plan and stops the planner counting as running", () => {
    const result = derivePlanState({
      status: "IN_PROGRESS",
      workflowStatus: "IN_PROGRESS",
      tasks: [
        { status: "TODO", workflowStatus: "FAILED" },
        { status: "TODO", workflowStatus: "IN_PROGRESS" },
      ],
      lastMessage: userText,
    });
    expect(result.state).toBe("halted");
  });

  test("an assistant FORM message is a question waiting", () => {
    expect(
      derivePlanState({
        status: "PLANNED",
        workflowStatus: "PENDING",
        tasks: [{ status: "TODO", workflowStatus: "PENDING" }],
        lastMessage: assistantForm,
      }).state,
    ).toBe("question");
  });

  test("assistant last message with no tasks is awaiting the user's reply", () => {
    const result = derivePlanState({
      status: "PLANNED",
      workflowStatus: "PENDING",
      tasks: [],
      lastMessage: assistantText,
    });
    expect(result.state).toBe("awaiting-reply");
    expect(result.label).toBe("Awaiting your reply");
  });

  test("completed workflow on an open plan is ready to review", () => {
    expect(
      derivePlanState({
        status: "IN_PROGRESS",
        workflowStatus: "COMPLETED",
        tasks: [{ status: "DONE", workflowStatus: "COMPLETED" }],
        lastMessage: userText,
      }).state,
    ).toBe("review");
  });

  test("running labels: planner, agents, both", () => {
    const planner = derivePlanState({
      status: "IN_PROGRESS",
      workflowStatus: "IN_PROGRESS",
      tasks: [],
      lastMessage: userText,
    });
    expect(planner).toEqual({ state: "running", label: "Planner working" });

    const agents = derivePlanState({
      status: "IN_PROGRESS",
      workflowStatus: "PENDING",
      tasks: [
        { status: "TODO", workflowStatus: "IN_PROGRESS" },
        { status: "TODO", workflowStatus: "PENDING", mode: "agent" },
        { status: "TODO", workflowStatus: "PENDING", mode: "live" },
      ],
      lastMessage: userText,
    });
    expect(agents).toEqual({ state: "running", label: "2 agents running" });

    const both = derivePlanState({
      status: "IN_PROGRESS",
      workflowStatus: "IN_PROGRESS",
      tasks: [{ status: "TODO", workflowStatus: "IN_PROGRESS" }],
      lastMessage: userText,
    });
    expect(both.label).toBe("Planner working · 1 agent running");
  });

  test("a never-started plan shows its plain status", () => {
    expect(
      derivePlanState({ status: "BACKLOG", workflowStatus: "PENDING", tasks: [], lastMessage: noMessage }),
    ).toEqual({ state: "none", label: "Backlog" });
  });
});

function makeItem(overrides: Partial<ControlPanelItem>): ControlPanelItem {
  const id = overrides.id ?? "x";
  const kind = overrides.kind ?? "plan";
  return {
    key: `${kind}:${id}`,
    kind,
    id,
    title: "x",
    workspaceSlug: "ws",
    workspaceId: "ws-id",
    workspaceName: "WS",
    lastActivityAt: "2026-09-04T10:00:00.000Z",
    sinceYou: "",
    state: "none",
    unread: false,
    ...overrides,
  };
}

describe("search, ordering and the chat on stage", () => {
  const fresh = {
    localId: "local-1",
    serverId: null,
    lastMessageAt: null,
    lastReply: null,
    hasMessages: false,
    isStreaming: false,
  };
  const startedAt = "2026-09-04T09:00:00.000Z";

  test("activeChatItem stands in for a chat the server has not listed yet", () => {
    const empty = activeChatItem(fresh, startedAt, "New chat");
    expect(empty).toMatchObject({
      key: "chat:local-1",
      title: "New chat",
      lastActivityAt: startedAt,
      sinceYou: "Empty chat",
      state: "none",
    });

    const replying = activeChatItem(
      { ...fresh, serverId: "srv-1", lastMessageAt: "2026-09-04T09:05:00.000Z", hasMessages: true, isStreaming: true },
      startedAt,
      "Kickoff",
    );
    expect(replying).toMatchObject({
      key: "chat:srv-1",
      lastActivityAt: "2026-09-04T09:05:00.000Z",
      sinceYou: "Jamie is replying",
      state: "running",
    });

    const answered = activeChatItem(
      { ...fresh, hasMessages: true, lastReply: "Done.\n\nAnything else?" },
      startedAt,
      "Kickoff",
    );
    expect(answered.sinceYou).toBe("Done. Anything else?");
  });

  test("overlayActiveChat brings the server's row up to what the store knows", () => {
    const server = makeItem({
      kind: "chat",
      id: "srv-1",
      lastActivityAt: "2026-09-04T09:00:00.000Z",
      sinceYou: "Planner posted an update",
      state: "question",
      unread: true,
    });
    // Nothing newer in the store: the server's row, read.
    expect(
      overlayActiveChat(server, {
        ...fresh,
        serverId: "srv-1",
        lastMessageAt: "2026-09-04T08:00:00.000Z",
        hasMessages: true,
      }),
    ).toMatchObject({
      lastActivityAt: "2026-09-04T09:00:00.000Z",
      sinceYou: "Planner posted an update",
      state: "question",
      unread: false,
    });
    // A message the fetch missed: the store's time and line win.
    expect(
      overlayActiveChat(server, {
        ...fresh,
        serverId: "srv-1",
        lastMessageAt: "2026-09-04T09:30:00.000Z",
        hasMessages: true,
      }),
    ).toMatchObject({ lastActivityAt: "2026-09-04T09:30:00.000Z", sinceYou: "No reply yet", state: "question" });
    // Streaming: working, whatever the server says.
    expect(
      overlayActiveChat(server, { ...fresh, serverId: "srv-1", hasMessages: true, isStreaming: true }),
    ).toMatchObject({ state: "running", sinceYou: "Jamie is replying" });
  });

  test("previewLine collapses whitespace and cuts long text with an ellipsis", () => {
    expect(previewLine("  a \n b  ")).toBe("a b");
    const long = previewLine("x".repeat(120));
    expect(long).toHaveLength(90);
    expect(long.endsWith("…")).toBe(true);
  });

  test("search matches title, workspace and since-you, case-insensitively; empty query matches all", () => {
    const item = makeItem({ title: "Payout retries", workspaceName: "Hive", sinceYou: "Planner working" });
    expect(matchesControlPanelQuery(item, "PAYOUT")).toBe(true);
    expect(matchesControlPanelQuery(item, "hive")).toBe(true);
    expect(matchesControlPanelQuery(item, "planner")).toBe(true);
    expect(matchesControlPanelQuery(item, "onboarding")).toBe(false);
    expect(matchesControlPanelQuery(item, "   ")).toBe(true);
  });

  test("sortControlPanelItems orders by newest activity first, without mutating", () => {
    const older = makeItem({ id: "a", lastActivityAt: "2026-09-01T00:00:00.000Z" });
    const newer = makeItem({ id: "b", lastActivityAt: "2026-09-03T00:00:00.000Z" });
    const input = [older, newer];
    const sorted = sortControlPanelItems(input);
    expect(sorted.map((i) => i.id)).toEqual(["b", "a"]);
    expect(input.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("buildControlPanelGroups", () => {
  // Fixed "now" at local noon so day boundaries are unambiguous.
  const now = new Date(2026, 8, 4, 12, 0, 0);
  const at = (daysAgo: number, hour = 9) => {
    const d = new Date(now);
    d.setDate(now.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  const chat = makeItem({ kind: "chat", id: "c1", title: "Kickoff", lastActivityAt: at(1) });
  const older = makeItem({ kind: "chat", id: "c2", title: "Older", lastActivityAt: at(2, 10) });
  const spawned = makeItem({ kind: "plan", id: "p1", title: "Spawned", parentChatId: "c1", lastActivityAt: at(0) });
  const orphan = makeItem({ kind: "plan", id: "p2", title: "Orphan", parentChatId: "missing", lastActivityAt: at(2) });
  const standalone = makeItem({ kind: "plan", id: "p3", title: "Standalone", lastActivityAt: at(1, 8) });

  test("chats are the rows, plans nest under their chat, the chat floats up to its newest plan, everything else is left out", () => {
    const groups = buildControlPanelGroups([chat, older, spawned, orphan, standalone], () => true, now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "September 2"]);
    // The chat's own activity was yesterday but its plan moved today, so it leads the Today group.
    expect(groups[0].rows.map((r) => [r.item.id, r.depth])).toEqual([
      ["c1", 0],
      ["p1", 1],
    ]);
    expect(groups[0].rows[0].childCount).toBe(1);
    expect(groups[0].rows[0].latestAt).toBe(at(0));
    expect(groups[0].rows[1].parentKey).toBe("chat:c1");
    expect(groups[1].rows.map((r) => r.item.id)).toEqual(["c2"]);
    const ids = groups.flatMap((g) => g.rows).map((r) => r.item.id);
    expect(ids).not.toContain("p2");
    expect(ids).not.toContain("p3");
  });

  test("a chat stays when only a nested plan matches the filter, and only matching plans render under it", () => {
    const running = makeItem({
      kind: "plan",
      id: "p4",
      parentChatId: "c1",
      state: "running",
      lastActivityAt: at(1, 10),
    });
    const groups = buildControlPanelGroups([chat, spawned, running], (item) => item.state === "running", now);
    expect(groups.flatMap((g) => g.rows).map((r) => r.item.id)).toEqual(["c1", "p4"]);
  });

  test("a chat that matches nothing and has no matching plans is dropped", () => {
    const groups = buildControlPanelGroups([chat, spawned], () => false, now);
    expect(groups).toEqual([]);
  });

  test("dates from another year carry the year", () => {
    const old = makeItem({ kind: "chat", id: "c9", lastActivityAt: new Date(2025, 11, 20, 9).toISOString() });
    const groups = buildControlPanelGroups([old], () => true, now);
    expect(groups[0].label).toBe("December 20, 2025");
  });
});
