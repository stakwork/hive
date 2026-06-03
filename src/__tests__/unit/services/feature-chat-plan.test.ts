/**
 * Unit tests for PLAN_CHAT StakworkRun creation in sendFeatureChatMessage
 * (src/services/roadmap/feature-chat.ts)
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    chatMessage: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    feature: { findUnique: vi.fn(), update: vi.fn() },
    artifact: { findFirst: vi.fn().mockResolvedValue(null) },
    stakworkRun: { create: vi.fn() },
  },
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-key",
    STAKWORK_BASE_URL: "https://test.stakwork.com",
    STAKWORK_WORKFLOW_ID: "10",
  },
}));

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/file"),
  })),
}));

vi.mock("@/services/task-workflow", () => ({
  callStakworkAPI: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/roadmap/orgContextScout", () => ({
  scoutOrgContext: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/task-coordinator", () => ({
  buildFeatureContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getFeatureChannelName: vi.fn().mockReturnValue("feature-channel"),
  PUSHER_EVENTS: { NEW_MESSAGE: "new-message", WORKFLOW_STATUS_UPDATE: "workflow-status" },
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/helpers/repository", () => ({
  joinRepoUrls: vi.fn().mockReturnValue(""),
}));

vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn().mockReturnValue(""),
  extractSwarmSuffix: vi.fn().mockReturnValue("suffix-1"),
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({ decryptField: vi.fn().mockReturnValue("api-key") })),
  },
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn().mockReturnValue("http://localhost:3000"),
}));

vi.mock("@/lib/mcp/orgTokenMint", () => ({
  mintOrgToken: vi.fn().mockResolvedValue({ token: null, error: null }),
}));

// ─── Subject ──────────────────────────────────────────────────────────────────

import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { callStakworkAPI } from "@/services/task-workflow";

const mockedDb = vi.mocked(db);
const mockedCallStakwork = vi.mocked(callStakworkAPI);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFeature(id = "feature-1") {
  return {
    id,
    workspaceId: "ws-1",
    workflowStatus: null,
    model: null,
    planUpdatedAt: new Date(),
    phases: [],
    workspace: {
      slug: "test-workspace",
      ownerId: "user-1",
      sourceControlOrg: null,
      swarm: {
        swarmUrl: "http://swarm/api",
        swarmSecretAlias: "secret",
        poolName: "pool-1",
        name: "swarm-1",
        id: "swarm-id-1",
        apiKey: "api-key",
        agentApiKey: "agent-key",
      },
      members: [{ userId: "user-1", role: "OWNER" }],
      extraSwarms: [],
      mcpServers: [],
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("sendFeatureChatMessage — PLAN_CHAT StakworkRun creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.feature.findUnique = vi.fn().mockResolvedValue(makeFeature()) as never;
    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({ id: "msg-1" }) as never;
    mockedDb.feature.update = vi.fn().mockResolvedValue({}) as never;
    mockedDb.stakworkRun.create = vi.fn().mockResolvedValue({}) as never;
  });

  test("creates StakworkRun with PLAN_CHAT type when Stakwork returns a projectId", async () => {
    mockedCallStakwork.mockResolvedValue({ projectId: 42, success: true } as never);

    await sendFeatureChatMessage({
      featureId: "feature-1",
      userId: "user-1",
      message: "Plan my feature",
    });

    expect(mockedDb.stakworkRun.create).toHaveBeenCalledWith({
      data: {
        type: "PLAN_CHAT",
        featureId: "feature-1",
        workspaceId: "ws-1",
        projectId: 42,
        status: WorkflowStatus.IN_PROGRESS,
        webhookUrl: "http://localhost:3000/api/stakwork/webhook?task_id=feature-1",
      },
    });
  });

  test("does NOT create StakworkRun when Stakwork returns no projectId", async () => {
    mockedCallStakwork.mockResolvedValue({ projectId: null, success: false } as never);

    await sendFeatureChatMessage({
      featureId: "feature-1",
      userId: "user-1",
      message: "Plan my feature",
    });

    expect(mockedDb.stakworkRun.create).not.toHaveBeenCalled();
  });

  test("does NOT create StakworkRun when callStakworkAPI returns null", async () => {
    mockedCallStakwork.mockResolvedValue(null as never);

    await sendFeatureChatMessage({
      featureId: "feature-1",
      userId: "user-1",
      message: "Plan my feature",
    });

    expect(mockedDb.stakworkRun.create).not.toHaveBeenCalled();
  });

  test("webhookUrl contains the correct featureId in the query param", async () => {
    mockedDb.feature.findUnique = vi.fn().mockResolvedValue(makeFeature("feature-abc")) as never;
    mockedCallStakwork.mockResolvedValue({ projectId: 99, success: true } as never);

    await sendFeatureChatMessage({
      featureId: "feature-abc",
      userId: "user-1",
      message: "Plan my feature",
    });

    const createCall = (mockedDb.stakworkRun.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.data.webhookUrl).toBe(
      "http://localhost:3000/api/stakwork/webhook?task_id=feature-abc",
    );
    expect(createCall.data.featureId).toBe("feature-abc");
  });
});
