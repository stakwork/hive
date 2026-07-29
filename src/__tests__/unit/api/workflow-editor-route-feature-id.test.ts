/**
 * Unit tests verifying that the POST /api/workflow-editor route handler
 * forwards `featureId` in the Stakwork vars payload when the task has a featureId.
 */

import { NextRequest } from "next/server";
import { describe, test, expect, beforeEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db");
vi.mock("@/services/roadmap/feature-chat", () => ({
  resolveExtraSwarms: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    config: {
      ...actual.config,
      STAKWORK_API_KEY: "test-key",
      STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
      STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID: "123",
    },
  };
});
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue({ username: "user", token: "tok" }),
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue({}) },
  getTaskChannelName: vi.fn((id: string) => `task-${id}`),
  PUSHER_EVENTS: { NEW_MESSAGE: "new-message", WORKFLOW_STATUS_UPDATE: "workflow-status-update" },
}));
vi.mock("@/lib/utils", () => ({ getBaseUrl: vi.fn().mockReturnValue("http://localhost:3000") }));
vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn().mockReturnValue("http://swarm:3355"),
}));
vi.mock("@/lib/runtime", () => ({ isDevelopmentMode: vi.fn().mockReturnValue(false) }));
vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: vi.fn().mockReturnValue("{{HIVE_STAGING}}"),
}));
vi.mock("@/lib/helpers/chat-history", () => ({ fetchChatHistory: vi.fn().mockResolvedValue([]) }));
vi.mock("@/services/workflow-editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/workflow-editor")>();
  return {
    ...actual,
    fetchLatestWorkflowJson: vi.fn().mockResolvedValue(null),
    buildWorkflowEditorFeatureContext: vi.fn(),
  };
});

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { POST } from "@/app/api/workflow-editor/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { buildWorkflowEditorFeatureContext } from "@/services/workflow-editor";

const mockedDb = vi.mocked(db);
const mockGetServerSession = vi.mocked(getServerSession);
const mockGetToken = vi.mocked(getToken);
const mockBuildFeatureContext = vi.mocked(buildWorkflowEditorFeatureContext);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    workspaceId: "ws-1",
    featureId: "feature-1",
    workflowStatus: null,
    stakworkProjectId: null,
    workspace: {
      slug: "stakwork",
      ownerId: "user-1",
      members: [{ userId: "user-1" }],
      swarm: {
        swarmUrl: "http://swarm/api",
        swarmSecretAlias: "secret",
        poolName: "pool-1",
        name: "swarm-1",
        id: "swarm-id-1",
      },
    },
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/workflow-editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId: "task-1",
      message: "Update the workflow",
      workflowId: 42,
      workflowName: "My Workflow",
      workflowRefId: "ref-abc",
      stepName: "step",
      stepUniqueId: "uid-1",
      stepDisplayName: "Step",
      stepType: "workflow",
      stepData: {},
      ...body,
    }),
  });
}

function makeFeatureContext() {
  return {
    feature: { id: "feature-1", title: "Test Feature", brief: "brief", requirements: "reqs", architecture: "arch", userStories: [] },
    workspaceRepositories: [{ id: "repo-1", name: "hive", repositoryUrl: "https://github.com/org/hive", branch: "master" }],
    currentPhase: { name: "All Tasks", description: null, tickets: [] },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/workflow-editor — featureId in vars", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Authenticated user
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockGetToken.mockResolvedValue(null);

    // Task with featureId
    mockedDb.task = {
      findFirst: vi.fn().mockResolvedValue(makeTask()),
      update: vi.fn().mockResolvedValue({}),
    } as never;
    mockedDb.chatMessage = {
      create: vi.fn().mockResolvedValue({ id: "msg-1" }),
      update: vi.fn().mockResolvedValue({}),
    } as never;
    mockedDb.stakworkRun = {
      create: vi.fn().mockResolvedValue({}),
    } as never;
    mockedDb.artifact = {
      create: vi.fn().mockResolvedValue({}),
    } as never;

    // Successful Stakwork response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { project_id: 999 } }),
    }) as unknown as typeof fetch;
  });

  test("includes featureId in vars when task has a featureId", async () => {
    mockBuildFeatureContext.mockResolvedValue(makeFeatureContext() as never);

    const response = await POST(makeRequest());
    expect([200, 201]).toContain(response.status);

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    const vars = body.workflow_params.set_var.attributes.vars;

    expect(vars.featureId).toBe("feature-1");
    expect(vars.featureContext).toBeDefined();
    expect(vars.featureContext.feature.id).toBe("feature-1");
  });

  test("omits featureId from vars when task has no featureId", async () => {
    mockedDb.task = {
      findFirst: vi.fn().mockResolvedValue(makeTask({ featureId: null })),
      update: vi.fn().mockResolvedValue({}),
    } as never;

    const response = await POST(makeRequest());
    expect([200, 201]).toContain(response.status);

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    const vars = body.workflow_params.set_var.attributes.vars;

    expect(Object.prototype.hasOwnProperty.call(vars, "featureId")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(vars, "featureContext")).toBe(false);
  });

  test("includes featureId even when featureContext lookup returns null", async () => {
    mockBuildFeatureContext.mockResolvedValue(null);

    const response = await POST(makeRequest());
    expect([200, 201]).toContain(response.status);

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    const vars = body.workflow_params.set_var.attributes.vars;

    // featureId must still be set even if featureContext lookup failed
    expect(vars.featureId).toBe("feature-1");
    expect(Object.prototype.hasOwnProperty.call(vars, "featureContext")).toBe(false);
  });
});
