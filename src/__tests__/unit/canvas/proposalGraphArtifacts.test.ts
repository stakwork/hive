/**
 * A graph proposal is something to look at on the graph
 * (`_state/proposalGraphArtifacts.ts`): each yields a `graph` artifact the
 * proposal card opens, derived from the tool output, never stored.
 */
import { describe, test, expect } from "vitest";
import { listArtifacts, parseArtifactContent } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { proposalGraphArtifact, proposalGraphArtifacts } from "@/app/org/[githubLogin]/_state/proposalGraphArtifacts";
import type { ProposalOutput } from "@/lib/proposals/types";

const conceptUpdate: ProposalOutput = {
  kind: "conceptUpdate",
  proposalId: "p-1",
  payload: { workspaceId: "ws-1", workspaceSlug: "hive", conceptId: "stakwork/hive/idor", documentation: "# new" },
  rationale: "Adds the ownership check.",
  meta: { oldStr: "# old", newStr: "# new", conceptName: "IDOR Check" },
};

const triplet = (target: { ref_id: string } | { node_type: string; node_data: Record<string, unknown> }) =>
  ({
    kind: "graphTripletCreate",
    proposalId: "p-2",
    payload: { workspaceId: "ws-1", workspaceSlug: "hive", edge_type: "DEPENDS_ON", source: { ref_id: "c-1" }, target },
  }) as ProposalOutput;

describe("proposalGraphArtifact", () => {
  test("turns a concept update into the graph, centred on the concept, with the docs change", () => {
    const ref = proposalGraphArtifact(conceptUpdate);

    expect(ref).toMatchObject({
      id: "proposal:p-1",
      kind: "graph",
      title: "IDOR Check",
      label: "Proposed change",
      summary: "Adds the ownership check.",
    });
    const content = ref?.source.type === "inline" ? parseArtifactContent("graph", ref.source.content) : null;
    expect(content).toEqual({
      workspace: "hive",
      focus: "stakwork/hive/idor",
      changes: [{ kind: "docs", node: "stakwork/hive/idor", before: "# old", after: "# new" }],
    });
  });

  test("names a new node's end by its name", () => {
    const ref = proposalGraphArtifact(triplet({ node_type: "Concept", node_data: { name: "Secrets" } }));
    expect(ref?.source).toMatchObject({
      content: { changes: [{ kind: "edge", edge: "DEPENDS_ON", source: "c-1", target: "Secrets" }] },
    });
  });

  test("yields nothing for a link with an end it can't name, so the card shows no graph button", () => {
    expect(proposalGraphArtifact(triplet({ node_type: "Concept", node_data: {} }))).toBeNull();
  });

  test("gives the same ref for the same proposal while a reply streams", () => {
    expect(proposalGraphArtifact(conceptUpdate)).toBe(proposalGraphArtifact(conceptUpdate));
  });
});

describe("proposalGraphArtifacts", () => {
  test("reads graph proposals off tool calls, skipping errors and other tools' output", () => {
    const refs = proposalGraphArtifacts([
      { output: conceptUpdate },
      { output: { error: "Workspace not found" } },
      { output: { kind: "feature", proposalId: "p-3", payload: {} } },
      { output: "text" },
      {},
    ]);
    expect(refs.map((r) => r.id)).toEqual(["proposal:p-1"]);
  });

  test("are listed with the conversation's artifacts", () => {
    const plan = {
      id: "plan",
      kind: "markdown" as const,
      title: "Plan",
      label: "Plan",
      source: { type: "graph" as const, swarmId: "s", key: "k" },
    };
    const ids = listArtifacts([{ artifacts: [plan], toolCalls: [{ output: conceptUpdate }] }]).map((a) => a.id);
    expect(ids).toEqual(["plan", "proposal:p-1"]);
  });
});
