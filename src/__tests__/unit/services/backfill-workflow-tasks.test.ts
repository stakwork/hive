/**
 * Unit tests for backfillWorkflowTasks in src/services/backfill-workflow-tasks.ts
 * Covers null workflowId handling (tasks with "new" or absent workflowId).
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

// ─── Build a minimal mock Prisma client ───────────────────────────────────────

function makeMockClient() {
  return {
    task: {
      findMany: vi.fn(),
    },
    workflowTask: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

// ─── Subject ──────────────────────────────────────────────────────────────────

import { backfillWorkflowTasks } from "@/services/backfill-workflow-tasks";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("backfillWorkflowTasks", () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient();
    vi.clearAllMocks();
  });

  test("creates row with workflowId: null when artifact has workflowId: 'new'", async () => {
    const task = {
      id: "task-new",
      chatMessages: [
        {
          artifacts: [
            {
              content: {
                workflowId: "new",
                workflowName: "New Workflow",
                workflowRefId: null,
              },
              type: "WORKFLOW",
            },
          ],
        },
      ],
    };

    vi.mocked(client.task.findMany).mockResolvedValue([task] as any);

    const result = await backfillWorkflowTasks(client);

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(client.workflowTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ workflowId: null }),
      }),
    );
  });

  test("creates row with workflowId: null when artifact has no workflowId", async () => {
    const task = {
      id: "task-absent",
      chatMessages: [
        {
          artifacts: [
            {
              content: { workflowName: "Some Workflow" },
              type: "WORKFLOW",
            },
          ],
        },
      ],
    };

    vi.mocked(client.task.findMany).mockResolvedValue([task] as any);

    const result = await backfillWorkflowTasks(client);

    expect(result.created).toBe(1);
    expect(client.workflowTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ workflowId: null }),
      }),
    );
  });

  test("creates row with numeric workflowId when artifact has a valid number", async () => {
    const task = {
      id: "task-valid",
      chatMessages: [
        {
          artifacts: [
            {
              content: {
                workflowId: 42,
                workflowName: "My Workflow",
                workflowRefId: "ref-42",
              },
              type: "WORKFLOW",
            },
          ],
        },
      ],
    };

    vi.mocked(client.task.findMany).mockResolvedValue([task] as any);

    const result = await backfillWorkflowTasks(client);

    expect(result.created).toBe(1);
    expect(client.workflowTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ workflowId: 42 }),
      }),
    );
  });

  test("skips task with no WORKFLOW artifact", async () => {
    const task = {
      id: "task-no-artifact",
      chatMessages: [{ artifacts: [] }],
    };

    vi.mocked(client.task.findMany).mockResolvedValue([task] as any);

    const result = await backfillWorkflowTasks(client);

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(client.workflowTask.upsert).not.toHaveBeenCalled();
  });

  test("skips task with no chat messages", async () => {
    const task = {
      id: "task-no-messages",
      chatMessages: [],
    };

    vi.mocked(client.task.findMany).mockResolvedValue([task] as any);

    const result = await backfillWorkflowTasks(client);

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
