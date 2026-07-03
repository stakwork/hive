/**
 * Integration tests: DAILY_RECAP run targeting in processStakworkRunWebhook
 *
 * Verifies that:
 * - A webhook carrying `run_id` writes COMPLETED + result ONLY to the targeted run
 * - The other user's PENDING run in the same workspace is untouched (result=null, PENDING)
 * - Regression: no cross-user contamination when multiple DAILY_RECAP runs share a workspace
 * - Fallback: when no run_id is provided the workspace-scoped arm still works (single-user)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { processStakworkRunWebhook } from "@/services/stakwork-run";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";
import { generateUniqueId, generateUniqueSlug } from "@/__tests__/support/helpers";
import { resetDatabase } from "@/__tests__/support/utilities/database";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getWhiteboardChannelName: (id: string) => `whiteboard-${id}`,
  getFeatureChannelName: (id: string) => `feature-${id}`,
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
    STAKWORK_RUN_DECISION: "stakwork-run-decision",
    WHITEBOARD_CHAT_MESSAGE: "whiteboard-chat-message",
    FEATURE_UPDATED: "feature-updated",
    PROMPT_EVAL_RESULT: "prompt-eval-result",
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_field: string, value: unknown) => String(value)),
    })),
  },
}));

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: vi.fn(() => "HIVE_STAGING"),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createUser(opts: { activityRecapEnabled?: boolean } = {}) {
  return db.user.create({
    data: {
      id: generateUniqueId("user"),
      email: `user-${generateUniqueId()}@test.com`,
      name: "Test User",
      activityRecapEnabled: opts.activityRecapEnabled ?? false,
    },
  });
}

async function createWorkspace(ownerId: string) {
  return db.workspace.create({
    data: {
      name: `Test Workspace ${generateUniqueId()}`,
      slug: generateUniqueSlug("recap-ws"),
      ownerId,
    },
  });
}

async function createDailyRecapRun(
  userId: string,
  workspaceId: string,
  status: WorkflowStatus = WorkflowStatus.PENDING,
) {
  return db.stakworkRun.create({
    data: {
      type: StakworkRunType.DAILY_RECAP,
      userId,
      workspaceId,
      status,
      webhookUrl: `http://localhost/api/webhook/stakwork/response?type=DAILY_RECAP&workspace_id=${workspaceId}`,
      dataType: "string",
      autoAccept: false,
    },
  });
}

const RECAP_RESULT = { summary: "You had a productive day with 5 PRs reviewed." };

const baseWebhookData = {
  result: RECAP_RESULT,
  project_status: "completed" as const,
  project_id: undefined as number | undefined,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("processStakworkRunWebhook — DAILY_RECAP exact-run targeting", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("with run_id: writes COMPLETED+result only to the targeted run; the other user's run stays PENDING+null", async () => {
    // Two users share one workspace
    const userA = await createUser();
    const workspace = await createWorkspace(userA.id);

    const userB = await createUser();
    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: userB.id, role: "DEVELOPER" },
    });

    // Both have PENDING DAILY_RECAP runs in the same workspace
    const runA = await createDailyRecapRun(userA.id, workspace.id);
    const runB = await createDailyRecapRun(userB.id, workspace.id);

    // Webhook fires for user A's run only — run_id identifies it precisely
    await processStakworkRunWebhook(
      { ...baseWebhookData },
      {
        type: "DAILY_RECAP",
        workspace_id: workspace.id,
        run_id: runA.id,
      },
    );

    const afterA = await db.stakworkRun.findUnique({ where: { id: runA.id } });
    const afterB = await db.stakworkRun.findUnique({ where: { id: runB.id } });

    // Run A: COMPLETED with result
    expect(afterA?.status).toBe(WorkflowStatus.COMPLETED);
    expect(afterA?.result).not.toBeNull();

    // Run B: untouched — PENDING, no result
    expect(afterB?.status).toBe(WorkflowStatus.PENDING);
    expect(afterB?.result).toBeNull();
  });

  it("regression: no cross-user contamination — targeting user B's run leaves user A's run intact", async () => {
    const userA = await createUser();
    const workspace = await createWorkspace(userA.id);

    const userB = await createUser();
    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: userB.id, role: "DEVELOPER" },
    });

    const runA = await createDailyRecapRun(userA.id, workspace.id);
    const runB = await createDailyRecapRun(userB.id, workspace.id);

    // Webhook fires for user B's run
    await processStakworkRunWebhook(
      { ...baseWebhookData },
      {
        type: "DAILY_RECAP",
        workspace_id: workspace.id,
        run_id: runB.id,
      },
    );

    const afterA = await db.stakworkRun.findUnique({ where: { id: runA.id } });
    const afterB = await db.stakworkRun.findUnique({ where: { id: runB.id } });

    // Run B: COMPLETED with result
    expect(afterB?.status).toBe(WorkflowStatus.COMPLETED);
    expect(afterB?.result).not.toBeNull();

    // Run A: untouched — PENDING, no result
    expect(afterA?.status).toBe(WorkflowStatus.PENDING);
    expect(afterA?.result).toBeNull();
  });

  it("fallback (no run_id): workspace-scoped findFirst still works for single-user workspaces", async () => {
    const user = await createUser();
    const workspace = await createWorkspace(user.id);

    const run = await createDailyRecapRun(user.id, workspace.id);

    // Webhook without run_id (legacy callers / other run types)
    await processStakworkRunWebhook(
      { ...baseWebhookData },
      {
        type: "DAILY_RECAP",
        workspace_id: workspace.id,
        // run_id intentionally omitted
      },
    );

    const afterRun = await db.stakworkRun.findUnique({ where: { id: run.id } });

    expect(afterRun?.status).toBe(WorkflowStatus.COMPLETED);
    expect(afterRun?.result).not.toBeNull();
  });

  it("recap_unchanged: true — marks run COMPLETED but leaves result null", async () => {
    const user = await createUser();
    const workspace = await createWorkspace(user.id);

    const run = await createDailyRecapRun(user.id, workspace.id);

    await processStakworkRunWebhook(
      { result: null, project_status: "completed", recap_unchanged: true },
      { type: "DAILY_RECAP", workspace_id: workspace.id, run_id: run.id },
    );

    const afterRun = await db.stakworkRun.findUnique({ where: { id: run.id } });

    expect(afterRun?.status).toBe(WorkflowStatus.COMPLETED);
    expect(afterRun?.result).toBeNull();
  });

  it("recap_unchanged: true — cursor advances; GET /daily-recap still returns prior non-null result", async () => {
    const user = await createUser();
    const workspace = await createWorkspace(user.id);

    // 1. First run completes with real result — this is the "prior recap"
    const firstRun = await createDailyRecapRun(user.id, workspace.id);
    await processStakworkRunWebhook(
      { result: "Prior recap content", project_status: "completed" },
      { type: "DAILY_RECAP", workspace_id: workspace.id, run_id: firstRun.id },
    );

    const afterFirst = await db.stakworkRun.findUnique({ where: { id: firstRun.id } });
    expect(afterFirst?.status).toBe(WorkflowStatus.COMPLETED);
    expect(afterFirst?.result).toBe("Prior recap content");

    // 2. Second run comes back recap_unchanged: true — completes but no result written
    const secondRun = await createDailyRecapRun(user.id, workspace.id);
    await processStakworkRunWebhook(
      { result: null, project_status: "completed", recap_unchanged: true },
      { type: "DAILY_RECAP", workspace_id: workspace.id, run_id: secondRun.id },
    );

    const afterSecond = await db.stakworkRun.findUnique({ where: { id: secondRun.id } });
    expect(afterSecond?.status).toBe(WorkflowStatus.COMPLETED);
    expect(afterSecond?.result).toBeNull();

    // 3. The GET endpoint (result: { not: null } filter) still surfaces the first run's result
    const latestWithResult = await db.stakworkRun.findFirst({
      where: {
        userId: user.id,
        type: StakworkRunType.DAILY_RECAP,
        status: WorkflowStatus.COMPLETED,
        result: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { result: true, createdAt: true },
    });
    expect(latestWithResult?.result).toBe("Prior recap content");
  });

  it("recap_unchanged: true — cursor (createdAt) of second run is newer than first, advancing the since window", async () => {
    const user = await createUser();
    const workspace = await createWorkspace(user.id);

    // First run completes normally
    const firstRun = await createDailyRecapRun(user.id, workspace.id);
    await processStakworkRunWebhook(
      { result: "Initial recap", project_status: "completed" },
      { type: "DAILY_RECAP", workspace_id: workspace.id, run_id: firstRun.id },
    );

    // Slight delay ensures second run's updatedAt > first run's
    await new Promise((r) => setTimeout(r, 10));

    // Second run is recap_unchanged
    const secondRun = await createDailyRecapRun(user.id, workspace.id);
    await processStakworkRunWebhook(
      { result: null, project_status: "completed", recap_unchanged: true },
      { type: "DAILY_RECAP", workspace_id: workspace.id, run_id: secondRun.id },
    );

    // The COMPLETED cursor (latest by createdAt) should now be the second run
    const cursorRun = await db.stakworkRun.findFirst({
      where: { userId: user.id, type: StakworkRunType.DAILY_RECAP, status: WorkflowStatus.COMPLETED },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    expect(cursorRun?.id).toBe(secondRun.id);
  });

  it("three users in one workspace: each webhook with its own run_id completes only the correct run", async () => {
    const userA = await createUser();
    const workspace = await createWorkspace(userA.id);

    const userB = await createUser();
    const userC = await createUser();

    await db.workspaceMember.createMany({
      data: [
        { workspaceId: workspace.id, userId: userB.id, role: "DEVELOPER" },
        { workspaceId: workspace.id, userId: userC.id, role: "DEVELOPER" },
      ],
    });

    const runA = await createDailyRecapRun(userA.id, workspace.id);
    const runB = await createDailyRecapRun(userB.id, workspace.id);
    const runC = await createDailyRecapRun(userC.id, workspace.id);

    // Complete only runB
    await processStakworkRunWebhook(
      { ...baseWebhookData, result: { summary: "User B summary" } },
      { type: "DAILY_RECAP", workspace_id: workspace.id, run_id: runB.id },
    );

    const afterA = await db.stakworkRun.findUnique({ where: { id: runA.id } });
    const afterB = await db.stakworkRun.findUnique({ where: { id: runB.id } });
    const afterC = await db.stakworkRun.findUnique({ where: { id: runC.id } });

    expect(afterA?.status).toBe(WorkflowStatus.PENDING);
    expect(afterA?.result).toBeNull();

    expect(afterB?.status).toBe(WorkflowStatus.COMPLETED);
    expect(afterB?.result).not.toBeNull();

    expect(afterC?.status).toBe(WorkflowStatus.PENDING);
    expect(afterC?.result).toBeNull();
  });
});
