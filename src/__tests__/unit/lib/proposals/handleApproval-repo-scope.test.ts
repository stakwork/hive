/**
 * Unit tests for approveFeature — selectedRepositoryIds IDOR guard and forwarding.
 *
 * Tests that:
 * 1. A valid subset of repo ids is forwarded to sendFeatureChatMessage.
 * 2. Foreign / stale ids are dropped (IDOR guard — intersection with workspace repos).
 * 3. An all-foreign list falls back to undefined (all-repos default).
 * 4. Omitting selectedRepositoryIds → undefined forwarded (all-repos default).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PROPOSE_FEATURE_TOOL, type ProposalOutput } from "@/lib/proposals/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    initiative: { create: vi.fn(), findFirst: vi.fn() },
    workspace: { findFirst: vi.fn() },
    milestone: { findFirst: vi.fn() },
    feature: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/canvas", () => ({
  notifyCanvasUpdated: vi.fn(),
  setLivePosition: vi.fn(),
  featureProjectsOn: vi.fn(),
  mostSpecificRef: vi.fn(),
  resolvePlacement: vi.fn().mockReturnValue(null),
  ROOT_REF: "",
  notifyFeatureReassignmentRefresh: vi.fn(),
}));

vi.mock("@/services/roadmap", () => ({
  createFeature: vi.fn(),
}));

vi.mock("@/services/roadmap/feature-dependency", () => ({
  detectFeatureDependencyCycle: vi.fn().mockResolvedValue({ ok: true }),
}));

const mockSendFeatureChatMessage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/roadmap/feature-chat", () => ({
  sendFeatureChatMessage: (...args: unknown[]) =>
    mockSendFeatureChatMessage(...args),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { handleApproval } from "@/lib/proposals/handleApproval";
import { db } from "@/lib/db";
import { createFeature } from "@/services/roadmap";

// ── Helpers ───────────────────────────────────────────────────────────────────

function featureMessage(proposalId: string, title = "My Feature") {
  return {
    role: "assistant" as const,
    toolCalls: [
      {
        toolName: PROPOSE_FEATURE_TOOL,
        output: {
          kind: "feature",
          proposalId,
          payload: {
            title,
            workspaceId: "ws_1",
            initialMessage: "Build it",
          },
        } satisfies ProposalOutput,
      },
    ],
  };
}

/**
 * Configure the workspace mock with the given repository ids.
 * The new code selects `repositories: { select: { id: true } }` so
 * `workspace.repositories` must be present for the IDOR guard to work.
 */
function setupWorkspace(repoIds: string[]) {
  (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "ws_1",
    slug: "my-workspace",
    repositories: repoIds.map((id) => ({ id })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (createFeature as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "feat_new",
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("approveFeature — selectedRepositoryIds forwarding", () => {
  it("forwards validated selectedRepositoryIds to sendFeatureChatMessage when all ids belong to workspace", async () => {
    setupWorkspace(["repo-1", "repo-2", "repo-3"]);

    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [featureMessage("p_feat_repo1")],
      intent: {
        proposalId: "p_feat_repo1",
        payload: { selectedRepositoryIds: ["repo-1", "repo-2"] },
      },
    });

    expect(mockSendFeatureChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedRepositoryIds: ["repo-1", "repo-2"],
      }),
    );
  });

  it("omits selectedRepositoryIds from sendFeatureChatMessage when payload has none (all-repos default)", async () => {
    setupWorkspace(["repo-1", "repo-2"]);

    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [featureMessage("p_feat_no_repo")],
      intent: {
        proposalId: "p_feat_no_repo",
        // No selectedRepositoryIds in payload
        payload: { autoRespond: false },
      },
    });

    // Called without selectedRepositoryIds key
    expect(mockSendFeatureChatMessage).toHaveBeenCalledWith(
      expect.not.objectContaining({ selectedRepositoryIds: expect.anything() }),
    );
  });
});

describe("approveFeature — selectedRepositoryIds IDOR guard", () => {
  it("drops foreign ids and forwards only the intersection with workspace repos", async () => {
    setupWorkspace(["repo-1", "repo-2"]);

    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [featureMessage("p_feat_idor1")],
      intent: {
        proposalId: "p_feat_idor1",
        payload: {
          // repo-1 belongs to workspace; foreign-id does not
          selectedRepositoryIds: ["repo-1", "foreign-id"],
        },
      },
    });

    expect(mockSendFeatureChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedRepositoryIds: ["repo-1"],
      }),
    );
  });

  it("falls back to all-repos (undefined) when ALL forwarded ids are foreign", async () => {
    setupWorkspace(["repo-1", "repo-2"]);

    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [featureMessage("p_feat_idor2")],
      intent: {
        proposalId: "p_feat_idor2",
        payload: {
          selectedRepositoryIds: ["totally-foreign-1", "totally-foreign-2"],
        },
      },
    });

    // All-foreign: sendFeatureChatMessage must NOT receive selectedRepositoryIds
    expect(mockSendFeatureChatMessage).toHaveBeenCalledWith(
      expect.not.objectContaining({ selectedRepositoryIds: expect.anything() }),
    );
  });

  it("does not forward an empty array even if selectedRepositoryIds is empty in the payload", async () => {
    setupWorkspace(["repo-1", "repo-2"]);

    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [featureMessage("p_feat_empty")],
      intent: {
        proposalId: "p_feat_empty",
        payload: {
          selectedRepositoryIds: [], // empty — should be treated as omitted
        },
      },
    });

    expect(mockSendFeatureChatMessage).toHaveBeenCalledWith(
      expect.not.objectContaining({ selectedRepositoryIds: expect.anything() }),
    );
  });

  it("forwards all ids when the full set matches the workspace repos exactly", async () => {
    setupWorkspace(["repo-A", "repo-B", "repo-C"]);

    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [featureMessage("p_feat_all")],
      intent: {
        proposalId: "p_feat_all",
        payload: { selectedRepositoryIds: ["repo-A", "repo-B", "repo-C"] },
      },
    });

    expect(mockSendFeatureChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedRepositoryIds: expect.arrayContaining(["repo-A", "repo-B", "repo-C"]),
      }),
    );
    const call = mockSendFeatureChatMessage.mock.calls[0][0];
    expect(call.selectedRepositoryIds).toHaveLength(3);
  });
});
