/**
 * Unit tests for the `get_daily_recap` tool inside `buildInitiativeTools`.
 *
 * Verifies:
 * - Returns `{ recap: null }` when no completed DAILY_RECAP run exists
 * - Returns `{ recap, generatedAt }` when a completed run exists
 * - Returns `{ error }` when the DB query throws
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    initiative: { findFirst: vi.fn() },
    milestone: { findFirst: vi.fn() },
    workspace: { findFirst: vi.fn() },
    feature: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    stakworkRun: { findFirst: vi.fn() },
  },
}));

vi.mock("@/services/roadmap", () => ({ updateFeature: vi.fn() }));
vi.mock("@/lib/canvas", () => ({
  notifyFeatureReassignmentRefresh: vi.fn(),
  notifyFeatureAssignmentRefreshByOrg: vi.fn(),
  assignFeatureOnCanvas: vi.fn(),
  unassignFeatureOnCanvas: vi.fn(),
}));
vi.mock("@/services/orgs/nodeDetail", () => ({ loadNodeDetail: vi.fn() }));
vi.mock("@/services/roadmap/feature-chat", () => ({ sendFeatureChatMessage: vi.fn() }));
vi.mock("@/services/roadmap/user-activity", () => ({ getUserActivityFeed: vi.fn() }));

import { db } from "@/lib/db";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";

const ORG_ID = "org-1";
const USER_ID = "user-1";

function getTools() {
  (db.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    canvasAutonomousTurns: false,
  });
  return buildInitiativeTools(ORG_ID, USER_ID, undefined);
}

async function callGetDailyRecap(tools: ReturnType<typeof buildInitiativeTools>) {
  const t = tools.get_daily_recap;
  if (!t?.execute) throw new Error("get_daily_recap tool missing execute function");
  return t.execute({} as Parameters<NonNullable<typeof t.execute>>[0], {
    toolCallId: "tc-test",
    messages: [],
  });
}

describe("get_daily_recap tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { recap: null } when no completed DAILY_RECAP run exists", async () => {
    vi.mocked(db.stakworkRun.findFirst).mockResolvedValue(null);

    const tools = getTools();
    const result = await callGetDailyRecap(tools);

    expect(result).toEqual({ recap: null });

    expect(db.stakworkRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_ID,
          type: StakworkRunType.DAILY_RECAP,
          status: WorkflowStatus.COMPLETED,
        }),
      }),
    );
  });

  it("returns { recap: null } when run exists but result is null", async () => {
    vi.mocked(db.stakworkRun.findFirst).mockResolvedValue({
      result: null,
      createdAt: new Date(),
    } as any);

    const tools = getTools();
    const result = await callGetDailyRecap(tools);

    expect(result).toEqual({ recap: null });
  });

  it("returns { recap, generatedAt } when a completed run with a result exists", async () => {
    const createdAt = new Date("2026-01-15T09:00:00Z");
    vi.mocked(db.stakworkRun.findFirst).mockResolvedValue({
      result: "You merged 2 PRs and created 3 tasks yesterday — solid progress on the auth refactor.",
      createdAt,
    } as any);

    const tools = getTools();
    const result = await callGetDailyRecap(tools);

    expect(result).toEqual({
      recap: "You merged 2 PRs and created 3 tasks yesterday — solid progress on the auth refactor.",
      generatedAt: createdAt,
    });
  });

  it("returns { error } when the DB query throws", async () => {
    vi.mocked(db.stakworkRun.findFirst).mockRejectedValue(new Error("DB connection lost"));

    const tools = getTools();
    const result = await callGetDailyRecap(tools);

    expect(result).toEqual({ error: "Failed to load daily recap" });
  });

  it("queries by the userId from the closure — not a caller-supplied value", async () => {
    vi.mocked(db.stakworkRun.findFirst).mockResolvedValue(null);

    const tools = getTools();
    await callGetDailyRecap(tools);

    const call = vi.mocked(db.stakworkRun.findFirst).mock.calls[0][0] as {
      where: { userId: string };
    };
    expect(call.where.userId).toBe(USER_ID);
  });
});
