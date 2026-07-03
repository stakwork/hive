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
    workspace: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
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

vi.mock("@/lib/mcp/workspaceTokenMint", () => ({
  mintWorkspaceToken: vi.fn().mockResolvedValue({ ok: false, error: "disabled" }),
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn(() => false),
}));

// ─── Subject ──────────────────────────────────────────────────────────────────

import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { callStakworkAPI } from "@/services/task-workflow";

const mockedDb = vi.mocked(db);
const mockedCallStakwork = vi.mocked(callStakworkAPI);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFeature(id = "feature-1", slugOverride?: string) {
  return {
    id,
    workspaceId: "ws-1",
    workflowStatus: null,
    model: null,
    planUpdatedAt: new Date(),
    selectedRepositoryIds: [],
    phases: [],
    workspace: {
      slug: slugOverride ?? "test-workspace",
      ownerId: "user-1",
      sourceControlOrgId: "org-1",
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
      repositories: [],
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

import { isDevelopmentMode } from "@/lib/runtime";

const mockIsDevelopmentMode = vi.mocked(isDevelopmentMode);

// ── Helpers for sub-agent workspace fixture ──────────────────────────────────

function makeOrgWorkspace(slug: string) {
  return {
    id: `ws-${slug}`,
    slug,
    description: `Org workspace ${slug}`,
    deleted: false,
    ownerId: "user-1",
    sourceControlOrgId: "org-1",
    swarm: {
      id: `swarm-${slug}`,
      swarmUrl: `https://${slug}.swarm.example.com/api`,
      swarmApiKey: `encrypted-key-${slug}`,
    },
    repositories: [{ repositoryUrl: `https://github.com/org/${slug}` }],
  };
}

describe("sendFeatureChatMessage — plan_mode subAgents auto-attach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDevelopmentMode.mockReturnValue(false);
    mockedDb.feature.findUnique = vi.fn().mockResolvedValue(makeFeature()) as never;
    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({ id: "msg-1" }) as never;
    mockedDb.feature.update = vi.fn().mockResolvedValue({}) as never;
    mockedDb.stakworkRun.create = vi.fn().mockResolvedValue({}) as never;
    // Default: no workspace.findFirst (for @mentions) and no workspace.findMany (for org)
    (mockedDb as unknown as Record<string, unknown>).workspace = {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    };
  });

  test("auto-attaches org member workspaces on stakwork workspace (gated on)", async () => {
    mockedDb.feature.findUnique = vi.fn().mockResolvedValue(makeFeature("feature-1", "stakwork")) as never;
    const orgWs = makeOrgWorkspace("org-ws-1");
    (mockedDb as unknown as Record<string, unknown>).workspace = {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([orgWs]),
    };
    mockedCallStakwork.mockResolvedValue({ projectId: 42, success: true } as never);

    await sendFeatureChatMessage({ featureId: "feature-1", userId: "user-1", message: "plan this" });

    expect(mockedCallStakwork).toHaveBeenCalledWith(
      expect.objectContaining({
        subAgents: expect.arrayContaining([expect.objectContaining({ name: "org-ws-1" })]),
      }),
    );
  });

  test("auto-attaches org member workspaces in isDevelopmentMode (gated on)", async () => {
    mockIsDevelopmentMode.mockReturnValue(true);
    mockedDb.feature.findUnique = vi.fn().mockResolvedValue(makeFeature("feature-1", "some-other-ws")) as never;
    const orgWs = makeOrgWorkspace("org-ws-dev");
    (mockedDb as unknown as Record<string, unknown>).workspace = {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([orgWs]),
    };
    mockedCallStakwork.mockResolvedValue({ projectId: 42, success: true } as never);

    await sendFeatureChatMessage({ featureId: "feature-1", userId: "user-1", message: "plan this" });

    expect(mockedCallStakwork).toHaveBeenCalledWith(
      expect.objectContaining({
        subAgents: expect.arrayContaining([expect.objectContaining({ name: "org-ws-dev" })]),
      }),
    );
  });

  test("falls back to mentions-only resolveExtraSwarms outside stakwork/dev (gated off)", async () => {
    mockIsDevelopmentMode.mockReturnValue(false);
    // non-stakwork slug
    mockedDb.feature.findUnique = vi.fn().mockResolvedValue(makeFeature("feature-1", "other-slug")) as never;
    const ws = makeOrgWorkspace("mentioned-ws");
    (mockedDb as unknown as Record<string, unknown>).workspace = {
      findFirst: vi.fn().mockResolvedValue(ws),
      findMany: vi.fn().mockResolvedValue([]),
    };
    mockedCallStakwork.mockResolvedValue({ projectId: 42, success: true } as never);

    await sendFeatureChatMessage({
      featureId: "feature-1",
      userId: "user-1",
      message: "@mentioned-ws help",
    });

    // resolveExtraSwarms is called (not resolveSubAgents) — org findMany NOT called
    const ws_mock = (mockedDb as unknown as { workspace: { findMany: ReturnType<typeof vi.fn> } }).workspace;
    expect(ws_mock.findMany).not.toHaveBeenCalled();
  });

  test("unions @mentions with org workspaces (manual mention wins on conflict)", async () => {
    mockedDb.feature.findUnique = vi.fn().mockResolvedValue(makeFeature("feature-1", "stakwork")) as never;
    const mentionedWs = makeOrgWorkspace("shared-ws");
    const orgWs = makeOrgWorkspace("auto-ws");
    // @mention resolves shared-ws via findFirst
    (mockedDb as unknown as Record<string, unknown>).workspace = {
      findFirst: vi.fn().mockResolvedValue(mentionedWs),
      // org returns both (shared-ws deduped, auto-ws is new)
      findMany: vi.fn().mockResolvedValue([makeOrgWorkspace("shared-ws"), orgWs]),
    };
    mockedCallStakwork.mockResolvedValue({ projectId: 42, success: true } as never);

    await sendFeatureChatMessage({
      featureId: "feature-1",
      userId: "user-1",
      message: "@shared-ws do something",
    });

    const callArgs = mockedCallStakwork.mock.calls[0][0] as { subAgents: { name: string }[] };
    const names = callArgs.subAgents.map((a) => a.name);
    // Both present, no duplicates
    expect(names).toContain("shared-ws");
    expect(names).toContain("auto-ws");
    expect(names.filter((n) => n === "shared-ws")).toHaveLength(1);
  });

  test("passes empty subAgents when org has no accessible workspaces and no mentions (single-ws org)", async () => {
    mockedDb.feature.findUnique = vi.fn().mockResolvedValue(makeFeature("feature-1", "stakwork")) as never;
    (mockedDb as unknown as Record<string, unknown>).workspace = {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    };
    mockedCallStakwork.mockResolvedValue({ projectId: 42, success: true } as never);

    await sendFeatureChatMessage({ featureId: "feature-1", userId: "user-1", message: "plan this" });

    const callArgs = mockedCallStakwork.mock.calls[0][0] as { subAgents?: unknown[] };
    // subAgents is either absent or empty — either is correct
    expect(!callArgs.subAgents || callArgs.subAgents.length === 0).toBe(true);
  });
});
