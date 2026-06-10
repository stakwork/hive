import { describe, test, expect, vi, beforeEach } from "vitest";
import { ArtifactType, ChatRole, ChatStatus } from "@/lib/chat";

// Mock dependencies before imports
vi.mock("@/lib/db", () => ({
  db: {
    chatMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    feature: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    artifact: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-key",
    STAKWORK_BASE_URL: "https://test.stakwork.com",
    STAKWORK_WORKFLOW_ID: "workflow-123",
  },
}));

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/file"),
  })),
}));
vi.mock("@/services/task-workflow", () => ({ callStakworkAPI: vi.fn().mockResolvedValue(null) }));
vi.mock("@/services/roadmap/orgContextScout", () => ({ scoutOrgContext: vi.fn().mockResolvedValue(null) }));
vi.mock("@/services/task-coordinator", () => ({ buildFeatureContext: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getFeatureChannelName: vi.fn().mockReturnValue("feature-channel"),
  PUSHER_EVENTS: { NEW_MESSAGE: "new-message", WORKFLOW_STATUS_UPDATE: "workflow-status" },
}));
vi.mock("@/lib/auth/nextauth", () => ({ getGithubUsernameAndPAT: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/helpers/repository", () => ({ joinRepoUrls: vi.fn().mockReturnValue("") }));
vi.mock("@/lib/utils/swarm", () => ({ transformSwarmUrlToRepo2Graph: vi.fn().mockReturnValue("") }));
vi.mock("@/lib/encryption", () => ({ EncryptionService: { getInstance: vi.fn(() => ({ decryptField: vi.fn().mockReturnValue("api-key") })) } }));

import { db } from "@/lib/db";
import { callStakworkAPI } from "@/services/task-workflow";
import { fetchFeatureChatHistory, sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import { joinRepoUrls } from "@/lib/helpers/repository";

const mockFindMany = db.chatMessage.findMany as ReturnType<typeof vi.fn>;
const mockCallStakworkAPI = vi.mocked(callStakworkAPI);

const makeMsg = (
  id: string,
  role: "USER" | "ASSISTANT",
  artifactTypes: ArtifactType[] = [],
  createdAt = new Date("2024-01-01T00:00:00Z"),
) => ({
  id,
  message: `message-${id}`,
  role,
  status: "SENT",
  createdAt,
  contextTags: null,
  artifacts: artifactTypes.map((type, i) => ({
    id: `artifact-${id}-${i}`,
    type,
    content: "{}",
    icon: null,
  })),
  attachments: [],
});

describe("fetchFeatureChatHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("only returns PLAN artifacts — STREAM artifacts are filtered at query level", async () => {
    // The DB query itself filters to PLAN only; simulate that by returning only PLAN artifacts
    mockFindMany.mockResolvedValue([
      makeMsg("msg-1", "USER"),
      makeMsg("msg-2", "ASSISTANT", [ArtifactType.PLAN]),
    ]);

    const result = await fetchFeatureChatHistory("feature-1", "current-msg");

    // Verify the query included the artifact filter
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          artifacts: {
            where: { type: ArtifactType.PLAN },
          },
        }),
      }),
    );

    const assistantMsg = result.find((m) => m.role === "ASSISTANT");
    const artifacts = assistantMsg?.artifacts as { type: string }[];
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe(ArtifactType.PLAN);
  });

  test("excludes the specified messageId from history", async () => {
    mockFindMany.mockResolvedValue([
      makeMsg("msg-1", "USER"),
      makeMsg("msg-2", "ASSISTANT", [ArtifactType.PLAN]),
    ]);

    await fetchFeatureChatHistory("feature-1", "msg-3");

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          featureId: "feature-1",
          id: { not: "msg-3" },
        }),
      }),
    );
  });

  test("returns messages ordered by createdAt ascending", async () => {
    mockFindMany.mockResolvedValue([
      makeMsg("msg-1", "USER", [], new Date("2024-01-01T00:00:00Z")),
      makeMsg("msg-2", "ASSISTANT", [ArtifactType.PLAN], new Date("2024-01-01T00:01:00Z")),
    ]);

    await fetchFeatureChatHistory("feature-1", "msg-3");

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "asc" },
      }),
    );
  });

  test("maps messages to expected shape", async () => {
    mockFindMany.mockResolvedValue([
      makeMsg("msg-1", "USER"),
      makeMsg("msg-2", "ASSISTANT", [ArtifactType.PLAN]),
    ]);

    const result = await fetchFeatureChatHistory("feature-1", "current-msg");

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "msg-1",
      role: "USER",
      artifacts: [],
    });
    expect(result[1]).toMatchObject({
      id: "msg-2",
      role: "ASSISTANT",
    });
    expect((result[1].artifacts as unknown[]).length).toBe(1);
  });

  test("returns empty array when no messages", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await fetchFeatureChatHistory("feature-1", "current-msg");
    expect(result).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests for the filteredHistory logic (inline, no DB required)
// Mirrors the filter applied in sendFeatureChatMessage after fetchFeatureChatHistory
// ──────────────────────────────────────────────────────────────────────────────

type HistoryMsg = {
  role: "USER" | "ASSISTANT";
  artifacts: { type: string }[];
};

function applyFilteredHistory(dbHistory: HistoryMsg[]): HistoryMsg[] {
  return dbHistory.filter((msg, idx) => {
    if (msg.role === "ASSISTANT") {
      return msg.artifacts.length > 0;
    }
    if (msg.role === "USER") {
      const nextAssistant = dbHistory
        .slice(idx + 1)
        .find((m) => m.role === "ASSISTANT");
      if (!nextAssistant) return false;
      return nextAssistant.artifacts.length > 0;
    }
    return true;
  });
}

describe("filteredHistory logic", () => {
  test("happy path: no failures — all pairs kept unchanged", () => {
    const history: HistoryMsg[] = [
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
    ];

    const filtered = applyFilteredHistory(history);
    expect(filtered).toHaveLength(4);
    expect(filtered[0].role).toBe("USER");
    expect(filtered[1].role).toBe("ASSISTANT");
    expect(filtered[2].role).toBe("USER");
    expect(filtered[3].role).toBe("ASSISTANT");
  });

  test("regression — USER messages present in multi-turn happy path", () => {
    const history: HistoryMsg[] = [
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
    ];

    const filtered = applyFilteredHistory(history);
    expect(filtered).toHaveLength(6);
    const userMessages = filtered.filter((m) => m.role === "USER");
    const assistantMessages = filtered.filter((m) => m.role === "ASSISTANT");
    expect(userMessages).toHaveLength(3);
    expect(assistantMessages).toHaveLength(3);
  });

  test("consecutive ASSISTANT messages — first USER excluded (next ASSISTANT has no artifact), second USER included", () => {
    // [USER, ASSISTANT(no artifact), ASSISTANT(PLAN), USER, ASSISTANT(PLAN)]
    const history: HistoryMsg[] = [
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [] }, // no artifact — first USER's next ASSISTANT
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
    ];

    const filtered = applyFilteredHistory(history);
    // First USER dropped (its next ASSISTANT has no artifact)
    // Second ASSISTANT(PLAN) kept, second USER kept, third ASSISTANT kept
    expect(filtered).toHaveLength(3);
    expect(filtered[0].role).toBe("ASSISTANT");
    expect(filtered[0].artifacts).toHaveLength(1);
    expect(filtered[1].role).toBe("USER");
    expect(filtered[2].role).toBe("ASSISTANT");
  });

  test("leading ASSISTANT before first USER — leading ASSISTANT kept, USER kept", () => {
    const history: HistoryMsg[] = [
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
    ];

    const filtered = applyFilteredHistory(history);
    expect(filtered).toHaveLength(3);
    expect(filtered[0].role).toBe("ASSISTANT");
    expect(filtered[1].role).toBe("USER");
    expect(filtered[2].role).toBe("ASSISTANT");
  });

  test("first message fails → retry: filteredHistory is [], isFirstMessage is true", () => {
    // Failed exchange: USER + ASSISTANT with no PLAN artifact
    const history: HistoryMsg[] = [
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [] }, // failed — no PLAN artifact
    ];

    const filtered = applyFilteredHistory(history);
    const isFirstMessage = filtered.length === 0;

    expect(filtered).toHaveLength(0);
    expect(isFirstMessage).toBe(true);
  });

  test("Nth message fails → retry: failed pair dropped, prior pairs kept", () => {
    // Two successful exchanges, then one failed exchange
    const history: HistoryMsg[] = [
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [] }, // failed — no PLAN artifact
    ];

    const filtered = applyFilteredHistory(history);
    const isFirstMessage = filtered.length === 0;

    // Only first two pairs survive
    expect(filtered).toHaveLength(4);
    expect(isFirstMessage).toBe(false);
    // The failed USER+ASSISTANT pair is gone
    expect(filtered.every((m) => m.role !== "ASSISTANT" || m.artifacts.length > 0)).toBe(true);
  });

  test("trailing USER with no following ASSISTANT is dropped", () => {
    const history: HistoryMsg[] = [
      { role: "USER", artifacts: [] },
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
      { role: "USER", artifacts: [] }, // orphaned — no ASSISTANT follows
    ];

    const filtered = applyFilteredHistory(history);
    expect(filtered).toHaveLength(2);
    expect(filtered[filtered.length - 1].role).toBe("ASSISTANT");
  });

  test("consecutive USER messages — both kept when the following ASSISTANT has a PLAN artifact", () => {
    const history: HistoryMsg[] = [
      { role: "USER", artifacts: [] },
      { role: "USER", artifacts: [] }, // next ASSISTANT (found via slice.find) has PLAN
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
    ];

    const filtered = applyFilteredHistory(history);
    // Both USERs kept — each finds the ASSISTANT ahead with a PLAN artifact
    expect(filtered).toHaveLength(3);
    expect(filtered[0].role).toBe("USER");
    expect(filtered[1].role).toBe("USER");
    expect(filtered[2].role).toBe("ASSISTANT");
  });

  test("empty history returns empty, isFirstMessage is true", () => {
    const filtered = applyFilteredHistory([]);
    expect(filtered).toHaveLength(0);
    expect(filtered.length === 0).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests for sendFeatureChatMessage — model (taskModel) forwarding
// ──────────────────────────────────────────────────────────────────────────────

function makeFeature(overrides: Record<string, unknown> = {}) {
  return {
    id: "feature-123",
    workspaceId: "workspace-1",
    planUpdatedAt: null,
    workflowStatus: "PENDING",
    selectedRepositoryIds: [],
    phases: [],
    workspace: {
      slug: "test-workspace",
      ownerId: "user-123",
      sourceControlOrgId: null,
      sourceControlOrg: null,
      swarm: {
        swarmUrl: "https://swarm.test.com/api",
        swarmSecretAlias: "alias",
        poolName: "pool-1",
        id: "swarm-id",
        swarmApiKey: null,
      },
      members: [],
      repositories: [],
    },
    ...overrides,
  };
}

function makeChatMsg() {
  return {
    id: "msg-new",
    featureId: "feature-123",
    userId: "user-123",
    message: "Test message",
    role: ChatRole.USER,
    status: ChatStatus.SENT,
    contextTags: "[]",
    sourceWebsocketID: null,
    replyId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    artifacts: [],
    attachments: [],
    createdBy: { id: "user-123", name: "Test", email: "test@test.com", image: null },
  };
}

describe("sendFeatureChatMessage — taskModel forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.feature.findUnique).mockResolvedValue(makeFeature() as any);
    vi.mocked(db.chatMessage.create).mockResolvedValue(makeChatMsg() as any);
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);
    vi.mocked(db.feature.update).mockResolvedValue({} as any);
    mockCallStakworkAPI.mockResolvedValue({ error: "mock - no stakwork in tests" });
  });

  test("passes taskModel to callStakworkAPI when model param is provided", async () => {
    await sendFeatureChatMessage({
      featureId: "feature-123",
      userId: "user-123",
      message: "Hello",
      model: "opus",
    });

    expect(mockCallStakworkAPI).toHaveBeenCalledOnce();
    const callArg = mockCallStakworkAPI.mock.calls[0][0];
    expect(callArg.taskModel).toBe("opus");
  });

  test("passes undefined taskModel when model param is omitted", async () => {
    await sendFeatureChatMessage({
      featureId: "feature-123",
      userId: "user-123",
      message: "Hello",
    });

    expect(mockCallStakworkAPI).toHaveBeenCalledOnce();
    const callArg = mockCallStakworkAPI.mock.calls[0][0];
    expect(callArg.taskModel).toBeUndefined();
  });

  test.each(["sonnet", "haiku", "kimi", "gemini", "gpt"] as const)(
    "forwards model '%s' as taskModel to callStakworkAPI",
    async (model) => {
      await sendFeatureChatMessage({
        featureId: "feature-123",
        userId: "user-123",
        message: "Hello",
        model,
      });

      const callArg = mockCallStakworkAPI.mock.calls[0][0];
      expect(callArg.taskModel).toBe(model);
    }
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests for sendFeatureChatMessage — selectedRepositoryIds filtering
// ──────────────────────────────────────────────────────────────────────────────

describe("sendFeatureChatMessage — selectedRepositoryIds filtering", () => {
  const repo1 = { id: "repo-1", name: "alpha", repositoryUrl: "https://github.com/org/alpha", branch: "main" };
  const repo2 = { id: "repo-2", name: "beta", repositoryUrl: "https://github.com/org/beta", branch: "main" };
  const repo3 = { id: "repo-3", name: "gamma", repositoryUrl: "https://github.com/org/gamma", branch: "main" };

  const mockJoinRepoUrls = vi.mocked(joinRepoUrls);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.chatMessage.create).mockResolvedValue(makeChatMsg() as any);
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);
    vi.mocked(db.feature.update).mockResolvedValue({} as any);
    mockCallStakworkAPI.mockResolvedValue(null);
    mockJoinRepoUrls.mockImplementation((repos) =>
      repos.map((r) => r.repositoryUrl).join(",")
    );
  });

  test("selectedRepositoryIds param provided → DB updated with those IDs and filtered repos used", async () => {
    vi.mocked(db.feature.findUnique).mockResolvedValue(
      makeFeature({
        selectedRepositoryIds: [],
        workspace: {
          slug: "test-workspace",
          ownerId: "user-123",
          sourceControlOrgId: null,
          sourceControlOrg: null,
          swarm: { swarmUrl: "https://swarm.test.com/api", swarmSecretAlias: "alias", poolName: "pool-1", id: "swarm-id", swarmApiKey: null },
          members: [],
          repositories: [repo1, repo2, repo3],
        },
      }) as any,
    );

    await sendFeatureChatMessage({
      featureId: "feature-123",
      userId: "user-123",
      message: "Hello",
      selectedRepositoryIds: ["repo-1", "repo-2"],
    });

    // DB persisted the selection
    expect(vi.mocked(db.feature.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feature-123" },
        data: { selectedRepositoryIds: ["repo-1", "repo-2"] },
      }),
    );

    // joinRepoUrls received only the two selected repos
    expect(mockJoinRepoUrls).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "repo-1" }),
        expect.objectContaining({ id: "repo-2" }),
      ]),
    );
    const passedRepos = mockJoinRepoUrls.mock.calls[0][0];
    expect(passedRepos).toHaveLength(2);
    expect(passedRepos.map((r: { id: string }) => r.id)).toEqual(
      expect.arrayContaining(["repo-1", "repo-2"]),
    );
  });

  test("empty selectedRepositoryIds param + stored IDs → stored selection applied", async () => {
    vi.mocked(db.feature.findUnique).mockResolvedValue(
      makeFeature({
        selectedRepositoryIds: ["repo-3"],
        workspace: {
          slug: "test-workspace",
          ownerId: "user-123",
          sourceControlOrgId: null,
          sourceControlOrg: null,
          swarm: { swarmUrl: "https://swarm.test.com/api", swarmSecretAlias: "alias", poolName: "pool-1", id: "swarm-id", swarmApiKey: null },
          members: [],
          repositories: [repo1, repo2, repo3],
        },
      }) as any,
    );

    await sendFeatureChatMessage({
      featureId: "feature-123",
      userId: "user-123",
      message: "Hello",
      // no selectedRepositoryIds provided
    });

    // No DB update for selectedRepositoryIds (follow-up mode)
    expect(vi.mocked(db.feature.update)).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ selectedRepositoryIds: expect.anything() }) }),
    );

    // joinRepoUrls received only repo-3
    const passedRepos = mockJoinRepoUrls.mock.calls[0][0];
    expect(passedRepos).toHaveLength(1);
    expect(passedRepos[0].id).toBe("repo-3");
  });

  test("both param and stored IDs empty → all repos fallback", async () => {
    vi.mocked(db.feature.findUnique).mockResolvedValue(
      makeFeature({
        selectedRepositoryIds: [],
        workspace: {
          slug: "test-workspace",
          ownerId: "user-123",
          sourceControlOrgId: null,
          sourceControlOrg: null,
          swarm: { swarmUrl: "https://swarm.test.com/api", swarmSecretAlias: "alias", poolName: "pool-1", id: "swarm-id", swarmApiKey: null },
          members: [],
          repositories: [repo1, repo2, repo3],
        },
      }) as any,
    );

    await sendFeatureChatMessage({
      featureId: "feature-123",
      userId: "user-123",
      message: "Hello",
    });

    const passedRepos = mockJoinRepoUrls.mock.calls[0][0];
    expect(passedRepos).toHaveLength(3);
  });

  test("filter produces no matches → falls back to all repos", async () => {
    vi.mocked(db.feature.findUnique).mockResolvedValue(
      makeFeature({
        selectedRepositoryIds: [],
        workspace: {
          slug: "test-workspace",
          ownerId: "user-123",
          sourceControlOrgId: null,
          sourceControlOrg: null,
          swarm: { swarmUrl: "https://swarm.test.com/api", swarmSecretAlias: "alias", poolName: "pool-1", id: "swarm-id", swarmApiKey: null },
          members: [],
          repositories: [repo1, repo2],
        },
      }) as any,
    );

    await sendFeatureChatMessage({
      featureId: "feature-123",
      userId: "user-123",
      message: "Hello",
      selectedRepositoryIds: ["repo-999"], // non-existent ID
    });

    // DB was updated with the IDs (persist happened)
    expect(vi.mocked(db.feature.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { selectedRepositoryIds: ["repo-999"] },
      }),
    );

    // Fell back to all repos because filter matched nothing
    const passedRepos = mockJoinRepoUrls.mock.calls[0][0];
    expect(passedRepos).toHaveLength(2);
  });
});

