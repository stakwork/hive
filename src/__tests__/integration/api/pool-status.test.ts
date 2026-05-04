import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/w/[slug]/pool/status/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { createTestPod } from "@/__tests__/support/factories/pod.factory";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import {
  createGetRequest,
  createAuthenticatedGetRequest,
  generateUniqueId,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectNotFound,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm } from "@prisma/client";
import type { PoolStatusResponse } from "@/types";

// Mock super-admin check only. The route uses `resolveWorkspaceAccess`,
// which calls the real `getMiddlewareContext` to read auth headers off
// the request — those headers are stamped by `createAuthenticatedGetRequest`.
// Mocking `getMiddlewareContext` would short-circuit that flow.
vi.mock("@/lib/middleware/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/middleware/utils")>(
    "@/lib/middleware/utils"
  );
  return {
    ...actual,
    checkIsSuperAdmin: vi.fn().mockResolvedValue(false),
  };
});

describe("GET /api/w/[slug]/pool/status - Authentication", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Status Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      // Create swarm
      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated requests on a private workspace", async () => {
    // No auth headers stamped — `resolveWorkspaceAccess` returns `unauthenticated`
    // because the workspace is not flagged `isPublicViewable`.
    const request = createGetRequest(`/api/w/${workspace.slug}/pool/status`);
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    await expectUnauthorized(response);
  });

  it("should allow unauthenticated access on a public-viewable workspace", async () => {
    await db.workspace.update({
      where: { id: workspace.id },
      data: { isPublicViewable: true },
    });

    const request = createGetRequest(`/api/w/${workspace.slug}/pool/status`);
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data.status).toBeDefined();
    // Aggregate-only response — should never leak pod-level identifiers.
    expect(data.data.status).not.toHaveProperty("podIds");
    expect(data.data.status).not.toHaveProperty("hostnames");
  });

  it("should return 400 when workspace slug is missing", async () => {
    const request = createAuthenticatedGetRequest("/api/w//pool/status", owner);
    const response = await GET(request, {
      params: Promise.resolve({ slug: "" }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Workspace slug is required");
  });

  it("should return 401 for non-existent workspace when unauthenticated", async () => {
    // resolveWorkspaceAccess returns `unauthenticated` (not `not-found`) when
    // the caller has no session AND the workspace doesn't exist — we don't
    // want to leak workspace existence to anonymous callers.
    const request = createGetRequest(
      "/api/w/nonexistent-workspace/pool/status"
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: "nonexistent-workspace" }),
    });

    await expectUnauthorized(response);
  });

  it("should return 404 for non-existent workspace when authenticated", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/w/nonexistent-workspace/pool/status",
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: "nonexistent-workspace" }),
    });

    await expectNotFound(response, "Workspace not found or access denied");
  });

  it("should return 404 when swarm is not configured", async () => {
    // Create workspace without swarm
    const newScenario = await createTestWorkspaceScenario({
      owner: { name: "No Swarm Owner" },
    });

    const request = createAuthenticatedGetRequest(
      `/api/w/${newScenario.workspace.slug}/pool/status`,
      newScenario.owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: newScenario.workspace.slug }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Pool not configured for this workspace");
  });
});

