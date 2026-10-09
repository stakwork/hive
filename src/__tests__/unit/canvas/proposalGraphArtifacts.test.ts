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
      proposal: "p-1",
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

  test("turns an edge delete into the graph centred on the child, with the link going", () => {
    const ref = proposalGraphArtifact({
      kind: "graphEdgeDelete",
      proposalId: "p-4",
      payload: {
        workspaceId: "ws-1",
        workspaceSlug: "hive",
        edge_type: "PARENT_OF",
        source_ref_id: "c-1",
        target_ref_id: "c-2",
      },
      meta: { workspaceSlug: "hive", source_name: "Coding", target_name: "Security" },
    });

    expect(ref).toMatchObject({ id: "proposal:p-4", kind: "graph", title: "Remove PARENT_OF link" });
    const content = ref?.source.type === "inline" ? parseArtifactContent("graph", ref.source.content) : null;
    expect(content).toEqual({
      workspace: "hive",
      focus: "c-2",
      changes: [{ kind: "unlink", edge: "PARENT_OF", source: "c-1", target: "c-2" }],
      proposal: "p-4",
    });
  });

  test("turns a node delete into the graph centred on the node, with each of its links going", () => {
    const ref = proposalGraphArtifact({
      kind: "graphNodeDelete",
      proposalId: "p-6",
      payload: { workspaceId: "ws-1", workspaceSlug: "hive", ref_id: "c-2" },
      meta: {
        workspaceSlug: "hive",
        node_name: "Security",
        edges: [
          { edge_type: "PARENT_OF", direction: "in", other_ref_id: "c-1" },
          { edge_type: "DESCRIBES", direction: "out", other_ref_id: "d-1" },
        ],
      },
    });

    expect(ref).toMatchObject({ id: "proposal:p-6", kind: "graph", title: "Delete Security" });
    const content = ref?.source.type === "inline" ? parseArtifactContent("graph", ref.source.content) : null;
    expect(content).toEqual({
      workspace: "hive",
      focus: "c-2",
      changes: [
        { kind: "unlink", edge: "PARENT_OF", source: "c-1", target: "c-2" },
        { kind: "unlink", edge: "DESCRIBES", source: "c-2", target: "d-1" },
      ],
      proposal: "p-6",
    });
  });

  test("turns a node move into the graph centred on the node, with the old link going and the new one coming", () => {
    const ref = proposalGraphArtifact({
      kind: "graphNodeMove",
      proposalId: "p-5",
      payload: {
        workspaceId: "ws-1",
        workspaceSlug: "hive",
        ref_id: "c-2",
        edge_type: "PARENT_OF",
        from_ref_id: "c-1",
        to_ref_id: "c-3",
      },
      rationale: "Security is an ops concern.",
      meta: { workspaceSlug: "hive", node_name: "Security", from_name: "Coding", to_name: "Ops" },
    });

    expect(ref).toMatchObject({ id: "proposal:p-5", title: "Move Security", summary: "Security is an ops concern." });
    const content = ref?.source.type === "inline" ? parseArtifactContent("graph", ref.source.content) : null;
    expect(content).toEqual({
      workspace: "hive",
      focus: "c-2",
      changes: [
        { kind: "unlink", edge: "PARENT_OF", source: "c-1", target: "c-2" },
        { kind: "edge", edge: "PARENT_OF", source: "c-3", target: "c-2" },
      ],
      proposal: "p-5",
    });
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
