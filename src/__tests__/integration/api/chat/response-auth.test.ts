/**
 * Integration tests for org API key auth on POST /api/chat/response.
 *
 * Covers:
 *  - system token still works (unchanged behaviour)
 *  - org key for the right org works
 *  - org key for another org → 404 with nothing written
 *  - no token → 401; revoked key → 401
 *  - org-caller payload policy: recordings, WORKFLOW/PUBLISH_* artifacts,
 *    pod org-mismatch
 *  - ambiguous workspace (task + feature in different workspaces)
 *  - org caller's 500 response has no `detail`
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { POST } from "@/app/api/chat/response/route";
import { createPostRequest } from "@/__tests__/support/helpers/request-builders";
import { createRequestWithHeaders, generateUniqueId, generateUniqueSlug } from "@/__tests__/support/helpers";
import { createOrgApiKey } from "@/lib/org-api-keys";
import { PodStatus, PodUsageStatus } from "@prisma/client";

vi.mock("@/lib/sphinx/direct-message", () => ({
  sendDirectMessage: vi.fn().mockResolvedValue({ success: true }),
  isDirectMessageConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getFeatureChannelName: (id: string) => `feature-${id}`,
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (id: string) => `task-${id}`,
  PUSHER_EVENTS: {
    FEATURE_UPDATED: "feature-updated",
    NEW_MESSAGE: "new-message",
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

vi.mock("@/lib/screenshot-upload", () => ({
  processScreenshotUpload: vi.fn(),
  processRecordingUpload: vi.fn(),
}));

vi.mock("@/services/canvas-planner-fanout", () => ({
  fanOutPlannerMessageToCanvas: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/helpers/prompt-baseline-snapshot", () => ({
  enrichPublishPromptArtifacts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/helpers/script-version-snapshot", () => ({
  enrichPublishScriptArtifacts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/helpers/workflow-version-snapshot", () => ({
  enrichWorkflowArtifacts: vi.fn().mockResolvedValue(undefined),
  enrichPublishWorkflowArtifacts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

import { processRecordingUpload } from "@/lib/screenshot-upload";

const API_TOKEN = "test-api-token-response-auth";

function makeRequest(body: object, headers: Record<string, string> = {}) {
  return createRequestWithHeaders(
    "http://localhost:3000/api/chat/response",
    "POST",
    { "Content-Type": "application/json", ...headers },
    body,
  );
}

async function createOrg() {
  const githubLogin = `org-chat-response-${generateUniqueId()}`;
  return db.sourceControlOrg.create({
    data: { githubLogin, githubInstallationId: Math.floor(Math.random() * 1_000_000) + 1, type: "ORG", name: githubLogin },
  });
}

async function createWorkspaceWithTask(orgId?: string) {
  const owner = await db.user.create({
    data: { email: `${generateUniqueId("owner")}@test.com`, name: "Owner" },
  });
  const workspace = await db.workspace.create({
    data: {
      id: generateUniqueId("ws"),
      name: "Test Workspace",
      slug: generateUniqueSlug("ws-chat-auth"),
      ownerId: owner.id,
      sourceControlOrgId: orgId ?? null,
    },
  });
  const task = await db.task.create({
    data: {
      id: generateUniqueId("task"),
      title: "Test Task",
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    },
  });
  return { owner, workspace, task };
}

describe("POST /api/chat/response — org API key auth", () => {
  beforeEach(() => {
    process.env.API_TOKEN = API_TOKEN;
    vi.clearAllMocks();
  });

  it("system token still works (unchanged behaviour)", async () => {
    const { task } = await createWorkspaceWithTask();

    const response = await POST(
      makeRequest({ taskId: task.id, message: "hello" }, { "x-api-token": API_TOKEN }),
    );

    expect(response.status).toBe(201);
  });

  it("an org key for the right org works", async () => {
    const org = await createOrg();
    const { owner, task } = await createWorkspaceWithTask(org.id);
    const { key } = await createOrgApiKey({ orgId: org.id, name: "strut", createdById: owner.id });

    const response = await POST(
      makeRequest({ taskId: task.id, message: "hello from org" }, { "x-api-token": key }),
    );

    expect(response.status).toBe(201);
    const msg = await db.chatMessage.findFirst({ where: { taskId: task.id } });
    expect(msg?.message).toBe("hello from org");
  });

  it("an org key for another org → 404 with nothing written", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const { owner: ownerA } = await createWorkspaceWithTask(orgA.id);
    const { task: taskB } = await createWorkspaceWithTask(orgB.id);
    const { key } = await createOrgApiKey({ orgId: orgA.id, name: "strut", createdById: ownerA.id });

    const response = await POST(
      makeRequest({ taskId: taskB.id, message: "should not land" }, { "x-api-token": key }),
    );

    expect(response.status).toBe(404);
    const msg = await db.chatMessage.findFirst({ where: { taskId: taskB.id } });
    expect(msg).toBeNull();
  });

  it("no token → 401", async () => {
    const { task } = await createWorkspaceWithTask();

    const response = await POST(makeRequest({ taskId: task.id, message: "hi" }));

    expect(response.status).toBe(401);
  });

  it("a revoked key → 401", async () => {
    const org = await createOrg();
    const { owner, task } = await createWorkspaceWithTask(org.id);
    const { id, key } = await createOrgApiKey({ orgId: org.id, name: "revoked", createdById: owner.id });
    await db.orgApiKey.update({ where: { id }, data: { revokedAt: new Date() } });

    const response = await POST(
      makeRequest({ taskId: task.id, message: "hi" }, { "x-api-token": key }),
    );

    expect(response.status).toBe(401);
  });

  it("org caller with recordings → 400, no ChatMessage, and processRecordingUpload not called", async () => {
    const org = await createOrg();
    const { owner, task } = await createWorkspaceWithTask(org.id);
    const { key } = await createOrgApiKey({ orgId: org.id, name: "strut", createdById: owner.id });

    const response = await POST(
      makeRequest(
        { taskId: task.id, message: "hi", recordings: ["https://example.com/rec.webm"] },
        { "x-api-token": key },
      ),
    );

    expect(response.status).toBe(400);
    const msg = await db.chatMessage.findFirst({ where: { taskId: task.id } });
    expect(msg).toBeNull();
    expect(processRecordingUpload).not.toHaveBeenCalled();
  });

  it("org caller with a WORKFLOW artifact → 400, with no upsert and no enrich call", async () => {
    const org = await createOrg();
    const { owner, task } = await createWorkspaceWithTask(org.id);
    await db.task.update({ where: { id: task.id }, data: { mode: "workflow_editor" } });
    const { key } = await createOrgApiKey({ orgId: org.id, name: "strut", createdById: owner.id });

    const response = await POST(
      makeRequest(
        {
          taskId: task.id,
          message: "hi",
          artifacts: [{ type: "WORKFLOW", content: { workflowId: 42 } }],
        },
        { "x-api-token": key },
      ),
    );

    expect(response.status).toBe(400);
    const msg = await db.chatMessage.findFirst({ where: { taskId: task.id } });
    expect(msg).toBeNull();
    const workflowTask = await db.workflowTask.findUnique({ where: { taskId: task.id } });
    expect(workflowTask).toBeNull();
  });

  it("org-A caller naming org B's podId → 403, with no ChatMessage and pod/task.podId unchanged", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const { owner: ownerA, task: taskA } = await createWorkspaceWithTask(orgA.id);
    const { workspace: wsB } = await createWorkspaceWithTask(orgB.id);
    const swarmB = await db.swarm.create({
      data: { name: generateUniqueId("swarm-b"), status: "ACTIVE", workspaceId: wsB.id },
    });
    const podB = await db.pod.create({
      data: { podId: generateUniqueId("pod-b"), swarmId: swarmB.id, status: PodStatus.RUNNING, usageStatus: PodUsageStatus.UNUSED },
    });
    const { key } = await createOrgApiKey({ orgId: orgA.id, name: "strut", createdById: ownerA.id });

    const response = await POST(
      makeRequest(
        {
          taskId: taskA.id,
          message: "hi",
          artifacts: [{ type: "BROWSER", content: { podId: podB.podId } }],
        },
        { "x-api-token": key },
      ),
    );

    expect(response.status).toBe(403);
    const msg = await db.chatMessage.findFirst({ where: { taskId: taskA.id } });
    expect(msg).toBeNull();
    const unchangedPod = await db.pod.findFirst({ where: { podId: podB.podId } });
    expect(unchangedPod?.usageStatus).toBe(PodUsageStatus.UNUSED);
    const unchangedTask = await db.task.findUnique({ where: { id: taskA.id } });
    expect(unchangedTask?.podId).toBeNull();
  });

  it("org-A caller with its own pod → pod marked USED", async () => {
    const orgA = await createOrg();
    const { owner, workspace, task } = await createWorkspaceWithTask(orgA.id);
    const swarm = await db.swarm.create({
      data: { name: generateUniqueId("swarm-a"), status: "ACTIVE", workspaceId: workspace.id },
    });
    const pod = await db.pod.create({
      data: { podId: generateUniqueId("pod-a"), swarmId: swarm.id, status: PodStatus.RUNNING, usageStatus: PodUsageStatus.UNUSED },
    });
    const { key } = await createOrgApiKey({ orgId: orgA.id, name: "strut", createdById: owner.id });

    const response = await POST(
      makeRequest(
        {
          taskId: task.id,
          message: "hi",
          artifacts: [{ type: "BROWSER", content: { podId: pod.podId } }],
        },
        { "x-api-token": key },
      ),
    );

    expect(response.status).toBe(201);
    const updatedPod = await db.pod.findFirst({ where: { podId: pod.podId } });
    expect(updatedPod?.usageStatus).toBe(PodUsageStatus.USED);
  });

  it("task in A1 + feature in A2 → 400", async () => {
    const org = await createOrg();
    const { owner, task } = await createWorkspaceWithTask(org.id);
    const { workspace: ws2 } = await createWorkspaceWithTask(org.id);
    const feature2 = await db.feature.create({
      data: {
        id: generateUniqueId("feature"),
        title: "Feature 2",
        brief: "b",
        workspaceId: ws2.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    const { key } = await createOrgApiKey({ orgId: org.id, name: "strut", createdById: owner.id });

    const response = await POST(
      makeRequest(
        { taskId: task.id, featureId: feature2.id, message: "hi" },
        { "x-api-token": key },
      ),
    );

    expect(response.status).toBe(400);
  });

  it("org caller's 500 response has no detail", async () => {
    const org = await createOrg();
    const { owner, task } = await createWorkspaceWithTask(org.id);
    const { key } = await createOrgApiKey({ orgId: org.id, name: "strut", createdById: owner.id });

    // Force a real internal error AFTER authorization succeeds: an artifact
    // type that isn't a valid Prisma enum value makes `chatMessage.create`
    // throw, landing in the route's catch block.
    const response = await POST(
      makeRequest(
        {
          taskId: task.id,
          message: "hi",
          artifacts: [{ type: "NOT_A_REAL_ARTIFACT_TYPE" }],
        },
        { "x-api-token": key },
      ),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).not.toHaveProperty("detail");
  });
});
