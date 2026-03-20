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

    user = await db.users.create({
      data: {
        id: generateUniqueId("user"),
        email: `owner-${generateUniqueId()}@test.com`,
        name: "Test Owner",
      },
    });

    workspace = await db.workspaces.create({
      data: {
        name: `Test WS ${generateUniqueId()}`,
        slug: generateUniqueSlug("gen-ws"),owner_id: user.id,
      },
    });

    await db.workspace_members.create({
      data: {workspace_id: workspace.id,user_id: user.id, role: "OWNER" },
    });

    feature = await db.features.create({
      data: {
        title: "Test Feature",workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
        // Provide required architecture so the guard is the only blocker
        architecture: "Some architecture text",
      },
    });

    // Create a default phase so TASK_GENERATION can resolve it
    await db.phases.create({
      data: {
        name: "Phase 1",feature_id: feature.id,
        order: 0,
      },
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("returns 409 with existingRunId when a PENDING TASK_GENERATION run already exists", async () => {
    // Seed an active run directly in the DB
    const activeRun = await db.stakwork_runs.create({
      data: {
        type: StakworkRunType.TASK_GENERATION,workspace_id: workspace.id,feature_id: feature.id,
        status: WorkflowStatus.PENDING,webhook_url: "http://example.com/webhook",data_type: "string",
      },
    });

    const request = createAuthenticatedPostRequest(
      BASE_URL,
      user,
      {
        type: "TASK_GENERATION",feature_id: feature.id,workspace_id: workspace.id,auto_accept: true,
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
    const activeRun = await db.stakwork_runs.create({
      data: {
        type: StakworkRunType.TASK_GENERATION,workspace_id: workspace.id,feature_id: feature.id,
        status: WorkflowStatus.IN_PROGRESS,project_id: 123,webhook_url: "http://example.com/webhook",data_type: "string",
      },
    });

    const request = createAuthenticatedPostRequest(
      BASE_URL,
      user,
      {
        type: "TASK_GENERATION",feature_id: feature.id,workspace_id: workspace.id,auto_accept: true,
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
    await db.stakwork_runs.create({
      data: {
        type: StakworkRunType.TASK_GENERATION,workspace_id: workspace.id,feature_id: feature.id,
        status: WorkflowStatus.COMPLETED,webhook_url: "http://example.com/webhook",data_type: "string",
      },
    });

    const request = createAuthenticatedPostRequest(
      BASE_URL,
      user,
      {
        type: "TASK_GENERATION",feature_id: feature.id,workspace_id: workspace.id,auto_accept: true,
        params: { skipClarifyingQuestions: true },
      }
    );

    const response = await POST(request);

    // Should succeed (201) — the completed run does not block a new one
    expect(response.status).toBe(201);
  });
});
