/**
 * Unit tests for the pure chat list helpers
 * (`src/services/orgs/control-panel-state.ts`).
 *
 * Covered:
 *   - A chat's jobs from its job-turn runs: titled by the launch, working
 *     while a turn is pending, newest activity first.
 *   - A chat's pull requests from its messages: one per PR at its newest
 *     card, credited to the job whose row carried it, non-PR and
 *     non-inline refs left out.
 *   - Search over chat, job and PR titles; newest-activity day groups.
 *   - The chat on stage: the stand-in row, the overlay, Active vs Archive.
 *   - Optimistic archive and restore.
 */
import { describe, expect, test } from "vitest";
import type { ControlPanelItem } from "@/types/control-panel";
import {
  activeChatItem,
  buildControlPanelGroups,
  chatJobs,
  chatPullRequests,
  matchesControlPanelQuery,
  moveChatToActive,
  moveChatToArchive,
  overlayActiveChat,
  resolveControlPanelLists,
  activeChatTitle,
  type ActiveChatSnapshot,
} from "@/services/orgs/control-panel-state";

function chat(id: string, lastActivityAt: string, overrides: Partial<ControlPanelItem> = {}): ControlPanelItem {
  return { id, title: `Chat ${id}`, lastActivityAt, working: false, jobs: [], pullRequests: [], ...overrides };
}

function snapshot(overrides: Partial<ActiveChatSnapshot> = {}): ActiveChatSnapshot {
  return {
    localId: "local-1",
    serverId: null,
    lastMessageAt: null,
    hasMessages: false,
    isStreaming: false,
    title: null,
    ...overrides,
  };
}

describe("chatJobs", () => {
  const run = (jobId: string, status: string, createdAt: string, settledAt: string | null = null) => ({
    jobId,
    status,
    createdAt: new Date(createdAt),
    settledAt: settledAt ? new Date(settledAt) : null,
  });
  const titles = new Map([
    ["j1", "Backfill"],
    ["j2", "Docs"],
  ]);

  test("one entry per job, titled from its launch, working while a turn is pending", () => {
    const jobs = chatJobs(
      [
        run("j1", "SUCCESS", "2026-03-01T00:00:00Z", "2026-03-01T00:05:00Z"),
        run("j1", "PENDING", "2026-03-02T00:00:00Z"),
        run("j2", "SUCCESS", "2026-03-01T12:00:00Z", "2026-03-01T12:10:00Z"),
      ],
      titles,
    );
    expect(jobs).toEqual([
      { id: "j1", title: "Backfill", working: true, lastActivityAt: "2026-03-02T00:00:00.000Z" },
      { id: "j2", title: "Docs", working: false, lastActivityAt: "2026-03-01T12:10:00.000Z" },
    ]);
  });

  test("a job with no title reads as Job", () => {
    const [job] = chatJobs([run("j3", "SUCCESS", "2026-03-01T00:00:00Z")], titles);
    expect(job.title).toBe("Job");
  });
});

describe("chatPullRequests", () => {
  const prRef = (state: string, number = 7) => ({
    id: `pr-${number}`,
    kind: "pull_request",
    title: `PR ${number}`,
    source: {
      type: "inline",
      content: { url: `https://github.com/acme/app/pull/${number}`, repo: "acme/app", number, state },
    },
  });

  test("each PR at its newest card, newest reported first, credited to its job", () => {
    const prs = chatPullRequests([
      { source: { kind: "job", jobId: "j1" }, artifacts: [prRef("open", 7)] },
      { artifacts: [prRef("open", 8)] },
      { source: { kind: "job", jobId: "j1" }, artifacts: [prRef("merged", 7)] },
    ]);
    expect(prs.map((p) => [p.number, p.state, p.jobId])).toEqual([
      [7, "merged", "j1"],
      [8, "open", undefined],
    ]);
    expect(prs[0].identity).toBe("pull_request:acme/app#7");
  });

  test("leaves out other kinds, graph-sourced refs and malformed content", () => {
    const prs = chatPullRequests([
      {
        artifacts: [
          { id: "doc", kind: "markdown", title: "Plan", source: { type: "inline", content: { text: "# Plan" } } },
          { id: "pr-g", kind: "pull_request", title: "Remote", source: { type: "graph", swarmId: "s", key: "/k" } },
          { id: "pr-bad", kind: "pull_request", title: "Bad", source: { type: "inline", content: { url: 3 } } },
        ],
      },
      { artifacts: "not an array" },
    ]);
    expect(prs).toEqual([]);
  });
});

describe("matchesControlPanelQuery", () => {
  const item = chat("a", "2026-03-01T00:00:00Z", {
    title: "Org default workspace",
    jobs: [{ id: "j", title: "Backfill script", working: false, lastActivityAt: "2026-03-01T00:00:00Z" }],
    pullRequests: [{ identity: "p", title: "Add migration", url: "u", repo: "acme/app", number: 1, state: "open" }],
  });

  test("matches the chat, its jobs and its PRs, case-insensitively", () => {
    expect(matchesControlPanelQuery(item, "DEFAULT")).toBe(true);
    expect(matchesControlPanelQuery(item, "backfill")).toBe(true);
    expect(matchesControlPanelQuery(item, "migration")).toBe(true);
    expect(matchesControlPanelQuery(item, "nothing")).toBe(false);
    expect(matchesControlPanelQuery(item, "  ")).toBe(true);
  });
});

