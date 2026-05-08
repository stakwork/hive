/**
 * Unit tests for the `propose_feature` tool's validation + meta
 * resolution surface.
 *
 * The card subtext used to render `ws <suffix> · init <suffix>` —
 * cuid hints, not names. The fix resolves workspace / initiative /
 * milestone names server-side at proposal time and stuffs them into
 * a render-only `meta` block on the `ProposalOutput` so the card
 * never has to display an id (CANVAS.md gotcha: names beat ids in
 * any user-facing UI). These tests pin that contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PROPOSE_FEATURE_TOOL,
  type ProposalOutput,
} from "@/lib/proposals/types";

vi.mock("@/lib/db", () => ({
  db: {
    initiative: { findFirst: vi.fn() },
    milestone: { findFirst: vi.fn() },
    workspace: { findFirst: vi.fn() },
    feature: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/services/roadmap", () => ({
  updateFeature: vi.fn(),
}));

vi.mock("@/lib/canvas", () => ({
  notifyFeatureReassignmentRefresh: vi.fn(),
}));

vi.mock("@/services/orgs/nodeDetail", () => ({
  loadNodeDetail: vi.fn(),
}));

import { db } from "@/lib/db";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";

beforeEach(() => {
  vi.clearAllMocks();
});

function getTool() {
  const tools = buildInitiativeTools("org_1", "user_1");
  const t = tools[PROPOSE_FEATURE_TOOL];
  if (!t || typeof t !== "object" || !("execute" in t)) {
    throw new Error("propose_feature tool not registered");
  }
  return t as unknown as {
    execute: (input: unknown) => Promise<unknown>;
  };
}

describe("buildInitiativeTools.propose_feature — meta resolution", () => {
  it("rejects when the workspace slug is not found in this org", async () => {
    (db.workspace.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue(null);
    const out = (await getTool().execute({
      proposalId: "p_f1",
      title: "New thing",
      initialMessage: "Build the new thing.",
      workspaceSlug: "nope",
    })) as { error?: string };
    expect(out.error).toMatch(/workspace slug not found/i);
  });

  it("populates meta with workspace name (no initiative/milestone)", async () => {
    (db.workspace.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "ws_1", name: "Hive", slug: "hive" });
    const out = (await getTool().execute({
      proposalId: "p_f1",
      title: "Loose feature",
      initialMessage: "Build a loose feature.",
      workspaceSlug: "hive",
    })) as ProposalOutput;
    expect(out.kind).toBe("feature");
    if (out.kind === "feature") {
      expect(out.meta).toEqual({
        workspaceName: "Hive",
        workspaceSlug: "hive",
      });
      // The stored payload still uses the cuid (the approval handler
      // and downstream `createFeature` expect an id).
      expect(out.payload.workspaceId).toBe("ws_1");
    }
  });

  it("resolves initiative name when initiativeId is supplied", async () => {
    (db.workspace.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "ws_1", name: "Hive", slug: "hive" });
    (db.initiative.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "init_1", name: "Auth Refactor" });
    const out = (await getTool().execute({
      proposalId: "p_f1",
      title: "Login redesign",
      initialMessage: "Redesign the login page.",
      workspaceSlug: "hive",
      initiativeId: "init_1",
    })) as ProposalOutput;
    expect(out.kind).toBe("feature");
    if (out.kind === "feature") {
      expect(out.meta).toEqual({
        workspaceName: "Hive",
        workspaceSlug: "hive",
        initiativeName: "Auth Refactor",
      });
    }
  });

  it("derives initiative name from the milestone when only milestoneId is passed", async () => {
    // Common case: agent on a milestone canvas passes only
    // `milestoneId`. The tool should still surface the parent
    // initiative's name in `meta` so the card can render both.
    (db.workspace.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "ws_1", name: "Hive", slug: "hive" });
    (db.milestone.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({
        id: "ms_1",
        name: "Q3 Launch",
        initiativeId: "init_1",
        initiative: { name: "Auth Refactor" },
      });
    const out = (await getTool().execute({
      proposalId: "p_f1",
      title: "Polish",
      initialMessage: "Polish the launch.",
      workspaceSlug: "hive",
      milestoneId: "ms_1",
    })) as ProposalOutput;
    expect(out.kind).toBe("feature");
    if (out.kind === "feature") {
      expect(out.meta).toEqual({
        workspaceName: "Hive",
        workspaceSlug: "hive",
        initiativeName: "Auth Refactor",
        milestoneName: "Q3 Launch",
      });
    }
  });

  it("rejects when initiative and milestone both supplied but disagree", async () => {
    (db.workspace.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "ws_1", name: "Hive", slug: "hive" });
    (db.initiative.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "init_1", name: "Auth Refactor" });
    (db.milestone.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({
        id: "ms_1",
        name: "Q3 Launch",
        initiativeId: "init_OTHER",
        initiative: { name: "Other" },
      });
    const out = (await getTool().execute({
      proposalId: "p_f1",
      title: "Mismatch",
      initialMessage: "Build it.",
      workspaceSlug: "hive",
      initiativeId: "init_1",
      milestoneId: "ms_1",
    })) as { error?: string };
    expect(out.error).toMatch(/milestone does not belong/i);
  });
});
