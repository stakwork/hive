import { describe, it, expect } from "vitest";
import {
  derivePendingProposalConceptIds,
  conceptProposalLabel,
  type ConceptProposal,
} from "@/types/concept-proposals";

const base = {
  rationale: "r",
  source: "s",
  prNumbers: [],
  createdAt: "2025-08-01T00:00:00.000Z",
  repo: "stakwork/hive",
};

const mixedProposals: ConceptProposal[] = [
  {
    ...base,
    id: "p-create",
    action: "create",
    status: "pending",
    name: "Encryption Service",
  },
  {
    ...base,
    id: "p-update",
    action: "update",
    status: "pending",
    conceptId: "stakwork/hive/tasks",
  },
  {
    ...base,
    id: "p-delete",
    action: "delete",
    status: "pending",
    conceptId: "stakwork/hive/janitors",
  },
  {
    ...base,
    id: "p-merge",
    action: "merge",
    status: "pending",
    conceptId: "stakwork/hive/auth",
    mergeIntoConceptId: "stakwork/hive/workspace",
  },
  {
    ...base,
    id: "p-decided",
    action: "update",
    status: "accepted",
    conceptId: "stakwork/hive/swarm",
  },
];

describe("derivePendingProposalConceptIds", () => {
  it("flags update/delete targets and BOTH sides of a merge, skips create", () => {
    const ids = derivePendingProposalConceptIds(mixedProposals);
    expect(ids).toEqual(
      new Set([
        "stakwork/hive/tasks",
        "stakwork/hive/janitors",
        "stakwork/hive/auth",
        "stakwork/hive/workspace",
      ]),
    );
  });

  it("ignores proposals that are no longer pending", () => {
    const ids = derivePendingProposalConceptIds(mixedProposals);
    expect(ids.has("stakwork/hive/swarm")).toBe(false);
  });

  it("returns an empty set for no proposals", () => {
    expect(derivePendingProposalConceptIds([]).size).toBe(0);
  });
});

describe("conceptProposalLabel", () => {
  it("labels create proposals by name", () => {
    expect(conceptProposalLabel(mixedProposals[0])).toBe("Encryption Service");
  });

  it("labels update/delete proposals by concept id", () => {
    expect(conceptProposalLabel(mixedProposals[1])).toBe("stakwork/hive/tasks");
    expect(conceptProposalLabel(mixedProposals[2])).toBe("stakwork/hive/janitors");
  });

  it("labels merges as absorbed → survivor", () => {
    expect(conceptProposalLabel(mixedProposals[3])).toBe(
      "stakwork/hive/auth → stakwork/hive/workspace",
    );
  });
});
