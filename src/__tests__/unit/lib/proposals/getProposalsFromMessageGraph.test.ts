/**
 * Unit tests for `getProposalsFromMessage` — specifically the four new
 * graph-write proposal kinds (propose_create_node, propose_node_edit,
 * propose_create_triplet, propose_create_batch_triplet).
 *
 * Prior to this ticket these tool names were absent from the allowlist,
 * so every graph-write tool call was silently dropped; these tests lock
 * the fixed behaviour.
 */
import { describe, it, expect, vi } from "vitest";

// ── Module-level mocks (must precede imports) ────────────────────────────────

// ProposalCard is a "use client" component that imports from canvasChatStore
// and sendCanvasChatMessage — mock both so this test stays unit-level.
vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: vi.fn(() => ({ conversations: {}, activeConversationId: null })),
}));
vi.mock("@/app/org/[githubLogin]/_state/useSendCanvasChatMessage", () => ({
  useSendCanvasChatMessage: vi.fn(() => async () => {}),
}));
// UI primitives that have no DOM in vitest
vi.mock("@/components/ui/switch", () => ({ Switch: () => null }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => children,
  DialogContent: ({ children }: any) => children,
  DialogHeader: ({ children }: any) => children,
  DialogTitle: ({ children }: any) => children,
}));
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => children,
}));
vi.mock("@/components/ui/badge", () => ({ Badge: ({ children }: any) => children }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => children,
  TooltipProvider: ({ children }: any) => children,
  TooltipContent: ({ children }: any) => children,
  TooltipTrigger: ({ children }: any) => children,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => children,
  DropdownMenuContent: ({ children }: any) => children,
  DropdownMenuLabel: ({ children }: any) => children,
  DropdownMenuSeparator: () => null,
  DropdownMenuCheckboxItem: ({ children }: any) => children,
  DropdownMenuTrigger: ({ children }: any) => children,
}));
vi.mock("@/components/ui/button", () => ({ Button: ({ children }: any) => children }));
vi.mock("@/components/diff/UnifiedDiffView", () => ({
  UnifiedDiffView: () => null,
  ConceptDiffDialog: () => null,
  SECTION_LABEL_CLASS: "section-label",
}));
vi.mock("@/lib/diff/unifiedLineDiff", () => ({
  computeUnifiedDiff: () => ({ unchanged: false, added: 1, removed: 0, hunks: [] }),
}));
vi.mock("react-markdown", () => ({ default: ({ children }: any) => children }));
vi.mock("@/lib/ai/models", () => ({
  getPlanRepoPreference: vi.fn(() => null),
  setPlanRepoPreference: vi.fn(),
}));
vi.mock("lucide-react", () => ({
  Check: () => null,
  X: () => null,
  ExternalLink: () => null,
  Loader2: () => null,
  Lightbulb: () => null,
  Info: () => null,
  FileDiff: () => null,
  Code2: () => null,
}));

// Import the function under test after mocks.
import { getProposalsFromMessage } from "@/app/org/[githubLogin]/_components/ProposalCard";
import type { CanvasChatMessage } from "@/app/org/[githubLogin]/_state/canvasChatStore";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMessage(
  toolCalls: CanvasChatMessage["toolCalls"],
): CanvasChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "",
    toolCalls,
  } as CanvasChatMessage;
}

