/**
 * Unit tests for viewport-aware placement in handleApproval.ts.
 *
 * Tests focus on the three approval paths:
 *   - approveInitiative: new fallback branch after resolvePlacement → null
 *   - approveFeature: viewportState replaces legacy {40,40} fallback
 *   - approveMilestone: same pattern as approveFeature
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_FEATURE_TOOL,
  PROPOSE_MILESTONE_TOOL,
  type ProposalOutput,
  type ApprovalResult,
  type ApprovalIntent,
} from "@/lib/proposals/types";

// ─── Mock external dependencies ───────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    initiative: { create: vi.fn(), findFirst: vi.fn() },
    workspace: { findFirst: vi.fn() },
    milestone: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      $transaction: vi.fn(),
    },
    feature: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const mockResolvePlacement = vi.fn().mockResolvedValue(null);
const mockFindFreeSlotInViewport = vi.fn();
const mockSetLivePosition = vi.fn().mockResolvedValue(undefined);
const mockReadCanvas = vi.fn().mockResolvedValue({ nodes: [] });

vi.mock("@/lib/canvas", () => ({
  notifyCanvasUpdated: vi.fn(),
  setLivePosition: (...args: unknown[]) => mockSetLivePosition(...args),
  featureProjectsOn: vi.fn().mockReturnValue(true),
  mostSpecificRef: vi.fn().mockReturnValue("initiative:init_1"),
  readAssignedFeatures: vi.fn().mockResolvedValue([]),
  resolvePlacement: (...args: unknown[]) => mockResolvePlacement(...args),
  findFreeSlotInViewport: (...args: unknown[]) => mockFindFreeSlotInViewport(...args),
  ROOT_REF: "",
  notifyFeatureReassignmentRefresh: vi.fn(),
  assignFeatureOnCanvas: vi.fn(),
}));

vi.mock("@/lib/canvas/io", () => ({
  readCanvas: (...args: unknown[]) => mockReadCanvas(...args),
}));

vi.mock("@/lib/canvas/geometry", () => ({
  INITIATIVE_W: 320,
  INITIATIVE_H: 120,
  FEATURE_W: 260,
  FEATURE_H: 100,
  MILESTONE_W: 280,
  MILESTONE_H: 110,
  CARD_W: 320,
  CARD_H: 120,
  ROW_GAP: 20,
  SMALL_W: 200,
  RESEARCH_W: 300,
  RESEARCH_H: 200,
}));

vi.mock("@/services/roadmap", () => ({
  createFeature: vi.fn().mockResolvedValue({ id: "feat_new" }),
}));

vi.mock("@/services/roadmap/feature-dependency", () => ({
  detectFeatureDependencyCycle: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/services/roadmap/feature-chat", () => ({
  sendFeatureChatMessage: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import the module AFTER mocks are set up ─────────────────────────
import { handleApproval } from "@/lib/proposals/handleApproval";
import { db } from "@/lib/db";

// ─── Helpers ──────────────────────────────────────────────────────────

const VIEWPORT_STATE = {
  canvasX: 100,
  canvasY: 100,
  canvasW: 800,
  canvasH: 600,
};

const FREE_SLOT = { x: 120, y: 120 };

function initiativeMessage(proposalId: string) {
  return {
    role: "assistant" as const,
    toolCalls: [
      {
        toolName: PROPOSE_INITIATIVE_TOOL,
        output: {
          kind: "initiative" as const,
          proposalId,
          payload: { name: "Test Initiative" },
        } satisfies ProposalOutput,
      },
    ],
  };
}

function featureMessage(proposalId: string) {
  return {
    role: "assistant" as const,
    toolCalls: [
      {
        toolName: PROPOSE_FEATURE_TOOL,
        output: {
          kind: "feature" as const,
          proposalId,
          payload: {
            title: "Test Feature",
            workspaceId: "ws_1",
            initiativeId: "init_1",
          },
        } satisfies ProposalOutput,
      },
    ],
  };
}

function milestoneMessage(proposalId: string) {
  return {
    role: "assistant" as const,
    toolCalls: [
      {
        toolName: PROPOSE_MILESTONE_TOOL,
        output: {
          kind: "milestone" as const,
          proposalId,
          payload: {
            name: "Test Milestone",
            initiativeId: "init_1",
            featureIds: [],
          },
          featureMeta: [],
        } satisfies ProposalOutput,
      },
    ],
  };
}

function approvalIntent(proposalId: string, extra?: Partial<ApprovalIntent>): ApprovalIntent {
  return { proposalId, viewport: { x: 40, y: 40 }, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolvePlacement.mockResolvedValue(null);
  mockFindFreeSlotInViewport.mockReturnValue(FREE_SLOT);
  mockSetLivePosition.mockResolvedValue(undefined);
  mockReadCanvas.mockResolvedValue({ nodes: [] });
});

// ─── approveInitiative ────────────────────────────────────────────────

describe("approveInitiative — viewport-aware placement", () => {
  beforeEach(() => {
    (db.initiative.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "init_new",
    });
  });

  it("calls setLivePosition with viewport-derived coords when resolvePlacement returns null and viewportState is present", async () => {
    const result = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [initiativeMessage("p_init")],
      intent: approvalIntent("p_init", { viewportState: VIEWPORT_STATE }),
    });

    expect(result.ok).toBe(true);
    expect(mockFindFreeSlotInViewport).toHaveBeenCalledWith(
      VIEWPORT_STATE,
      expect.any(Array),
      320, // INITIATIVE_W
      120, // INITIATIVE_H
    );
    expect(mockSetLivePosition).toHaveBeenCalledWith(
      "org_1",
      "",
      "initiative:init_new",
      FREE_SLOT,
    );
  });

  it("does NOT call setLivePosition when resolvePlacement returns null and viewportState is absent", async () => {
    const result = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [initiativeMessage("p_init2")],
      intent: approvalIntent("p_init2"), // no viewportState
    });

    expect(result.ok).toBe(true);
    expect(mockFindFreeSlotInViewport).not.toHaveBeenCalled();
    expect(mockSetLivePosition).not.toHaveBeenCalled();
  });

  it("does NOT call setLivePosition when findFreeSlotInViewport returns null (packed viewport)", async () => {
    mockFindFreeSlotInViewport.mockReturnValue(null);

    const result = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [initiativeMessage("p_init3")],
      intent: approvalIntent("p_init3", { viewportState: VIEWPORT_STATE }),
    });

    expect(result.ok).toBe(true);
    expect(mockSetLivePosition).not.toHaveBeenCalled();
  });

  it("reads root canvas nodes for collision check", async () => {
    const existingNodes = [{ id: "initiative:existing", x: 120, y: 120 }];
    mockReadCanvas.mockResolvedValue({ nodes: existingNodes });

    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [initiativeMessage("p_init4")],
      intent: approvalIntent("p_init4", { viewportState: VIEWPORT_STATE }),
    });

    expect(mockReadCanvas).toHaveBeenCalledWith("org_1", "");
    expect(mockFindFreeSlotInViewport).toHaveBeenCalledWith(
      VIEWPORT_STATE,
      existingNodes,
      320,
      120,
    );
  });

  it("uses resolvePlacement result when it returns a value (takes priority over viewport)", async () => {
    const agentCoords = { x: 500, y: 500 };
    mockResolvePlacement.mockResolvedValue(agentCoords);

    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [initiativeMessage("p_init5")],
      intent: approvalIntent("p_init5", { viewportState: VIEWPORT_STATE }),
    });

    expect(mockFindFreeSlotInViewport).not.toHaveBeenCalled();
    expect(mockSetLivePosition).toHaveBeenCalledWith(
      "org_1",
      "",
      "initiative:init_new",
      agentCoords,
    );
  });
});

// ─── approveFeature ───────────────────────────────────────────────────

describe("approveFeature — viewport-aware placement", () => {
  beforeEach(() => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ws_1" });
    (db.initiative.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "init_1" });
    (db.feature.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("uses viewport free slot instead of {40,40} when viewportState is present", async () => {
    const result = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [featureMessage("p_feat")],
      intent: approvalIntent("p_feat", {
        currentRef: "initiative:init_1",
        viewportState: VIEWPORT_STATE,
      }),
    });

    expect(result.ok).toBe(true);
    expect(mockFindFreeSlotInViewport).toHaveBeenCalledWith(
      VIEWPORT_STATE,
      expect.any(Array),
      260, // FEATURE_W
      100, // FEATURE_H
    );
    expect(mockSetLivePosition).toHaveBeenCalledWith(
      "org_1",
      expect.any(String),
      "feature:feat_new",
      FREE_SLOT,
    );
  });

  it("falls back to intent.viewport ({40,40}) when findFreeSlotInViewport returns null", async () => {
    mockFindFreeSlotInViewport.mockReturnValue(null);

    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [featureMessage("p_feat2")],
      intent: approvalIntent("p_feat2", {
        currentRef: "initiative:init_1",
        viewportState: VIEWPORT_STATE,
        viewport: { x: 40, y: 40 },
      }),
    });

    expect(mockSetLivePosition).toHaveBeenCalledWith(
      "org_1",
      expect.any(String),
      "feature:feat_new",
      { x: 40, y: 40 },
    );
  });

  it("does not use findFreeSlotInViewport when viewportState is absent (legacy path)", async () => {
    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [featureMessage("p_feat3")],
      intent: approvalIntent("p_feat3", {
        currentRef: "initiative:init_1",
        // no viewportState
      }),
    });

    expect(mockFindFreeSlotInViewport).not.toHaveBeenCalled();
  });
});

// ─── approveMilestone ─────────────────────────────────────────────────

describe("approveMilestone — viewport-aware placement", () => {
  beforeEach(() => {
    (db.initiative.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "init_1",
    });
    // Simulate successful transaction by mocking $transaction
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof db) => Promise<{ id: string }>) => {
        // Provide a minimal tx mock with a milestone.create
        const tx = {
          milestone: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: "ms_new" }),
          },
          feature: {
            updateMany: vi.fn().mockResolvedValue({}),
          },
        };
        return fn(tx as unknown as typeof db);
      },
    );
  });

  it("uses viewport free slot instead of {40,40} when viewportState is present", async () => {
    const result = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [milestoneMessage("p_ms")],
      intent: approvalIntent("p_ms", {
        currentRef: "initiative:init_1",
        viewportState: VIEWPORT_STATE,
      }),
    });

    expect(result.ok).toBe(true);
    expect(mockFindFreeSlotInViewport).toHaveBeenCalledWith(
      VIEWPORT_STATE,
      expect.any(Array),
      280, // MILESTONE_W
      110, // MILESTONE_H
    );
    expect(mockSetLivePosition).toHaveBeenCalledWith(
      "org_1",
      "initiative:init_1",
      "milestone:ms_new",
      FREE_SLOT,
    );
  });

  it("falls back to intent.viewport ({40,40}) when findFreeSlotInViewport returns null", async () => {
    mockFindFreeSlotInViewport.mockReturnValue(null);

    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [milestoneMessage("p_ms2")],
      intent: approvalIntent("p_ms2", {
        currentRef: "initiative:init_1",
        viewportState: VIEWPORT_STATE,
        viewport: { x: 40, y: 40 },
      }),
    });

    expect(mockSetLivePosition).toHaveBeenCalledWith(
      "org_1",
      "initiative:init_1",
      "milestone:ms_new",
      { x: 40, y: 40 },
    );
  });

  it("does not use findFreeSlotInViewport when viewportState is absent (legacy path)", async () => {
    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [milestoneMessage("p_ms3")],
      intent: approvalIntent("p_ms3", {
        currentRef: "initiative:init_1",
        // no viewportState
      }),
    });

    expect(mockFindFreeSlotInViewport).not.toHaveBeenCalled();
  });

  it("uses resolvePlacement result when it returns a value (takes priority over viewport)", async () => {
    const agentCoords = { x: 700, y: 400 };
    mockResolvePlacement.mockResolvedValue(agentCoords);

    await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [milestoneMessage("p_ms4")],
      intent: approvalIntent("p_ms4", {
        currentRef: "initiative:init_1",
        viewportState: VIEWPORT_STATE,
      }),
    });

    expect(mockFindFreeSlotInViewport).not.toHaveBeenCalled();
    expect(mockSetLivePosition).toHaveBeenCalledWith(
      "org_1",
      "initiative:init_1",
      "milestone:ms_new",
      agentCoords,
    );
  });
});
