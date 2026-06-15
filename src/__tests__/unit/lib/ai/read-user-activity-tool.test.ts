/**
 * Unit tests for the `read_user_activity` tool's execute path inside
 * `buildInitiativeTools`.
 *
 * Verifies:
 * - The tool calls `getUserActivityFeed` with the correct params
 * - It returns `{ items }` on success
 * - It returns `{ error }` when `getUserActivityFeed` throws
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivityItem } from "@/services/roadmap/user-activity";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    initiative: { findFirst: vi.fn() },
    milestone: { findFirst: vi.fn() },
    workspace: { findFirst: vi.fn() },
    feature: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/services/roadmap", () => ({
  updateFeature: vi.fn(),
}));

vi.mock("@/lib/canvas", () => ({
  notifyFeatureReassignmentRefresh: vi.fn(),
  notifyFeatureAssignmentRefreshByOrg: vi.fn(),
  assignFeatureOnCanvas: vi.fn(),
  unassignFeatureOnCanvas: vi.fn(),
}));

vi.mock("@/services/orgs/nodeDetail", () => ({
  loadNodeDetail: vi.fn(),
}));

vi.mock("@/services/roadmap/feature-chat", () => ({
  sendFeatureChatMessage: vi.fn(),
}));

vi.mock("@/services/roadmap/user-activity", () => ({
  getUserActivityFeed: vi.fn(),
}));

import { db } from "@/lib/db";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";
import { getUserActivityFeed } from "@/services/roadmap/user-activity";

const mockedGetUserActivityFeed = vi.mocked(getUserActivityFeed);

const ORG_ID = "org-test-1";
const USER_ID = "user-test-1";

function getTools() {
  (db.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    canvasAutonomousTurns: false,
  });
  return buildInitiativeTools(ORG_ID, USER_ID, undefined);
}

/** Type-safe helper to call a tool's execute function. */
async function callExecute(
  toolSet: ReturnType<typeof buildInitiativeTools>,
  input: Record<string, unknown>,
) {
  const t = toolSet.read_user_activity;
  if (!t.execute) throw new Error("read_user_activity tool has no execute function");
  return t.execute(input as Parameters<NonNullable<typeof t.execute>>[0], {
    toolCallId: "tc-test",
    messages: [],
  });
}

const SAMPLE_ITEMS: ActivityItem[] = [
  {
    id: "task-1",
    kind: "task",
    category: "task",
    action: "created",
    title: "Fix bug",
    link: "/w/my-ws/task/task-1",
    workspaceName: "My Workspace",
    timestamp: "2024-06-10T10:00:00.000Z",
    completed: false,
  },
  {
    id: "feat-1",
    kind: "plan",
    category: "plan",
    action: "active",
    title: "New feature",
    link: "/w/my-ws/plan/feat-1",
    workspaceName: "My Workspace",
    timestamp: "2024-06-09T10:00:00.000Z",
    completed: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("read_user_activity tool — execute path", () => {
  it("calls getUserActivityFeed with userId from closure and returns { items }", async () => {
    mockedGetUserActivityFeed.mockResolvedValue(SAMPLE_ITEMS);

    const result = await callExecute(getTools(), {});

    expect(mockedGetUserActivityFeed).toHaveBeenCalledWith({
      userId: USER_ID,
      category: null,
      q: undefined,
      limit: undefined,
    });
    expect(result).toEqual({ items: SAMPLE_ITEMS });
  });

  it("passes category, q, and limit through to getUserActivityFeed", async () => {
    mockedGetUserActivityFeed.mockResolvedValue([SAMPLE_ITEMS[0]]);

    const result = await callExecute(getTools(), { category: "task", q: "bug", limit: 5 });

    expect(mockedGetUserActivityFeed).toHaveBeenCalledWith({
      userId: USER_ID,
      category: "task",
      q: "bug",
      limit: 5,
    });
    expect(result).toEqual({ items: [SAMPLE_ITEMS[0]] });
  });

  it("passes category=null when category is undefined", async () => {
    mockedGetUserActivityFeed.mockResolvedValue([]);

    await callExecute(getTools(), { limit: 10 });

    const callArgs = mockedGetUserActivityFeed.mock.calls[0][0];
    expect(callArgs.category).toBeNull();
  });

  it("returns { error } when getUserActivityFeed throws", async () => {
    mockedGetUserActivityFeed.mockRejectedValue(new Error("DB failure"));

    const result = await callExecute(getTools(), { category: "task", limit: 5 });

    expect(result).toEqual({ error: "Failed to load activity feed" });
  });

  it("uses userId bound in buildInitiativeTools closure — never from tool input", async () => {
    mockedGetUserActivityFeed.mockResolvedValue([]);

    await callExecute(getTools(), {});

    const callArgs = mockedGetUserActivityFeed.mock.calls[0][0];
    expect(callArgs.userId).toBe(USER_ID);
  });
});

describe("read_user_activity tool — presence in ToolSet", () => {
  it("is present in the ToolSet returned by buildInitiativeTools", () => {
    const tools = getTools();
    expect("read_user_activity" in tools).toBe(true);
  });

  it("has an execute function defined", () => {
    const tools = getTools();
    expect(typeof tools.read_user_activity.execute).toBe("function");
  });
});