describe("GET /api/w/[slug]/pool/status - Authorization", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let memberViewer: User;
  let memberDeveloper: User;
  let memberAdmin: User;
  let nonMember: User;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Auth Owner" },
        members: [
          { role: "VIEWER" },
          { role: "DEVELOPER" },
          { role: "ADMIN" },
        ],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      memberViewer = scenario.members[0];
      memberDeveloper = scenario.members[1];
      memberAdmin = scenario.members[2];

      // Create swarm
      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `auth-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      // Create test pods for this swarm
      await createTestPod({
        swarmId: swarm.id,
        status: PodStatus.RUNNING,
        usageStatus: PodUsageStatus.UNUSED,
      });

      // Create non-member user
      const nonMemberData = await tx.user.create({
        data: {
          name: "Non Member User",
          email: `non-member-${generateUniqueId("user")}@example.com`,
        },
      });
      nonMember = nonMemberData;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 403 for non-member access on a private workspace", async () => {
    // resolveWorkspaceAccess returns `forbidden` when the caller is
    // authenticated, the workspace exists, and they have no membership row
    // and the workspace isn't public-viewable. requireReadAccess maps
    // `forbidden` to a 403 response.
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      nonMember
    );

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    expect(response.status).toBe(403);
  });

  it("should allow VIEWER role to access pool status", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      memberViewer
    );

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.status).toBeDefined();
  });

  it("should allow DEVELOPER role to access pool status", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      memberDeveloper
    );

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
  });

  it("should allow ADMIN role to access pool status", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      memberAdmin
    );

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
  });

  it("should allow OWNER role to access pool status", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
  });
});

describe("GET /api/w/[slug]/pool/status - Pool Status Data", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Service Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `service-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should successfully fetch pool status", async () => {
    // Create 5 RUNNING/UNUSED pods
    for (let i = 0; i < 5; i++) {
      await createTestPod({
        swarmId: swarm.id,
        status: PodStatus.RUNNING,
        usageStatus: PodUsageStatus.UNUSED,
      });
    }

    // Create 2 RUNNING/USED pods
    for (let i = 0; i < 2; i++) {
      await createTestPod({
        swarmId: swarm.id,
        status: PodStatus.RUNNING,
        usageStatus: PodUsageStatus.USED,
      });
    }

    // Create 2 PENDING pods
    await createTestPod({
      swarmId: swarm.id,
      status: PodStatus.PENDING,
      usageStatus: PodUsageStatus.UNUSED,
    });
    await createTestPod({
      swarmId: swarm.id,
      status: PodStatus.STARTING,
      usageStatus: PodUsageStatus.UNUSED,
    });

    // Create 1 FAILED pod
    await createTestPod({
      swarmId: swarm.id,
      status: PodStatus.FAILED,
      usageStatus: PodUsageStatus.UNUSED,
    });

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data.status.runningVms).toBe(9); // 5 RUNNING/UNUSED + 2 RUNNING/USED + 1 PENDING + 1 STARTING
    expect(data.data.status.pendingVms).toBe(2); // 1 PENDING + 1 STARTING
    expect(data.data.status.failedVms).toBe(1); // 1 FAILED
    expect(data.data.status.usedVms).toBe(2); // 2 RUNNING/USED
    expect(data.data.status.unusedVms).toBe(5); // 5 RUNNING/UNUSED (pending/failed pods not counted as available)
    expect(data.data.status.lastCheck).toBeDefined();
    expect(typeof data.data.status.lastCheck).toBe("string");
    // Verify it's a valid ISO timestamp
    expect(() => new Date(data.data.status.lastCheck)).not.toThrow();
  });

  it("should exclude TERMINATING and MOTHBALLED pods from counts", async () => {
    // Create 3 RUNNING pods
    for (let i = 0; i < 3; i++) {
      await createTestPod({
        swarmId: swarm.id,
        status: PodStatus.RUNNING,
        usageStatus: PodUsageStatus.UNUSED,
      });
    }

    // Create 1 TERMINATING pod (should be excluded)
    await createTestPod({
      swarmId: swarm.id,
      status: PodStatus.TERMINATING,
      usageStatus: PodUsageStatus.UNUSED,
    });

    // Create 1 MOTHBALLED pod (should be excluded)
    await createTestPod({
      swarmId: swarm.id,
      status: PodStatus.MOTHBALLED,
      usageStatus: PodUsageStatus.UNUSED,
    });

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.data.status.runningVms).toBe(3);
    expect(data.data.status.pendingVms).toBe(0);
    expect(data.data.status.failedVms).toBe(0);
    expect(data.data.status.usedVms).toBe(0);
    expect(data.data.status.unusedVms).toBe(3);
  });

  it("should exclude soft-deleted pods from counts", async () => {
    // Create 5 RUNNING pods
    const pods = [];
    for (let i = 0; i < 5; i++) {
      const pod = await createTestPod({
        swarmId: swarm.id,
        status: PodStatus.RUNNING,
        usageStatus: PodUsageStatus.UNUSED,
      });
      pods.push(pod);
    }

    // Soft-delete 2 pods
    await db.pod.update({
      where: { id: pods[0].id },
      data: { deletedAt: new Date() },
    });
    await db.pod.update({
      where: { id: pods[1].id },
      data: { deletedAt: new Date() },
    });

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.data.status.runningVms).toBe(3);
    expect(data.data.status.pendingVms).toBe(0);
    expect(data.data.status.failedVms).toBe(0);
    expect(data.data.status.usedVms).toBe(0);
    expect(data.data.status.unusedVms).toBe(3);
  });

  it("should return zeros when swarm has no active pods", async () => {
    // Don't create any pods for the swarm
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.data.status.runningVms).toBe(0);
    expect(data.data.status.pendingVms).toBe(0);
    expect(data.data.status.failedVms).toBe(0);
    expect(data.data.status.usedVms).toBe(0);
    expect(data.data.status.unusedVms).toBe(0);
    // lastCheck should still be present even with no pods
    expect(data.data.status.lastCheck).toBeDefined();
    expect(typeof data.data.status.lastCheck).toBe("string");
  });
});

