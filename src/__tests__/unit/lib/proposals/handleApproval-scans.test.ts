/**
 * Unit tests for handleApproval's conversation-scanning logic
 * (proposal lookup, idempotency, parent resolution).
 *
 * The DB-touching path is excluded from these tests — those would
 * need full Prisma mocking. We focus on the pure-data paths that
 * are the load-bearing reason this design is "no schema changes."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_FEATURE_TOOL,
  type ProposalOutput,
  type ApprovalResult,
} from "@/lib/proposals/types";

// Mock all DB / canvas integrations so the handler under test runs
// in a hermetic environment. We assert only on the scan paths that
// don't reach those integrations.
vi.mock("@/lib/db", () => ({
  db: {
    initiative: { create: vi.fn(), findFirst: vi.fn() },
    workspace: { findFirst: vi.fn() },
    milestone: { findFirst: vi.fn() },
    feature: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/canvas", () => ({
  notifyCanvasUpdated: vi.fn(),
  setLivePosition: vi.fn(),
  featureProjectsOn: vi.fn(),
  mostSpecificRef: vi.fn(),
  ROOT_REF: "",
}));

vi.mock("@/services/roadmap", () => ({
  createFeature: vi.fn(),
}));

vi.mock("@/services/roadmap/feature-canvas-notify", () => ({
  notifyFeatureReassignmentRefresh: vi.fn(),
}));

import { handleApproval, handleRejection } from "@/lib/proposals/handleApproval";
import { db } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
});

function proposeInitiativeMessage(
  proposalId: string,
  name = "Onboarding Revamp",
): { role: "assistant"; toolCalls: Array<{ toolName: string; output: ProposalOutput }> } {
  return {
    role: "assistant",
    toolCalls: [
      {
        toolName: PROPOSE_INITIATIVE_TOOL,
        output: {
          kind: "initiative",
          proposalId,
          payload: { name },
        },
      },
    ],
  };
}

function proposeFeatureMessage(
  proposalId: string,
  payload: ProposalOutput["payload"] & { title: string; workspaceId: string },
): { role: "assistant"; toolCalls: Array<{ toolName: string; output: ProposalOutput }> } {
  return {
    role: "assistant",
    toolCalls: [
      {
        toolName: PROPOSE_FEATURE_TOOL,
        output: {
          kind: "feature",
          proposalId,
          payload: payload as ProposalOutput extends { kind: "feature"; payload: infer P }
            ? P
            : never,
        },
      },
    ],
  };
}

function approvedAssistantMessage(
  proposalId: string,
  result: Omit<ApprovalResult, "proposalId">,
): {
  role: "assistant";
  approvalResult: ApprovalResult;
} {
  return {
    role: "assistant",
    approvalResult: { proposalId, ...result },
  };
}

function rejectionUserMessage(proposalId: string): {
  role: "user";
  rejection: { proposalId: string };
} {
  return {
    role: "user",
    rejection: { proposalId },
  };
}

describe("handleApproval — conversation scans", () => {
  it("returns 404 when the proposalId is not found in the transcript", async () => {
    const out = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages: [],
      intent: { proposalId: "missing" },
    });
    expect(out).toEqual({
      ok: false,
      error: expect.stringContaining("not found"),
      status: 404,
    });
  });

  it("short-circuits when a prior approvalResult exists (idempotency)", async () => {
    const prior: ApprovalResult = {
      proposalId: "p_1",
      kind: "initiative",
      createdEntityId: "init_xyz",
      landedOn: "",
    };
    const messages = [
      proposeInitiativeMessage("p_1"),
      approvedAssistantMessage("p_1", {
        kind: "initiative",
        createdEntityId: "init_xyz",
        landedOn: "",
      }),
    ];
    const out = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages,
      intent: { proposalId: "p_1" },
    });
    expect(out).toEqual({
      ok: true,
      result: prior,
      alreadyApproved: true,
    });
    // Critically: no DB write happened.
    expect(db.initiative.create).not.toHaveBeenCalled();
  });

  it("rejects feature approval whose parent is still pending", async () => {
    const messages = [
      proposeInitiativeMessage("init_proposal"),
      proposeFeatureMessage("feat_proposal", {
        title: "Setup wizard",
        workspaceId: "ws_a",
        parentProposalId: "init_proposal",
      }),
    ];
    const out = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages,
      intent: { proposalId: "feat_proposal" },
    });
    expect(out).toEqual({
      ok: false,
      error: expect.stringContaining("parent initiative"),
      status: 409,
    });
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
  });

  it("rejects feature approval whose parent was rejected", async () => {
    const messages = [
      proposeInitiativeMessage("init_proposal"),
      proposeFeatureMessage("feat_proposal", {
        title: "Setup wizard",
        workspaceId: "ws_a",
        parentProposalId: "init_proposal",
      }),
      rejectionUserMessage("init_proposal"),
    ];
    const out = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages,
      intent: { proposalId: "feat_proposal" },
    });
    expect(out).toEqual({
      ok: false,
      error: expect.stringContaining("parent initiative"),
      status: 409,
    });
  });

  it("rejects approving a proposal whose tool output was an error (skipped from scan)", async () => {
    const messages = [
      {
        role: "assistant" as const,
        toolCalls: [
          {
            toolName: PROPOSE_INITIATIVE_TOOL,
            // Tool error shape — should be invisible to the scan.
            output: { error: "validation failed" },
          },
        ],
      },
    ];
    const out = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages,
      intent: { proposalId: "p_anything" },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(404);
  });
});

describe("handleRejection", () => {
  it("returns ok when the proposal exists in the transcript", () => {
    const messages = [proposeInitiativeMessage("p_1")];
    expect(handleRejection({ messages, intent: { proposalId: "p_1" } })).toEqual({
      ok: true,
    });
  });

  it("returns error when the proposal is missing", () => {
    expect(
      handleRejection({ messages: [], intent: { proposalId: "missing" } }),
    ).toEqual({
      ok: false,
      error: expect.stringContaining("not found"),
    });
  });
});
