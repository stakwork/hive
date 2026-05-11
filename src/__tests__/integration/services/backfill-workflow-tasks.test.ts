import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { backfillWorkflowTasks } from "@/services/backfill-workflow-tasks";

describe("backfillWorkflowTasks", () => {
  let testUser: { id: string };
  let testWorkspace: { id: string };
  const createdTaskIds: string[] = [];

  beforeEach(async () => {
    testUser = await db.user.create({
      data: {
        email: `backfill-test-${Date.now()}@example.com`,
        name: "Backfill Test User",
      },
    });

    testWorkspace = await db.workspace.create({
      data: {
        name: "Backfill Test Workspace",
        slug: `backfill-test-${Date.now()}`,
        ownerId: testUser.id,
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });
  }, 15000);

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await db.workflowTask.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await db.artifact.deleteMany({
        where: { message: { taskId: { in: createdTaskIds } } },
      });
      await db.chatMessage.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await db.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
    await db.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.workspace.delete({ where: { id: testWorkspace.id } });
    await db.user.delete({ where: { id: testUser.id } });
  }, 15000);

  /** Helper: create a workflow_editor task with an optional WORKFLOW artifact */
  async function createWFETask(opts: {
    title: string;
    withArtifact: boolean;
    workflowId?: number;
    workflowName?: string;
    workflowRefId?: string;
    workflowVersionId?: string;
  }) {
    const task = await db.task.create({
      data: {
        title: opts.title,
        description: "Test WFE task",
        mode: "workflow_editor",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });
    createdTaskIds.push(task.id);

    if (opts.withArtifact) {
      const msg = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Initial workflow message",
          role: "ASSISTANT",
        },
      });

      await db.artifact.create({
        data: {
          messageId: msg.id,
          type: "WORKFLOW",
          content: {
            workflowId: opts.workflowId ?? 42,
            workflowName: opts.workflowName ?? "test-workflow",
            workflowRefId: opts.workflowRefId ?? "ref-001",
            workflowVersionId: opts.workflowVersionId ?? "v1",
          },
        },
      });
    }

    return task;
  }

  it("creates WorkflowTask rows for tasks with WORKFLOW artifacts, skips tasks without", async () => {
    const taskWithArtifact1 = await createWFETask({
      title: "WFE Task With Artifact 1",
      withArtifact: true,
      workflowId: 10,
      workflowName: "workflow-one",
      workflowRefId: "ref-one",
      workflowVersionId: "v1",
    });

    const taskWithArtifact2 = await createWFETask({
      title: "WFE Task With Artifact 2",
      withArtifact: true,
      workflowId: 20,
      workflowName: "workflow-two",
      workflowRefId: "ref-two",
      workflowVersionId: "v2",
    });

    await createWFETask({
      title: "WFE Task Without Artifact",
      withArtifact: false,
    });

    const result = await backfillWorkflowTasks(db as any);

    // At least the 2 tasks we seeded with artifacts must be created
    expect(result.created).toBeGreaterThanOrEqual(2);
    // At least the 1 task without an artifact must be skipped
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const wt1 = await db.workflowTask.findUnique({ where: { taskId: taskWithArtifact1.id } });
    expect(wt1).not.toBeNull();
    expect(wt1?.workflowId).toBe(10);
    expect(wt1?.workflowName).toBe("workflow-one");
    expect(wt1?.workflowRefId).toBe("ref-one");
    expect(wt1?.workflowVersionId).toBe("v1");

    const wt2 = await db.workflowTask.findUnique({ where: { taskId: taskWithArtifact2.id } });
    expect(wt2).not.toBeNull();
    expect(wt2?.workflowId).toBe(20);
    expect(wt2?.workflowName).toBe("workflow-two");
    expect(wt2?.workflowRefId).toBe("ref-two");
    expect(wt2?.workflowVersionId).toBe("v2");
  }, 20000);

  it("is idempotent — running backfill twice produces no duplicates and no errors", async () => {
    await createWFETask({
      title: "Idempotent WFE Task",
      withArtifact: true,
      workflowId: 99,
      workflowName: "idempotent-workflow",
      workflowRefId: "ref-idem",
    });

    const first = await backfillWorkflowTasks(db as any);
    expect(first.created).toBeGreaterThanOrEqual(1);

    // Second run — our task already has a WorkflowTask, so it's excluded from the query
    const second = await backfillWorkflowTasks(db as any);
    expect(second.created).toBe(0);

    // Only one WorkflowTask row exists for this task
    const rows = await db.workflowTask.findMany({
      where: { task: { workspaceId: testWorkspace.id, title: "Idempotent WFE Task" } },
    });
    expect(rows).toHaveLength(1);
  }, 20000);
});