describe("GET /api/w/[slug]/pool/status - Response Structure", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Response Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `response-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      // Create some test pods
      await createTestPod({
        swarmId: swarm.id,
        status: PodStatus.RUNNING,
        usageStatus: PodUsageStatus.USED,
      });
      await createTestPod({
        swarmId: swarm.id,
        status: PodStatus.RUNNING,
        usageStatus: PodUsageStatus.UNUSED,
      });
      await createTestPod({
        swarmId: swarm.id,
        status: PodStatus.PENDING,
        usageStatus: PodUsageStatus.UNUSED,
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return valid PoolStatusResponse structure", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);

    // Verify response structure
    expect(data).toHaveProperty("success");
    expect(data).toHaveProperty("data");
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty("status");
    expect(data.data.status).toHaveProperty("runningVms");
    expect(data.data.status).toHaveProperty("pendingVms");
    expect(data.data.status).toHaveProperty("failedVms");
    expect(data.data.status).toHaveProperty("usedVms");
    expect(data.data.status).toHaveProperty("unusedVms");
    expect(data.data.status).toHaveProperty("lastCheck");

    // Verify data types
    expect(typeof data.data.status.runningVms).toBe("number");
    expect(typeof data.data.status.pendingVms).toBe("number");
    expect(typeof data.data.status.failedVms).toBe("number");
    expect(typeof data.data.status.usedVms).toBe("number");
    expect(typeof data.data.status.unusedVms).toBe("number");
    expect(typeof data.data.status.lastCheck).toBe("string");
    expect(data.data.status).toHaveProperty("queuedCount");
    expect(typeof data.data.status.queuedCount).toBe("number");
  });

  it("should handle zero values in pool status", async () => {
    // Create a new workspace with no pods
    const newScenario = await createTestWorkspaceScenario({
      owner: { name: "Empty Pool Owner" },
    });

    const newSwarm = await createTestSwarm({
      workspaceId: newScenario.workspace.id,
      name: `empty-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
    });

    const request = createAuthenticatedGetRequest(
      `/api/w/${newScenario.workspace.slug}/pool/status`,
      newScenario.owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: newScenario.workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.data.status.runningVms).toBe(0);
    expect(data.data.status.pendingVms).toBe(0);
    expect(data.data.status.failedVms).toBe(0);
    expect(data.data.status.usedVms).toBe(0);
    expect(data.data.status.unusedVms).toBe(0);
    expect(data.data.status.queuedCount).toBe(0);
  });

  it("should return queuedCount reflecting TODO + TASK_COORDINATOR tasks", async () => {
    // Create a new workspace with queued tasks
    const newScenario = await createTestWorkspaceScenario({
      owner: { name: "Queued Tasks Owner" },
    });

    await createTestSwarm({
      workspaceId: newScenario.workspace.id,
      name: `queued-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
    });

    // Create 2 queued tasks (TODO + TASK_COORDINATOR)
    await db.task.createMany({
      data: [
        {
          title: `Queued Task 1 ${generateUniqueId("task")}`,
          workspaceId: newScenario.workspace.id,
          createdById: newScenario.owner.id,
          updatedById: newScenario.owner.id,
          status: "TODO",
          systemAssigneeType: "TASK_COORDINATOR",
          deleted: false,
        },
        {
          title: `Queued Task 2 ${generateUniqueId("task")}`,
          workspaceId: newScenario.workspace.id,
          createdById: newScenario.owner.id,
          updatedById: newScenario.owner.id,
          status: "TODO",
          systemAssigneeType: "TASK_COORDINATOR",
          deleted: false,
        },
        // This one should NOT be counted (not TASK_COORDINATOR)
        {
          title: `Normal Task ${generateUniqueId("task")}`,
          workspaceId: newScenario.workspace.id,
          createdById: newScenario.owner.id,
          updatedById: newScenario.owner.id,
          status: "TODO",
          deleted: false,
        },
      ],
    });

    const request = createAuthenticatedGetRequest(
      `/api/w/${newScenario.workspace.slug}/pool/status`,
      newScenario.owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: newScenario.workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.data.status.queuedCount).toBe(2);
  });

  it("should return queuedCount of 0 when no TASK_COORDINATOR TODO tasks exist", async () => {
    const newScenario = await createTestWorkspaceScenario({
      owner: { name: "No Queue Owner" },
    });

    await createTestSwarm({
      workspaceId: newScenario.workspace.id,
      name: `no-queue-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
    });

    // Only non-coordinator tasks
    await db.task.create({
      data: {
        title: `Regular Task ${generateUniqueId("task")}`,
        workspaceId: newScenario.workspace.id,
        createdById: newScenario.owner.id,
        updatedById: newScenario.owner.id,
        status: "TODO",
        deleted: false,
      },
    });

    const request = createAuthenticatedGetRequest(
      `/api/w/${newScenario.workspace.slug}/pool/status`,
      newScenario.owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: newScenario.workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.data.status.queuedCount).toBe(0);
  });
});
