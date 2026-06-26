/**
 * Integration tests: POST /api/stakwork/ai/generate — idempotency guard
 *
 * Verifies that a second request for the same featureId + TASK_GENERATION type
 * while a run is PENDING or IN_PROGRESS returns 409 with the existing run's ID.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { POST } from "@/app/api/stakwork/ai/generate/route";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";
import {
  createAuthenticatedPostRequest,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { resetDatabase } from "@/__tests__/support/utilities/database";

// Mock env config so STAKWORK_AI_GENERATION_WORKFLOW_ID is available
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_AI_GENERATION_WORKFLOW_ID: "123",
    STAKWORK_API_KEY: "test-stakwork-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
    API_TIMEOUT: 10000,
  },
  // Bifrost gates — `getBifrostForLLM` (called from createStakworkRun
  // for TASK_GENERATION) reads these directly. Returning `false` makes
  // the orchestrator short-circuit to `undefined`, leaving the Stakwork
  // payload byte-identical to the pre-Bifrost behavior these tests
  // assert.
  isBifrostEnabledForWorkspace: vi.fn().mockReturnValue(false),
  isBifrostEnabledForAgent: vi.fn().mockReturnValue(false),
}));

// Mock Stakwork so no real HTTP calls are made
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: vi.fn().mockResolvedValue({ data: { project_id: 42 } }),
    stopProject: vi.fn().mockResolvedValue({}),
  })),
}));

// Mock Pusher
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
  },
}));

// Mock encryption so decryptField doesn't blow up without real keys
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_field: string, value: unknown) => String(value)),
    })),
  },
}));

// Mock Sphinx to avoid network calls
vi.mock("@/lib/sphinx/daily-pr-summary", () => ({
  sendToSphinx: vi.fn().mockResolvedValue({}),
}));

const BASE_URL = "http://localhost:3000/api/stakwork/ai/generate";

describe("POST /api/stakwork/ai/generate — idempotency guard", () => {
  let user: { id: string; email: string; name: string };
  let workspace: { id: string; slug: string };
  let feature: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    user = await db.user.create({
      data: {
        id: generateUniqueId("user"),
        email: `owner-${generateUniqueId()}@test.com`,
        name: "Test Owner",
      },
    });

    workspace = await db.workspace.create({
      data: {
        name: `Test WS ${generateUniqueId()}`,
        slug: generateUniqueSlug("gen-ws"),
        ownerId: user.id,
      },
    });

    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
    });

    feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        // Provide required architecture so the guard is the only blocker
        architecture: "Some architecture text",
      },
    });

    // Create a default phase so TASK_GENERATION can resolve it
    await db.phase.create({
      data: {
        name: "Phase 1",
        featureId: feature.id,
        order: 0,
      },
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("returns 409 with existingRunId when a PENDING TASK_GENERATION run already exists", async () => {
    // Seed an active run directly in the DB
    const activeRun = await db.stakworkRun.create({
      data: {
        type: StakworkRunType.TASK_GENERATION,
        workspaceId: workspace.id,
        featureId: feature.id,
        status: WorkflowStatus.PENDING,
        webhookUrl: "http://example.com/webhook",
        dataType: "string",
      },
    });

    const request = createAuthenticatedPostRequest(
      BASE_URL,
      user,
      {
        type: "TASK_GENERATION",
        featureId: feature.id,
        workspaceId: workspace.id,
        autoAccept: true,
        params: { skipClarifyingQuestions: true },
      }
    );

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("A run of this type is already in progress");
    expect(body.existingRunId).toBe(activeRun.id);
  });

  it("returns 409 with existingRunId when an IN_PROGRESS TASK_GENERATION run already exists", async () => {
    const activeRun = await db.stakworkRun.create({
      data: {
        type: StakworkRunType.TASK_GENERATION,
        workspaceId: workspace.id,
        featureId: feature.id,
        status: WorkflowStatus.IN_PROGRESS,
        projectId: 123,
        webhookUrl: "http://example.com/webhook",
        dataType: "string",
      },
    });

    const request = createAuthenticatedPostRequest(
      BASE_URL,
      user,
      {
        type: "TASK_GENERATION",
        featureId: feature.id,
        workspaceId: workspace.id,
        autoAccept: true,
        params: { skipClarifyingQuestions: true },
      }
    );

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.existingRunId).toBe(activeRun.id);
  });

  it("does NOT block a second request once the existing run is COMPLETED", async () => {
    // A completed run should not trigger the guard
    await db.stakworkRun.create({
      data: {
        type: StakworkRunType.TASK_GENERATION,
        workspaceId: workspace.id,
        featureId: feature.id,
        status: WorkflowStatus.COMPLETED,
        webhookUrl: "http://example.com/webhook",
        dataType: "string",
      },
    });

    const request = createAuthenticatedPostRequest(
      BASE_URL,
      user,
      {
        type: "TASK_GENERATION",
        featureId: feature.id,
        workspaceId: workspace.id,
        autoAccept: true,
        params: { skipClarifyingQuestions: true },
      }
    );

    const response = await POST(request);

    // Should succeed (201) — the completed run does not block a new one
    expect(response.status).toBe(201);
  });

  it("broadcasts a Pusher run-update event on successful run creation", async () => {
    const { pusherServer } = await import("@/lib/pusher");

    const request = createAuthenticatedPostRequest(BASE_URL, user, {
      type: "TASK_GENERATION",
      featureId: feature.id,
      workspaceId: workspace.id,
      autoAccept: true,
      params: { skipClarifyingQuestions: true },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    expect(pusherServer.trigger).toHaveBeenCalledWith(
      `workspace-${workspace.slug}`,
      "stakwork-run-update",
      expect.objectContaining({
        type: "TASK_GENERATION",
        status: WorkflowStatus.IN_PROGRESS,
        featureId: feature.id,
      }),
    );
  });

  it("run creation succeeds even when Pusher broadcast throws", async () => {
    const { pusherServer } = await import("@/lib/pusher");
    vi.mocked(pusherServer.trigger).mockRejectedValueOnce(
      new Error("Pusher unavailable"),
    );

    const request = createAuthenticatedPostRequest(BASE_URL, user, {
      type: "TASK_GENERATION",
      featureId: feature.id,
      workspaceId: workspace.id,
      autoAccept: true,
      params: { skipClarifyingQuestions: true },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const createdRun = await db.stakworkRun.findFirst({
      where: { featureId: feature.id, type: StakworkRunType.TASK_GENERATION },
    });
    expect(createdRun?.status).toBe(WorkflowStatus.IN_PROGRESS);
  });
});
