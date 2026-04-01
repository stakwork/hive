import { describe, test, expect, vi, beforeEach } from "vitest";
import { ArtifactType } from "@/lib/chat";

// Mock dependencies before imports
vi.mock("@/lib/db", () => ({
  db: {
    chatMessage: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/config/env", () => ({
  config: {
    stakworkApiKey: "test-key",
    stakworkApiUrl: "https://test.stakwork.com",
  },
}));

vi.mock("@/services/s3", () => ({ getS3Service: vi.fn() }));
vi.mock("@/services/task-workflow", () => ({ callStakworkAPI: vi.fn() }));
vi.mock("@/services/task-coordinator", () => ({ buildFeatureContext: vi.fn() }));
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getFeatureChannelName: vi.fn(),
  PUSHER_EVENTS: {},
}));
vi.mock("@/lib/auth/nextauth", () => ({ getGithubUsernameAndPAT: vi.fn() }));
vi.mock("@/lib/helpers/repository", () => ({ joinRepoUrls: vi.fn() }));
vi.mock("@/lib/utils/swarm", () => ({ transformSwarmUrlToRepo2Graph: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ EncryptionService: vi.fn() }));

import { db } from "@/lib/db";
import { fetchFeatureChatHistory } from "@/services/roadmap/feature-chat";

const mockFindMany = db.chatMessage.findMany as ReturnType<typeof vi.fn>;

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
      const next = dbHistory[idx + 1];
      if (!next || next.role !== "ASSISTANT") return false;
      return next.artifacts.length > 0;
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

  test("USER followed by another USER (no ASSISTANT) is dropped", () => {
    const history: HistoryMsg[] = [
      { role: "USER", artifacts: [] },
      { role: "USER", artifacts: [] }, // next is not ASSISTANT
      { role: "ASSISTANT", artifacts: [{ type: "PLAN" }] },
    ];

    const filtered = applyFilteredHistory(history);
    // First USER dropped (next is USER, not ASSISTANT)
    // Second USER kept (next is ASSISTANT with PLAN)
    expect(filtered).toHaveLength(2);
    expect(filtered[0].role).toBe("USER");
    expect(filtered[1].role).toBe("ASSISTANT");
  });

  test("empty history returns empty, isFirstMessage is true", () => {
    const filtered = applyFilteredHistory([]);
    expect(filtered).toHaveLength(0);
    expect(filtered.length === 0).toBe(true);
  });
});
