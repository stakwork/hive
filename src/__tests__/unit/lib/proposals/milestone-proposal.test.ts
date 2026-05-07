/**
 * Unit tests for the milestone-arm-specific paths through
 * `getProposalStatus`, `findProposal` (via `handleApproval`), and the
 * `propose_milestone` tool's validation surface.
 *
 * Mirrors `handleApproval-scans.test.ts` and `status-derivation.test.ts`
 * — keep the pattern aligned so a reader of one understands the others.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PROPOSE_MILESTONE_TOOL,
  getProposalStatus,
  type ApprovalResult,
  type MilestoneFeatureMeta,
  type ProposalOutput,
} from "@/lib/proposals/types";

// ── DB mocks ───────────────────────────────────────────────────────
// The propose tool reaches into Prisma for org-ownership +
// per-feature invariant checks. The handler additionally re-validates
// before writing. We mock both surfaces hermetically so the tests
// stay focused on the non-DB control-flow paths.

vi.mock("@/lib/db", () => ({
  db: {
    initiative: { findFirst: vi.fn() },
    feature: { findMany: vi.fn() },
    milestone: { findFirst: vi.fn() },
    workspace: { findFirst: vi.fn() },
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
  updateFeature: vi.fn(),
}));

vi.mock("@/services/roadmap/feature-canvas-notify", () => ({
  notifyFeatureReassignmentRefresh: vi.fn(),
}));

vi.mock("@/services/roadmap/feature-chat", () => ({
  sendFeatureChatMessage: vi.fn(),
}));

import { handleApproval } from "@/lib/proposals/handleApproval";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";
import { db } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Test helpers ────────────────────────────────────────────────────

function proposeMilestoneMessage(
  proposalId: string,
  payload: {
    initiativeId: string;
    name: string;
    featureIds?: string[];
  },
  featureMeta: MilestoneFeatureMeta[] = [],
): {
  role: "assistant";
  toolCalls: Array<{ toolName: string; output: ProposalOutput }>;
} {
  return {
    role: "assistant",
    toolCalls: [
      {
        toolName: PROPOSE_MILESTONE_TOOL,
        output: {
          kind: "milestone",
          proposalId,
          payload: {
            initiativeId: payload.initiativeId,
            name: payload.name,
            featureIds: payload.featureIds ?? [],
          },
          featureMeta,
        },
      },
    ],
  };
}

// ── Status derivation (kind-agnostic) ───────────────────────────────

describe("getProposalStatus — milestone kind", () => {
  it("returns approved when the result kind is milestone", () => {
    const result: ApprovalResult = {
      proposalId: "p_m1",
      kind: "milestone",
      createdEntityId: "milestone_xyz",
      landedOn: "initiative:init_a",
      landedOnName: "Onboarding Revamp",
    };
    expect(
      getProposalStatus(
        [
          { role: "user", approval: { proposalId: "p_m1" } },
          { role: "assistant", approvalResult: result },
        ],
        "p_m1",
      ),
    ).toEqual({ status: "approved", result });
  });

  it("derives status uniformly regardless of kind", () => {
    // Same scan against three concurrent proposals of different
    // kinds — each independently resolves.
    const initiativeResult: ApprovalResult = {
      proposalId: "p_i",
      kind: "initiative",
      createdEntityId: "init_a",
      landedOn: "",
    };
    const milestoneResult: ApprovalResult = {
      proposalId: "p_m",
      kind: "milestone",
      createdEntityId: "ms_a",
      landedOn: "initiative:init_a",
    };
    const messages = [
      { role: "assistant" as const, approvalResult: initiativeResult },
      { role: "user" as const, rejection: { proposalId: "p_f" } },
      { role: "assistant" as const, approvalResult: milestoneResult },
    ];
    expect(getProposalStatus(messages, "p_i").status).toBe("approved");
    expect(getProposalStatus(messages, "p_m").status).toBe("approved");
    expect(getProposalStatus(messages, "p_f").status).toBe("rejected");
  });
});

// ── handleApproval — milestone proposal lookup + idempotency ────────

describe("handleApproval — milestone proposals", () => {
  it("finds a milestone proposal in the transcript", async () => {
    // No DB initiative → 404 from the validation step. We're only
    // proving findProposal recognized the milestone tool name; if it
    // hadn't, the handler would return "not found" with status 404
    // BEFORE the validation step. Distinguish by error message.
    (db.initiative.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue(null);
    const messages = [
      proposeMilestoneMessage("p_m1", {
        initiativeId: "init_a",
        name: "Q3 Push",
      }),
    ];
    const out = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages,
      intent: { proposalId: "p_m1" },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      // Validation found the proposal but rejected it — error mentions
      // initiative, not "Proposal not found in this conversation."
      expect(out.error).toContain("Initiative");
      expect(out.status).toBe(404);
    }
  });

  it("short-circuits via idempotency when a prior milestone approval exists", async () => {
    const prior: ApprovalResult = {
      proposalId: "p_m1",
      kind: "milestone",
      createdEntityId: "ms_existing",
      landedOn: "initiative:init_a",
    };
    const messages = [
      proposeMilestoneMessage("p_m1", {
        initiativeId: "init_a",
        name: "Q3 Push",
      }),
      { role: "assistant" as const, approvalResult: prior },
    ];
    const out = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages,
      intent: { proposalId: "p_m1" },
    });
    expect(out).toEqual({
      ok: true,
      result: prior,
      alreadyApproved: true,
    });
    // Idempotency must short-circuit BEFORE any DB lookup happens.
    expect(db.initiative.findFirst).not.toHaveBeenCalled();
  });

  it("returns 400 when the merged payload has no name", async () => {
    (db.initiative.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "init_a" });
    const messages = [
      proposeMilestoneMessage("p_m1", {
        initiativeId: "init_a",
        name: "Q3 Push",
      }),
    ];
    const out = await handleApproval({
      orgId: "org_1",
      userId: "user_1",
      messages,
      // Inline-edit override blanks the name. Should bail before any
      // DB write — without an explicit re-validation here we'd have
      // tried to create a milestone with name = "".
      intent: { proposalId: "p_m1", payload: { name: "   " } },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/name is required/i);
      expect(out.status).toBe(400);
    }
  });
});

// ── propose_milestone tool — validation paths ───────────────────────

describe("buildInitiativeTools.propose_milestone — validation", () => {
  function getTool() {
    const tools = buildInitiativeTools("org_1", "user_1");
    const t = tools[PROPOSE_MILESTONE_TOOL];
    if (!t || typeof t !== "object" || !("execute" in t)) {
      throw new Error("propose_milestone tool not registered");
    }
    return t as unknown as {
      execute: (input: unknown) => Promise<unknown>;
    };
  }

  it("rejects when the initiative is not in this org", async () => {
    (db.initiative.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue(null);
    const out = (await getTool().execute({
      proposalId: "p_m1",
      initiativeId: "init_other_org",
      name: "Bogus",
      featureIds: [],
    })) as { error?: string };
    expect(out.error).toMatch(/initiative not found/i);
  });

  it("rejects when a featureId belongs to a different initiative", async () => {
    (db.initiative.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "init_a" });
    (db.feature.findMany as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([
        {
          id: "feat_1",
          title: "OK",
          initiativeId: "init_a",
          milestoneId: null,
          workspace: { sourceControlOrgId: "org_1" },
          milestone: null,
        },
        {
          id: "feat_2",
          title: "Wrong initiative",
          initiativeId: "init_b",
          milestoneId: null,
          workspace: { sourceControlOrgId: "org_1" },
          milestone: null,
        },
      ]);
    const out = (await getTool().execute({
      proposalId: "p_m1",
      initiativeId: "init_a",
      name: "Q3 Push",
      featureIds: ["feat_1", "feat_2"],
    })) as { error?: string };
    expect(out.error).toMatch(/parent initiative/i);
    expect(out.error).toContain("feat_2");
  });

  it("rejects when a featureId belongs to a different org's workspace", async () => {
    (db.initiative.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "init_a" });
    (db.feature.findMany as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([
        {
          id: "feat_x",
          title: "Wrong org",
          initiativeId: "init_a",
          milestoneId: null,
          workspace: { sourceControlOrgId: "other_org" },
          milestone: null,
        },
      ]);
    const out = (await getTool().execute({
      proposalId: "p_m1",
      initiativeId: "init_a",
      name: "Q3 Push",
      featureIds: ["feat_x"],
    })) as { error?: string };
    expect(out.error).toMatch(/organization/i);
    expect(out.error).toContain("feat_x");
  });

  it("succeeds with empty featureIds and no DB feature lookup", async () => {
    (db.initiative.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "init_a" });
    const out = (await getTool().execute({
      proposalId: "p_m1",
      initiativeId: "init_a",
      name: "Empty milestone",
      featureIds: [],
    })) as ProposalOutput;
    expect(out).toMatchObject({
      kind: "milestone",
      proposalId: "p_m1",
    });
    expect(db.feature.findMany).not.toHaveBeenCalled();
    if (out.kind === "milestone") {
      expect(out.featureMeta).toEqual([]);
      expect(out.payload.featureIds).toEqual([]);
    }
  });

  it("populates featureMeta with current-milestone names from the validation query", async () => {
    (db.initiative.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "init_a" });
    (db.feature.findMany as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([
        {
          id: "feat_1",
          title: "Cohort filter",
          initiativeId: "init_a",
          milestoneId: null,
          workspace: { sourceControlOrgId: "org_1" },
          milestone: null,
        },
        {
          id: "feat_2",
          title: "Saved view bar",
          initiativeId: "init_a",
          milestoneId: "ms_other",
          workspace: { sourceControlOrgId: "org_1" },
          milestone: { name: "M_other" },
        },
      ]);
    const out = (await getTool().execute({
      proposalId: "p_m1",
      initiativeId: "init_a",
      name: "Q3 Push",
      featureIds: ["feat_1", "feat_2"],
    })) as ProposalOutput;
    expect(out.kind).toBe("milestone");
    if (out.kind === "milestone") {
      expect(out.featureMeta).toEqual([
        {
          id: "feat_1",
          title: "Cohort filter",
          currentMilestoneId: null,
          currentMilestoneName: null,
        },
        {
          id: "feat_2",
          title: "Saved view bar",
          currentMilestoneId: "ms_other",
          currentMilestoneName: "M_other",
        },
      ]);
    }
  });

  it("de-duplicates repeated featureIds in the input", async () => {
    (db.initiative.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "init_a" });
    const findMany = db.feature.findMany as unknown as {
      mockResolvedValue: (v: unknown) => void;
      mock: { calls: unknown[][] };
    };
    findMany.mockResolvedValue([
      {
        id: "feat_1",
        title: "Once",
        initiativeId: "init_a",
        milestoneId: null,
        workspace: { sourceControlOrgId: "org_1" },
        milestone: null,
      },
    ]);
    await getTool().execute({
      proposalId: "p_m1",
      initiativeId: "init_a",
      name: "Q3 Push",
      featureIds: ["feat_1", "feat_1", "feat_1"],
    });
    // The findMany query should have been called with a de-duped
    // `id: { in: [...] }` list. Without the de-dupe, .findMany would
    // have returned 1 row but `features.length !== featureIds.length`
    // would have falsely tripped the missing-id error.
    const call = findMany.mock.calls[0]?.[0] as
      | { where: { id: { in: string[] } } }
      | undefined;
    expect(call?.where.id.in).toEqual(["feat_1"]);
  });
});
