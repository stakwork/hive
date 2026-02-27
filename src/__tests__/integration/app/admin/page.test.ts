import { describe, test, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
} from "@/__tests__/support/fixtures";

/**
 * Integration tests for the admin dashboard page Prisma query.
 * Verifies that the workspace query correctly fetches:
 * - logoKey for workspace branding
 * - _count.members and _count.tasks for workspace metrics
 * - swarm._count.pods for active pod count (excluding soft-deleted pods)
 */
describe("Admin Page - Workspace Query Integration", () => {
  beforeEach(async () => {
    // Clean up test data
    await db.task.deleteMany();
    await db.pod.deleteMany();
    await db.swarm.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();
  });

  test("returns workspace with logoKey, member count, task count, and active pod count", async () => {
    const owner = await createTestUser();
    const member1 = await createTestUser();
    const member2 = await createTestUser();
    
    // Create workspace with logo
    const workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: owner.id,
        logoKey: "workspaces/test-workspace/logo.png",
      },
    });

    // Add members
    await createTestMembership({
      workspaceId: workspace.id,
      userId: member1.id,
      role: "DEVELOPER",
    });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: member2.id,
      role: "PM",
    });

    // Create tasks
    await db.task.createMany({
      data: [
        {
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
          title: "Task 1",
          description: "Description 1",
          status: "TODO",
        },
        {
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
          title: "Task 2",
          description: "Description 2",
          status: "IN_PROGRESS",
        },
        {
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
          title: "Task 3",
          description: "Description 3",
          status: "DONE",
        },
      ],
    });

    // Create swarm with pods
    const swarm = await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "test-swarm",
      },
    });

    // Create active pods (not deleted)
    await db.pod.createMany({
      data: [
        {
          swarmId: swarm.id,
          podId: "workspace-pod-1",
          status: "RUNNING",
        },
        {
          swarmId: swarm.id,
          podId: "workspace-pod-2",
          status: "RUNNING",
        },
      ],
    });

    // Create soft-deleted pod (should NOT be counted)
    await db.pod.create({
      data: {
        swarmId: swarm.id,
        podId: "workspace-pod-3",
        status: "STOPPED",
        deletedAt: new Date(),
      },
    });

    // Fetch workspace with the same query pattern as admin page
    const workspaces = await db.workspace.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        logoKey: true,
        createdAt: true,
        _count: {
          select: {
            members: true,
            tasks: true,
          },
        },
        swarm: {
          select: {
            _count: {
              select: {
                pods: {
                  where: {
                    deletedAt: null,
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(workspaces).toHaveLength(1);

    const result = workspaces[0];

    // Verify logoKey is fetched
    expect(result.logoKey).toBe("workspaces/test-workspace/logo.png");

    // Verify member count (2 explicit members)
    expect(result._count.members).toBe(2);

    // Verify task count
    expect(result._count.tasks).toBe(3);

    // Verify active pod count (2 active, 1 soft-deleted excluded)
    expect(result.swarm).toBeDefined();
    expect(result.swarm!._count.pods).toBe(2);
  });

  test("returns 0 pod count when workspace has no swarm", async () => {
    const owner = await createTestUser();
    
    const workspace = await db.workspace.create({
      data: {
        name: "Workspace Without Swarm",
        slug: "no-swarm-workspace",
        ownerId: owner.id,
      },
    });

    // Fetch workspace
    const workspaces = await db.workspace.findMany({
      where: { deletedAt: null, id: workspace.id },
      select: {
        id: true,
        name: true,
        slug: true,
        logoKey: true,
        createdAt: true,
        _count: {
          select: {
            members: true,
            tasks: true,
          },
        },
        swarm: {
          select: {
            _count: {
              select: {
                pods: {
                  where: {
                    deletedAt: null,
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(workspaces).toHaveLength(1);

    const result = workspaces[0];

    // Verify swarm is null
    expect(result.swarm).toBeNull();

    // Verify other counts still work
    expect(result._count.members).toBe(0);
    expect(result._count.tasks).toBe(0);
  });

  test("returns workspace without logoKey when not set", async () => {
    const owner = await createTestUser();
    
    const workspace = await db.workspace.create({
      data: {
        name: "Workspace Without Logo",
        slug: "no-logo-workspace",
        ownerId: owner.id,
        // logoKey not provided
      },
    });

    // Fetch workspace
    const workspaces = await db.workspace.findMany({
      where: { deletedAt: null, id: workspace.id },
      select: {
        id: true,
        name: true,
        slug: true,
        logoKey: true,
        createdAt: true,
        _count: {
          select: {
            members: true,
            tasks: true,
          },
        },
        swarm: {
          select: {
            _count: {
              select: {
                pods: {
                  where: {
                    deletedAt: null,
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(workspaces).toHaveLength(1);

    const result = workspaces[0];

    // Verify logoKey is null
    expect(result.logoKey).toBeNull();
  });

  test("excludes soft-deleted workspaces", async () => {
    const owner = await createTestUser();
    
    // Create active workspace
    await db.workspace.create({
      data: {
        name: "Active Workspace",
        slug: "active-workspace",
        ownerId: owner.id,
      },
    });

    // Create soft-deleted workspace
    await db.workspace.create({
      data: {
        name: "Deleted Workspace",
        slug: "deleted-workspace",
        ownerId: owner.id,
        deletedAt: new Date(),
      },
    });

    // Fetch workspaces
    const workspaces = await db.workspace.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        logoKey: true,
        createdAt: true,
        _count: {
          select: {
            members: true,
            tasks: true,
          },
        },
        swarm: {
          select: {
            _count: {
              select: {
                pods: {
                  where: {
                    deletedAt: null,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Only active workspace should be returned
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].name).toBe("Active Workspace");
  });
});
