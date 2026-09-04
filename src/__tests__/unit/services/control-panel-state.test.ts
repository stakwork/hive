/**
 * Unit tests for the pure control panel helpers
 * (`src/services/orgs/control-panel-state.ts`).
 *
 * Covered:
 *   - Plan state precedence: done → halted → question (only if not
 *     running) → awaiting-reply (only if not running) → review →
 *     running → plain status.
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
  buildArchivedRows,
  buildControlPanelGroups,
  derivePlanState,
  matchesControlPanelQuery,
  moveChatToActive,
  moveChatToArchive,
  overlayActiveChat,
  unlistedOnStageChatTitle,
  previewLine,
  resolveControlPanelLists,
  sortControlPanelItems,
  visibleControlPanelItems,
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

  test("review still beats a live child task on a completed workflow", () => {
    expect(
      derivePlanState({
        status: "IN_PROGRESS",
        workflowStatus: "COMPLETED",
        tasks: [{ status: "TODO", workflowStatus: "IN_PROGRESS" }],
        lastMessage: userText,
      }).state,
    ).toBe("review");
  });

  test("IN_PROGRESS with an assistant last message is running, not awaiting-reply", () => {
    const result = derivePlanState({
      status: "IN_PROGRESS",
      workflowStatus: "IN_PROGRESS",
      tasks: [],
      lastMessage: assistantText,
    });
    expect(result).toEqual({ state: "running", label: "Planner working" });
  });

  test("IN_PROGRESS with a leftover assistant FORM is running, not a question", () => {
    const result = derivePlanState({
      status: "IN_PROGRESS",
      workflowStatus: "IN_PROGRESS",
      tasks: [],
      lastMessage: assistantForm,
    });
    expect(result.state).toBe("running");
    expect(result.label).toBe("Planner working");
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
    title: null,
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
    // Store title wins so the live list row updates without a refetch.
    expect(
      overlayActiveChat(server, {
        ...fresh,
        serverId: "srv-1",
        hasMessages: true,
        title: "Auth token refresh",
      }).title,
    ).toBe("Auth token refresh");
  });

  test("unlisted on-stage row prefers store title over generateTitle", () => {
    const messages = [{ role: "user", content: "How does the auth middleware work when tokens expire?" }];
    expect(
      unlistedOnStageChatTitle(
        { ...fresh, hasMessages: true, title: "Auth token refresh" },
        messages,
      ),
    ).toBe("Auth token refresh");
    expect(unlistedOnStageChatTitle({ ...fresh, hasMessages: true, title: null }, messages)).toBe(
      "How does the auth middleware work when tokens expire?",
    );
    expect(unlistedOnStageChatTitle(fresh, [])).toBe("New chat");
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

describe("archive move and on-stage gating", () => {
  const startedAt = "2026-09-04T09:00:00.000Z";
  const archivedAt = "2026-09-04T12:00:00.000Z";
  const chat = makeItem({ kind: "chat", id: "c1", title: "Kickoff", lastActivityAt: startedAt });
  const plan = makeItem({
    kind: "plan",
    id: "p1",
    title: "Spawned",
    parentChatId: "c1",
    lastActivityAt: "2026-09-04T10:00:00.000Z",
  });
  const other = makeItem({ kind: "chat", id: "c2", title: "Other", lastActivityAt: startedAt });
  const snapshot = {
    localId: "local-1",
    serverId: "c1",
    lastMessageAt: "2026-09-04T11:00:00.000Z",
    lastReply: "Done.",
    hasMessages: true,
    isStreaming: false,
    title: null,
  };

  test("moveChatToArchive takes nested plans with the chat and inserts them at the top of Archive", () => {
    const moved = moveChatToArchive([chat, plan, other], [], "c1", archivedAt);
    expect(moved.items.map((i) => i.id)).toEqual(["c2"]);
    expect(moved.archivedItems.map((i) => i.id)).toEqual(["c1", "p1"]);
    expect(moved.archivedItems[0].archivedAt).toBe(archivedAt);
    expect(moved.items.some((i) => i.id === "p1")).toBe(false);
  });

  test("moveChatToActive restores the chat and its plans to the top of Active", () => {
    const archived = moveChatToArchive([chat, plan, other], [], "c1", archivedAt);
    const restored = moveChatToActive(archived.items, archived.archivedItems, "c1");
    expect(restored.items.map((i) => i.id)).toEqual(["c1", "p1", "c2"]);
    expect(restored.archivedItems).toEqual([]);
    expect(restored.items[0].archivedAt).toBeNull();
  });

  test("an archived on-stage chat is not injected into active displayItems; nested plans stay in Archive", () => {
    const archived = moveChatToArchive([chat, plan, other], [], "c1", archivedAt);
    const resolved = resolveControlPanelLists(archived.items, archived.archivedItems, snapshot, {
      chatOnStage: true,
      startedAt,
      titleForNew: "Kickoff",
    });
    expect(resolved.displayItems.map((i) => i.id)).toEqual(["c2"]);
    expect(resolved.displayArchivedItems.map((i) => i.id)).toEqual(["c1", "p1"]);
    expect(resolved.displayArchivedItems[0]).toMatchObject({
      id: "c1",
      unread: false,
      lastActivityAt: snapshot.lastMessageAt,
    });
    const groups = buildControlPanelGroups(resolved.displayItems);
    expect(groups.flatMap((g) => g.rows).map((r) => r.item.id)).toEqual(["c2"]);
  });

  test("a brand-new on-stage chat not in either list is prepended into Active", () => {
    const fresh = {
      localId: "local-new",
      serverId: null,
      lastMessageAt: null,
      lastReply: null,
      hasMessages: false,
      isStreaming: false,
      title: null,
    };
    const resolved = resolveControlPanelLists([other], [], fresh, {
      chatOnStage: true,
      startedAt,
      titleForNew: "New chat",
    });
    expect(resolved.displayItems[0]).toMatchObject({ key: "chat:local-new", title: "New chat" });
    expect(resolved.displayItems.map((i) => i.id)).toEqual(["local-new", "c2"]);
    expect(resolved.displayArchivedItems).toEqual([]);
  });

  test("buildArchivedRows is a flat archivedAt-desc list with plans nested under their parent, not day-grouped", () => {
    const older = makeItem({
      kind: "chat",
      id: "c-old",
      title: "Older",
      archivedAt: "2026-09-01T00:00:00.000Z",
      lastActivityAt: "2026-09-04T18:00:00.000Z",
    });
    const newer = makeItem({
      kind: "chat",
      id: "c-new",
      title: "Newer",
      archivedAt: "2026-09-03T00:00:00.000Z",
      lastActivityAt: "2026-09-02T00:00:00.000Z",
    });
    const nested = makeItem({
      kind: "plan",
      id: "p-old",
      parentChatId: "c-old",
      lastActivityAt: "2026-09-04T19:00:00.000Z",
    });
    const rows = buildArchivedRows([older, nested, newer]);
    expect(rows.map((r) => [r.item.id, r.depth])).toEqual([
      ["c-new", 0],
      ["c-old", 0],
      ["p-old", 1],
    ]);
    expect(rows[1].childCount).toBe(1);
    expect(rows[2].parentKey).toBe("chat:c-old");
  });

  test("visibleControlPanelItems appends Archive rows only when the section is expanded", () => {
    const groups = buildControlPanelGroups([other]);
    const rows = buildArchivedRows([{ ...chat, archivedAt }, plan]);
    const collapsed = visibleControlPanelItems(groups, rows, new Set(), false);
    expect(collapsed.map((i) => i.id)).toEqual(["c2"]);
    const expanded = visibleControlPanelItems(groups, rows, new Set(), true);
    expect(expanded.map((i) => i.id)).toEqual(["c2", "c1"]);
    const withPlans = visibleControlPanelItems(groups, rows, new Set(["chat:c1"]), true);
    expect(withPlans.map((i) => i.id)).toEqual(["c2", "c1", "p1"]);
  });
});
