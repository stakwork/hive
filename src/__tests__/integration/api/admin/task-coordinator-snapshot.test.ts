import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createJanitorConfig,
} from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createGetRequest,
} from "@/__tests__/support/helpers/request-builders";
import type { CoordinatorSnapshot } from "@/app/api/admin/task-coordinator/snapshot/route";

describe("GET /api/admin/task-coordinator/snapshot", () => {
  let superAdminUser: { id: string; email: string | null; name: string | null };
  let regularUser: { id: string; email: string | null; name: string | null };

  beforeEach(async () => {
    superAdminUser = await createTestUser({
      role: "SUPER_ADMIN",
      email: "superadmin-snapshot@test.com",
      name: "Super Admin Snapshot",
    });
    regularUser = await createTestUser({
      role: "USER",
      email: "regular-snapshot@test.com",
      name: "Regular Snapshot",
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const request = createGetRequest("/api/admin/task-coordinator/snapshot");
    const { GET } = await import(
      "@/app/api/admin/task-coordinator/snapshot/route"
    );
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-super-admin users", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/admin/task-coordinator/snapshot",
      regularUser
    );
    const { GET } = await import(
      "@/app/api/admin/task-coordinator/snapshot/route"
    );
    const response = await GET(request);
    expect(response.status).toBe(403);
  });

  it("returns a valid snapshot shape for a super-admin with no eligible workspaces", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/admin/task-coordinator/snapshot",
      superAdminUser
    );
    const { GET } = await import(
      "@/app/api/admin/task-coordinator/snapshot/route"
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const data: CoordinatorSnapshot = await response.json();

    // Shape assertions
    expect(typeof data.timestamp).toBe("string");
    expect(typeof data.totalWorkspacesWithSweep).toBe("number");
    expect(typeof data.totalSlotsAvailable).toBe("number");
    expect(typeof data.totalQueued).toBe("number");
    expect(typeof data.totalStaleTasks).toBe("number");
    expect(typeof data.totalOrphanedPods).toBe("number");
    expect(Array.isArray(data.workspaces)).toBe(true);

    // No eligible workspaces yet
    expect(data.totalWorkspacesWithSweep).toBe(0);
    expect(data.workspaces).toHaveLength(0);
  });

  it("includes eligible workspaces (ticketSweepEnabled) in the snapshot", async () => {
    // Create a workspace with ticketSweepEnabled
    const workspace = await createTestWorkspace({
      ownerId: superAdminUser.id,
      name: "Sweep Workspace",
      slug: "sweep-workspace-snap",
    });
    await createJanitorConfig(workspace.id, {
      ticketSweepEnabled: true,
      recommendationSweepEnabled: false,
    });

    const request = createAuthenticatedGetRequest(
      "/api/admin/task-coordinator/snapshot",
      superAdminUser
    );
    const { GET } = await import(
      "@/app/api/admin/task-coordinator/snapshot/route"
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const data: CoordinatorSnapshot = await response.json();

    expect(data.totalWorkspacesWithSweep).toBeGreaterThanOrEqual(1);

    const ws = data.workspaces.find((w) => w.id === workspace.id);
    expect(ws).toBeDefined();
    expect(ws!.slug).toBe("sweep-workspace-snap");
    expect(ws!.ticketSweepEnabled).toBe(true);
    // No swarm → processingNote set
    expect(ws!.processingNote).toBe("No pool configured, skipping");
    expect(ws!.swarmEnabled).toBe(false);
    expect(Array.isArray(ws!.candidateTasks)).toBe(true);
    expect(ws!.candidateTasks).toHaveLength(0);
  });

  it("excludes workspaces with both sweeps disabled", async () => {
    const workspace = await createTestWorkspace({
      ownerId: superAdminUser.id,
      name: "Disabled Sweeps WS",
      slug: "disabled-sweeps-snap",
    });
    await createJanitorConfig(workspace.id, {
      ticketSweepEnabled: false,
      recommendationSweepEnabled: false,
    });

    const request = createAuthenticatedGetRequest(
      "/api/admin/task-coordinator/snapshot",
      superAdminUser
    );
    const { GET } = await import(
      "@/app/api/admin/task-coordinator/snapshot/route"
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const data: CoordinatorSnapshot = await response.json();
    const ws = data.workspaces.find((w) => w.id === workspace.id);
    expect(ws).toBeUndefined();
  });

  it("counts stale and orphaned tasks in global totals", async () => {
    const workspace = await createTestWorkspace({
      ownerId: superAdminUser.id,
      name: "Stale Tasks WS",
      slug: "stale-tasks-snap",
    });

    // Create a stale IN_PROGRESS task (updated > 24h ago)
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db.task.create({
      data: {
        title: "Stale IN_PROGRESS task",
        workspaceId: workspace.id,
        status: "IN_PROGRESS",
        workflowStatus: "IN_PROGRESS",
        createdById: superAdminUser.id,
        updatedById: superAdminUser.id,
        updatedAt: staleDate,
      },
    });

    const request = createAuthenticatedGetRequest(
      "/api/admin/task-coordinator/snapshot",
      superAdminUser
    );
    const { GET } = await import(
      "@/app/api/admin/task-coordinator/snapshot/route"
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const data: CoordinatorSnapshot = await response.json();
    // Should detect at least 1 stale task
    expect(data.totalStaleTasks).toBeGreaterThanOrEqual(1);
  });

  it("snapshot timestamp is a recent ISO string", async () => {
    const before = Date.now();
    const request = createAuthenticatedGetRequest(
      "/api/admin/task-coordinator/snapshot",
      superAdminUser
    );
    const { GET } = await import(
      "@/app/api/admin/task-coordinator/snapshot/route"
    );
    const response = await GET(request);
    const after = Date.now();

    const data: CoordinatorSnapshot = await response.json();
    const ts = new Date(data.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
