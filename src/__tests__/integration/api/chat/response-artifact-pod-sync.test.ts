/**
 * Integration tests for artifact pod sync in POST /api/chat/response
 *
 * Covers:
 * - Pod existence check: skips task update when pod not found (returns 200)
 * - Transactional update: task.update + pod.updateMany called together when pod exists
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/chat/response/route";
import { db } from "@/lib/db";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import { createPostRequest } from "@/__tests__/support/helpers/request-builders";

// Mock Pusher so we don't need a real connection
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getTaskChannelName: (id: string) => `task-${id}`,
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: {
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
    NEW_MESSAGE: "new-message",
    FEATURE_UPDATED: "feature-updated",
  },
}));

// Mock S3 (not needed for these tests but imported transitively)
vi.mock("@/services/s3", () => ({
  getS3Service: () => ({
    putObject: vi.fn(),
    generatePresignedDownloadUrl: vi.fn(),
  }),
}));

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

async function seedWorkspaceAndTask() {
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { id: uid("user"), email: `${uid()}@test.com`, name: "Test User" },
    });
    const workspace = await tx.workspace.create({
      data: {
        id: uid("ws"),
        name: "Test WS",
        slug: uid("slug"),
        ownerId: user.id,
      },
    });
    const task = await tx.task.create({
      data: {
        id: uid("task"),
        title: "Test Task",
        status: "TODO",
        workflowStatus: "PENDING",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    return { user, workspace, task };
  });
}

async function seedPod(swarmId: string, podId: string) {
  return db.pod.create({
    data: {
      podId,
      swarmId,
      status: PodStatus.RUNNING,
      usageStatus: PodUsageStatus.UNUSED,
    },
  });
}

async function seedSwarm(workspaceId: string) {
  return db.swarm.create({
    data: {
      name: uid("swarm"),
      status: "ACTIVE",
      workspaceId,
    },
  });
}

describe("POST /api/chat/response — artifact pod sync", () => {
  let testTaskId: string;
  let testWorkspaceId: string;
  let testSwarmId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { workspace, task } = await seedWorkspaceAndTask();
    testTaskId = task.id;
    testWorkspaceId = workspace.id;
    const swarm = await seedSwarm(workspace.id);
    testSwarmId = swarm.id;
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  function buildBrowserArtifactRequest(podId: string) {
    return createPostRequest("http://localhost/api/chat/response", {
      taskId: testTaskId,
      message: "agent is running",
      artifacts: [
        {
          type: "BROWSER",
          content: { podId, url: "https://pod-8080.example.com" },
        },
      ],
    });
  }

  // ── tests ─────────────────────────────────────────────────────────────────

  it("returns 200 and skips task update when artifact podId does not exist in DB", async () => {
    const ghostPodId = uid("ghost-pod");

    // No pod row created — ghost pod
    const request = buildBrowserArtifactRequest(ghostPodId);
    request.headers.set("x-api-token", process.env.API_TOKEN ?? "test-api-token");

    const response = await POST(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);

    // task.podId must NOT have been set
    const task = await db.task.findUnique({ where: { id: testTaskId } });
    expect(task?.podId).toBeNull();
  });

  it("returns 200 and skips task update when artifact pod is soft-deleted", async () => {
    const podId = uid("soft-del-pod");
    // Create pod but mark it deleted
    await db.pod.create({
      data: {
        podId,
        swarmId: testSwarmId,
        status: PodStatus.RUNNING,
        usageStatus: PodUsageStatus.UNUSED,
        deletedAt: new Date(),
      },
    });

    const request = buildBrowserArtifactRequest(podId);
    request.headers.set("x-api-token", process.env.API_TOKEN ?? "test-api-token");

    const response = await POST(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);

    const task = await db.task.findUnique({ where: { id: testTaskId } });
    expect(task?.podId).toBeNull();
  });

  it("returns 201, sets task.podId, and marks pod USED when artifact pod exists", async () => {
    const podId = uid("real-pod");
    await seedPod(testSwarmId, podId);

    const request = buildBrowserArtifactRequest(podId);
    request.headers.set("x-api-token", process.env.API_TOKEN ?? "test-api-token");

    const response = await POST(request);

    // Route creates a chat message → 201
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);

    // task.podId should be set
    const task = await db.task.findUnique({ where: { id: testTaskId } });
    expect(task?.podId).toBe(podId);

    // pod should be marked USED
    const pod = await db.pod.findFirst({ where: { podId, deletedAt: null } });
    expect(pod?.usageStatus).toBe(PodUsageStatus.USED);
    expect(pod?.usageStatusMarkedBy).toBe(testTaskId);
  });
});
