import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import type { User, Workspace, WorkspaceMember, Task } from "@prisma/client";

describe("Workspace Switching - Data Isolation Integration Tests", () => {
  let testUser: User;
  let workspace1: Workspace;
  let workspace2: Workspace;
  let workspace1Tasks: Task[];
  let workspace2Tasks: Task[];

  beforeEach(async () => {
    // Create test user
    testUser = await db.user.create({
      data: {
        email: "test-workspace-switching@example.com",
        name: "Test User",
      },
    });

    // Create workspace 1 with specific tasks
    workspace1 = await db.workspace.create({
      data: {
        name: "Workspace One",
        slug: "workspace-one",
        ownerId: testUser.id,
      },
    });

    await db.workspaceMember.create({
      data: {
        userId: testUser.id,
        workspaceId: workspace1.id,
        role: "OWNER",
      },
    });

    workspace1Tasks = await Promise.all([
      db.task.create({
        data: {
          title: "Workspace 1 - Task A",
          description: "Task specific to workspace 1",
          workspaceId: workspace1.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "TODO",
        },
      }),
      db.task.create({
        data: {
          title: "Workspace 1 - Task B",
          description: "Another task for workspace 1",
          workspaceId: workspace1.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "IN_PROGRESS",
        },
      }),
    ]);

    // Create workspace 2 with different tasks
    workspace2 = await db.workspace.create({
      data: {
        name: "Workspace Two",
        slug: "workspace-two",
        ownerId: testUser.id,
      },
    });

    await db.workspaceMember.create({
      data: {
        userId: testUser.id,
        workspaceId: workspace2.id,
        role: "OWNER",
      },
    });

    workspace2Tasks = await Promise.all([
      db.task.create({
        data: {
          title: "Workspace 2 - Task X",
          description: "Task specific to workspace 2",
          workspaceId: workspace2.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "TODO",
        },
      }),
      db.task.create({
        data: {
          title: "Workspace 2 - Task Y",
          description: "Another task for workspace 2",
          workspaceId: workspace2.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "DONE",
        },
      }),
    ]);
  });

  afterEach(async () => {
    // Cleanup in reverse order of dependencies
    const workspaceIds = [workspace1?.id, workspace2?.id].filter(Boolean);
    
    if (workspaceIds.length > 0) {
      await db.task.deleteMany({
        where: {
          workspaceId: {
            in: workspaceIds,
          },
        },
      });

      await db.workspaceMember.deleteMany({
        where: {
          workspaceId: {
            in: workspaceIds,
          },
        },
      });

      await db.workspace.deleteMany({
        where: {
          id: {
            in: workspaceIds,
          },
        },
      });
    }

    if (testUser?.id) {
      await db.user.deleteMany({
        where: {
          id: testUser.id,
        },
      });
    }
  });

  it("should load correct workspace data when fetching workspace 1", async () => {
    // Fetch workspace 1
    const fetchedWorkspace = await db.workspace.findUnique({
      where: { slug: workspace1.slug },
      include: {
        members: true,
        tasks: true,
      },
    });

    expect(fetchedWorkspace).toBeDefined();
    expect(fetchedWorkspace?.id).toBe(workspace1.id);
    expect(fetchedWorkspace?.name).toBe("Workspace One");
    expect(fetchedWorkspace?.slug).toBe("workspace-one");
    expect(fetchedWorkspace?.tasks).toHaveLength(2);
    
    // Verify tasks belong to workspace 1
    const taskTitles = fetchedWorkspace?.tasks.map(t => t.title).sort();
    expect(taskTitles).toEqual([
      "Workspace 1 - Task A",
      "Workspace 1 - Task B",
    ]);
  });

  it("should load correct workspace data when fetching workspace 2", async () => {
    // Fetch workspace 2
    const fetchedWorkspace = await db.workspace.findUnique({
      where: { slug: workspace2.slug },
      include: {
        members: true,
        tasks: true,
      },
    });

    expect(fetchedWorkspace).toBeDefined();
    expect(fetchedWorkspace?.id).toBe(workspace2.id);
    expect(fetchedWorkspace?.name).toBe("Workspace Two");
    expect(fetchedWorkspace?.slug).toBe("workspace-two");
    expect(fetchedWorkspace?.tasks).toHaveLength(2);
    
    // Verify tasks belong to workspace 2
    const taskTitles = fetchedWorkspace?.tasks.map(t => t.title).sort();
    expect(taskTitles).toEqual([
      "Workspace 2 - Task X",
      "Workspace 2 - Task Y",
    ]);
  });

  it("should maintain data isolation when switching between workspaces", async () => {
    // Fetch workspace 1 data
    const workspace1Data = await db.workspace.findUnique({
      where: { slug: workspace1.slug },
      include: { tasks: true },
    });

    expect(workspace1Data?.tasks).toHaveLength(2);
    expect(workspace1Data?.tasks.every(t => t.workspaceId === workspace1.id)).toBe(true);

    // Simulate workspace switch - fetch workspace 2 data
    const workspace2Data = await db.workspace.findUnique({
      where: { slug: workspace2.slug },
      include: { tasks: true },
    });

    expect(workspace2Data?.tasks).toHaveLength(2);
    expect(workspace2Data?.tasks.every(t => t.workspaceId === workspace2.id)).toBe(true);

    // Verify no cross-contamination - tasks from workspace1 should not appear in workspace2
    const workspace1TaskIds = workspace1Data?.tasks.map(t => t.id) || [];
    const workspace2TaskIds = workspace2Data?.tasks.map(t => t.id) || [];
    
    const hasOverlap = workspace1TaskIds.some(id => workspace2TaskIds.includes(id));
    expect(hasOverlap).toBe(false);
  });

  it("should correctly update lastAccessedAt when switching workspaces", async () => {
    // Get initial lastAccessedAt for workspace 1
    const initialMember1 = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace1.id,
          userId: testUser.id,
        },
      },
    });

    const initialAccessTime1 = initialMember1?.lastAccessedAt;

    // Wait a bit to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 100));

    // Update lastAccessedAt for workspace 1 (simulating workspace switch)
    await db.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId: workspace1.id,
          userId: testUser.id,
        },
      },
      data: {
        lastAccessedAt: new Date(),
      },
    });

    // Verify lastAccessedAt was updated
    const updatedMember1 = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace1.id,
          userId: testUser.id,
        },
      },
    });

    expect(updatedMember1?.lastAccessedAt).toBeDefined();
    if (initialAccessTime1) {
      expect(updatedMember1?.lastAccessedAt?.getTime()).toBeGreaterThan(
        initialAccessTime1.getTime()
      );
    }

    // Wait and update workspace 2
    await new Promise(resolve => setTimeout(resolve, 100));

    await db.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId: workspace2.id,
          userId: testUser.id,
        },
      },
      data: {
        lastAccessedAt: new Date(),
      },
    });

    const updatedMember2 = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace2.id,
          userId: testUser.id,
        },
      },
    });

    // Verify workspace 2 was accessed after workspace 1
    expect(updatedMember2?.lastAccessedAt).toBeDefined();
    expect(updatedMember1?.lastAccessedAt).toBeDefined();
    
    if (updatedMember1?.lastAccessedAt && updatedMember2?.lastAccessedAt) {
      expect(updatedMember2.lastAccessedAt.getTime()).toBeGreaterThan(
        updatedMember1.lastAccessedAt.getTime()
      );
    }
  });

  it("should return correct workspace when querying by slug", async () => {
    // Query workspace 1
    const ws1 = await db.workspace.findUnique({
      where: { slug: "workspace-one" },
      include: {
        members: {
          where: { userId: testUser.id },
        },
      },
    });

    expect(ws1?.id).toBe(workspace1.id);
    expect(ws1?.name).toBe("Workspace One");
    expect(ws1?.members[0]?.role).toBe("OWNER");

    // Query workspace 2
    const ws2 = await db.workspace.findUnique({
      where: { slug: "workspace-two" },
      include: {
        members: {
          where: { userId: testUser.id },
        },
      },
    });

    expect(ws2?.id).toBe(workspace2.id);
    expect(ws2?.name).toBe("Workspace Two");
    expect(ws2?.members[0]?.role).toBe("OWNER");
  });

  it("should fetch only tasks belonging to the current workspace", async () => {
    // Fetch tasks for workspace 1
    const ws1Tasks = await db.task.findMany({
      where: {
        workspaceId: workspace1.id,
      },
    });

    expect(ws1Tasks).toHaveLength(2);
    expect(ws1Tasks.every(t => t.workspaceId === workspace1.id)).toBe(true);
    expect(ws1Tasks.map(t => t.title)).toContain("Workspace 1 - Task A");
    expect(ws1Tasks.map(t => t.title)).toContain("Workspace 1 - Task B");

    // Fetch tasks for workspace 2
    const ws2Tasks = await db.task.findMany({
      where: {
        workspaceId: workspace2.id,
      },
    });

    expect(ws2Tasks).toHaveLength(2);
    expect(ws2Tasks.every(t => t.workspaceId === workspace2.id)).toBe(true);
    expect(ws2Tasks.map(t => t.title)).toContain("Workspace 2 - Task X");
    expect(ws2Tasks.map(t => t.title)).toContain("Workspace 2 - Task Y");

    // Verify no overlap
    const ws1TaskIds = new Set(ws1Tasks.map(t => t.id));
    const ws2TaskIds = new Set(ws2Tasks.map(t => t.id));
    
    ws1TaskIds.forEach(id => {
      expect(ws2TaskIds.has(id)).toBe(false);
    });
  });
});