const BASE_PAYLOAD = {
  workspaceId: "ws-id-1",
  workspaceSlug: "my-ws",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("getProposalsFromMessage — graph-write tool names", () => {
  it("returns a propose_create_node output", () => {
    const output = {
      kind: "graphNodeCreate",
      proposalId: "p1",
      payload: { ...BASE_PAYLOAD, node_type: "Concept", node_data: { name: "test" } },
    };
    const proposals = getProposalsFromMessage(
      makeMessage([
        { id: "tc-1", toolName: "propose_create_node", output },
      ]),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].kind).toBe("graphNodeCreate");
    expect(proposals[0].proposalId).toBe("p1");
  });

  it("returns a propose_node_edit output", () => {
    const output = {
      kind: "graphNodeEdit",
      proposalId: "p2",
      payload: { ...BASE_PAYLOAD, ref_id: "ref-abc", node_data: { label: "updated" } },
      meta: { oldStr: "{}", newStr: '{"label":"updated"}', node_type: "Concept" },
    };
    const proposals = getProposalsFromMessage(
      makeMessage([
        { id: "tc-2", toolName: "propose_node_edit", output },
      ]),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].kind).toBe("graphNodeEdit");
    expect(proposals[0].proposalId).toBe("p2");
  });

  it("returns a propose_create_triplet output", () => {
    const output = {
      kind: "graphTripletCreate",
      proposalId: "p3",
      payload: {
        ...BASE_PAYLOAD,
        edge_type: "RELATES_TO",
        source: { ref_id: "ref-src" },
        target: { ref_id: "ref-tgt" },
      },
    };
    const proposals = getProposalsFromMessage(
      makeMessage([
        { id: "tc-3", toolName: "propose_create_triplet", output },
      ]),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].kind).toBe("graphTripletCreate");
    expect(proposals[0].proposalId).toBe("p3");
  });

  it("returns a propose_create_batch_triplet output", () => {
    const output = {
      kind: "graphBatchTripletCreate",
      proposalId: "p4",
      payload: {
        ...BASE_PAYLOAD,
        triplets: [
          {
            edge_type: "RELATES_TO",
            source: { ref_id: "ref-a" },
            target: { ref_id: "ref-b" },
          },
        ],
      },
    };
    const proposals = getProposalsFromMessage(
      makeMessage([
        { id: "tc-4", toolName: "propose_create_batch_triplet", output },
      ]),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].kind).toBe("graphBatchTripletCreate");
    expect(proposals[0].proposalId).toBe("p4");
  });

  it("returns all four kinds in a single message", () => {
    const toolCalls: CanvasChatMessage["toolCalls"] = [
      {
        id: "tc-a",
        toolName: "propose_create_node",
        output: {
          kind: "graphNodeCreate",
          proposalId: "a",
          payload: { ...BASE_PAYLOAD, node_type: "Concept", node_data: {} },
        },
      },
      {
        id: "tc-b",
        toolName: "propose_node_edit",
        output: {
          kind: "graphNodeEdit",
          proposalId: "b",
          payload: { ...BASE_PAYLOAD, ref_id: "r", node_data: {} },
          meta: { oldStr: "{}", newStr: "{}" },
        },
      },
      {
        id: "tc-c",
        toolName: "propose_create_triplet",
        output: {
          kind: "graphTripletCreate",
          proposalId: "c",
          payload: {
            ...BASE_PAYLOAD,
            edge_type: "EDGE",
            source: { ref_id: "s" },
            target: { ref_id: "t" },
          },
        },
      },
      {
        id: "tc-d",
        toolName: "propose_create_batch_triplet",
        output: {
          kind: "graphBatchTripletCreate",
          proposalId: "d",
          payload: { ...BASE_PAYLOAD, triplets: [] },
        },
      },
    ];
    const proposals = getProposalsFromMessage(makeMessage(toolCalls));
    expect(proposals).toHaveLength(4);
    const kinds = proposals.map((p) => p.kind);
    expect(kinds).toContain("graphNodeCreate");
    expect(kinds).toContain("graphNodeEdit");
    expect(kinds).toContain("graphTripletCreate");
    expect(kinds).toContain("graphBatchTripletCreate");
  });

  it("skips tool calls with error outputs", () => {
    const proposals = getProposalsFromMessage(
      makeMessage([
        {
          id: "tc-err",
          toolName: "propose_create_node",
          output: { error: "workspace not found" },
        },
      ]),
    );
    expect(proposals).toHaveLength(0);
  });

  it("skips null / non-object outputs", () => {
    const proposals = getProposalsFromMessage(
      makeMessage([
        { id: "tc-null", toolName: "propose_create_triplet", output: null },
        { id: "tc-str", toolName: "propose_node_edit", output: "oops" },
      ]),
    );
    expect(proposals).toHaveLength(0);
  });

  it("still handles the original seven proposal kinds", () => {
    const output = {
      kind: "feature",
      proposalId: "f1",
      payload: {
        title: "My Feature",
        workspaceId: "ws-1",
      },
    };
    const proposals = getProposalsFromMessage(
      makeMessage([{ id: "tc-feat", toolName: "propose_feature", output }]),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].kind).toBe("feature");
  });

  it("ignores unknown tool names (not in the allowlist)", () => {
    const proposals = getProposalsFromMessage(
      makeMessage([
        {
          id: "tc-unknown",
          toolName: "graph_search",
          output: { results: [] },
        },
      ]),
    );
    expect(proposals).toHaveLength(0);
  });

  it("returns empty array when message has no toolCalls", () => {
    expect(getProposalsFromMessage(makeMessage(undefined))).toHaveLength(0);
    expect(getProposalsFromMessage(makeMessage([]))).toHaveLength(0);
  });
});
