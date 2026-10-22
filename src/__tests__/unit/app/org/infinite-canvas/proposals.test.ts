import { describe, expect, it } from "vitest";
import { mockInitiativeTree } from "@/app/api/mock/graph/initiative-fixture";
import { byId, kids, toBoard } from "@/app/org/[githubLogin]/_components/infinite-canvas/board";
import { proposalTitle, withProposals } from "@/app/org/[githubLogin]/_components/infinite-canvas/proposals";
import type { StrutProposalRecord } from "@/lib/strut-orchestrator";
import { initiativeStage } from "@/services/graph/workbench";

const ONB = "mock-initiative-onboarding";
const t = mockInitiativeTree(ONB);
const board = toBoard(
  [
    {
      summary: {
        ref_id: ONB,
        name: "Self-serve onboarding",
        status: null,
        created_at: null,
        updated_at: 5,
        created_by: null,
        created_by_kind: null,
        assignee_id: null,
      },
      ws: "ws",
      tree: { ...t, stage: initiativeStage(t.nodes), truncated: false },
    },
  ],
  {},
);
const record = (
  id: string,
  step: string,
  input: unknown,
  extra: Partial<StrutProposalRecord> = {},
): StrutProposalRecord => ({
  id,
  step,
  input,
  title: "Create (or merge) a SINGLE node in the strut knowledge graph as DATA, with no edge",
  status: "pending",
  createdAt: "2026-10-22T08:16:00Z",
  by: { workflow: "orchestrator", runId: "r" },
  workspaceSlug: "ws",
  ...extra,
});

describe("withProposals", () => {
  it("puts a proposed initiative on the desk, as the latest, in pencil", () => {
    const p = record("p1", "graph/create-node", {
      node_type: "HiveInitiative",
      node_data: { name: "infinite canvas", created_at: "2025-10-22T08:16:00Z" },
    });
    const b = withProposals(board, [{ runId: "run-1", record: p }], 99);
    const n = b.nodes.find((x) => x.pencil?.proposalId === "p1")!;
    expect(n).toMatchObject({ type: "initiative", name: "infinite canvas", ws: "ws", updatedAt: 99 });
    expect(n.pencil).toEqual({
      proposalId: "p1",
      runId: "run-1",
      title: "New initiative: infinite canvas",
    });
  });

  it("puts a card linked from one on the board under it, and leaves out what has nowhere to go", () => {
    const b = withProposals(board, [
      {
        runId: "r",
        record: record("p2", "graph/create-triplet", {
          source_ref_id: ONB,
          edge_type: "HAS_MILESTONE",
          target_type: "HiveMilestone",
          target_data: { name: "Beta", sequence: 4 },
        }),
      },
      {
        runId: "r",
        record: record("p3", "graph/create-batch-triplet", {
          triplets: [
            {
              source_ref_id: "mock-s-gh-1",
              edge_type: "HAS_REQUIREMENT",
              target_type: "Requirement",
              target_data: { text: "Works offline" },
            },
            {
              source_ref_id: "elsewhere",
              edge_type: "HAS_REQUIREMENT",
              target_type: "Requirement",
              target_data: { text: "Nope" },
            },
          ],
        }),
      },
      {
        runId: "r",
        record: record("p4", "graph/create-node", { node_type: "HiveMilestone", node_data: { name: "Orphan" } }),
      },
      { runId: "r", record: record("p5", "graph/create-node", { node_type: "Concept", node_data: { name: "Other" } }) },
    ]);
    const beta = kids(b, ONB, "milestone").find((m) => m.pencil)!;
    expect(beta).toMatchObject({ name: "Beta", sequence: 4, parent: ONB, status: "proposed" });
    expect(beta.pencil?.title).toBe('Add milestone "Beta" to Self-serve onboarding');
    expect(kids(b, "mock-s-gh-1", "requirement").find((r) => r.pencil)?.name).toBe("Works offline");
    expect(b.nodes.filter((n) => n.pencil)).toHaveLength(2);
  });

  it("shows a proposed rename on the card it changes", () => {
    const b = withProposals(board, [
      {
        runId: "r",
        record: record("p6", "graph/edit-node", { ref_id: "mock-m-signup", node_data: { name: "Sign-up v2" } }),
      },
    ]);
    expect(byId(b, "mock-m-signup")?.pencilEdit).toMatchObject({
      proposalId: "p6",
      name: "Sign-up v2",
      title: 'Edit milestone "Sign-up to first workspace"',
    });
  });

  it("titles a proposal from what it does, else keeps strut's title", () => {
    expect(proposalTitle(record("x", "graph/move-node", { ref_id: "a" }), board)).toMatch(/^Create \(or merge\)/);
  });
});