describe("buildControlPanelGroups", () => {
  test("groups by local day of newest activity, newest first", () => {
    const now = new Date(2026, 9, 15, 12);
    const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();
    const groups = buildControlPanelGroups(
      [chat("old", at(13, 9)), chat("today", at(15, 10)), chat("yesterday", at(14, 9)), chat("today2", at(15, 11))],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Today", ["today2", "today"]],
      ["Yesterday", ["yesterday"]],
      [new Date(2026, 9, 13).toLocaleDateString(undefined, { month: "short", day: "numeric" }), ["old"]],
    ]);
  });
});

describe("the chat on stage", () => {
  test("a fresh chat stands in until the server lists it", () => {
    const item = activeChatItem(
      snapshot({ hasMessages: true, isStreaming: true, lastMessageAt: "2026-03-02T00:00:00Z" }),
      "2026-03-01T00:00:00Z",
      "New thing",
    );
    expect(item).toEqual({
      id: "local-1",
      title: "New thing",
      lastActivityAt: "2026-03-02T00:00:00Z",
      working: true,
      jobs: [],
      pullRequests: [],
    });
  });

  test("the overlay takes a newer store message, the store title and streaming", () => {
    const server = chat("s1", "2026-03-01T00:00:00Z", { title: "Server title" });
    const overlaid = overlayActiveChat(
      server,
      snapshot({ serverId: "s1", lastMessageAt: "2026-03-02T00:00:00Z", isStreaming: true, title: "Store title" }),
    );
    expect(overlaid).toMatchObject({ lastActivityAt: "2026-03-02T00:00:00Z", working: true, title: "Store title" });
    // A server row that is already working stays working when the store is idle.
    expect(overlayActiveChat({ ...server, working: true }, snapshot({ serverId: "s1" })).working).toBe(true);
  });

  test("an unlisted chat is titled by the store, else its first message", () => {
    expect(activeChatTitle(snapshot({ title: "Titled" }), [])).toBe("Titled");
    expect(activeChatTitle(snapshot(), undefined)).toBe("New chat");
  });

  test("Active, Archive or prepended — and an empty new chat waits for its first message", () => {
    const items = [chat("a", "2026-03-01T00:00:00Z")];
    const archived = [chat("z", "2026-01-01T00:00:00Z", { archivedAt: "2026-02-01T00:00:00Z" })];
    const opts = { startedAt: "2026-03-05T00:00:00Z", titleForNew: "New" };

    const listed = resolveControlPanelLists(items, archived, snapshot({ serverId: "a", isStreaming: true }), opts);
    expect(listed.displayItems[0].working).toBe(true);

    const inArchive = resolveControlPanelLists(items, archived, snapshot({ serverId: "z", hasMessages: true }), opts);
    expect(inArchive.displayItems.map((i) => i.id)).toEqual(["a"]);

    const empty = resolveControlPanelLists(items, archived, snapshot(), opts);
    expect(empty.displayItems.map((i) => i.id)).toEqual(["a"]);

    const fresh = resolveControlPanelLists(items, archived, snapshot({ hasMessages: true }), opts);
    expect(fresh.displayItems.map((i) => i.id)).toEqual(["local-1", "a"]);
  });
});

describe("archive and restore", () => {
  test("archive moves the chat to the top of Archive, stamped", () => {
    const moved = moveChatToArchive(
      [chat("a", "2026-03-01T00:00:00Z"), chat("b", "2026-03-02T00:00:00Z")],
      [chat("z", "2026-01-01T00:00:00Z", { archivedAt: "2026-02-01T00:00:00Z" })],
      "a",
      "2026-03-10T00:00:00Z",
    );
    expect(moved.items.map((i) => i.id)).toEqual(["b"]);
    expect(moved.archivedItems.map((i) => [i.id, i.archivedAt])).toEqual([
      ["a", "2026-03-10T00:00:00Z"],
      ["z", "2026-02-01T00:00:00Z"],
    ]);
  });

  test("restore moves it back to the top of Active, unstamped; an unknown id changes nothing", () => {
    const items = [chat("b", "2026-03-02T00:00:00Z")];
    const archived = [chat("a", "2026-03-01T00:00:00Z", { archivedAt: "2026-03-10T00:00:00Z" })];
    const moved = moveChatToActive(items, archived, "a");
    expect(moved.items.map((i) => [i.id, i.archivedAt])).toEqual([
      ["a", null],
      ["b", undefined],
    ]);
    expect(moved.archivedItems).toEqual([]);
    expect(moveChatToActive(items, archived, "nope")).toEqual({ items, archivedItems: archived });
  });
});
