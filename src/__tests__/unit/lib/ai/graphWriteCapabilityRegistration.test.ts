/**
 * Unit tests for graph-write tool registration in the canvas agent's
 * capability registry.
 *
 * Contracts:
 *   1. When `ctx.graphWriteEnabled === true`, the four propose tools
 *      are included in the `graph_walker` toolset.
 *   2. When `ctx.graphWriteEnabled` is absent or false, the four tools
 *      are absent (org gate is off / not yet enabled).
 *   3. All four tool names appear in `graph_walker.writeToolNames` so
 *      they are stripped in readonly mode and inside the read-only
 *      graph-walk sub-agent.
 *   4. `composeWriteToolNames` for a selection that includes `graph_walker`
 *      contains all six write names (dispatch + finalize + 4 propose).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock every tool builder ────────────────────────────────────────────────
vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/infraTools", () => ({ buildInfraTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/promptTools", () => ({ buildPromptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/conceptTools", () => ({ buildConceptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/workflowExplorerTools", () => ({
  buildWorkflowExplorerTools: vi.fn(() => ({})),
}));

const mockGraphWalkerTools = vi.fn(() => ({ graph_get: "mock_graph_get" }));
vi.mock("@/lib/ai/graphWalkerTools", () => ({
  buildGraphWalkerTools: (...args: unknown[]) => mockGraphWalkerTools(...args),
}));
vi.mock("@/lib/ai/graphWalkDispatchTools", () => ({
  buildGraphWalkDispatchTools: vi.fn(() => ({
    dispatch_graph_walk: "mock_dispatch",
    finalize_graph_walk: "mock_finalize",
  })),
}));

// The four write tools — return named stubs so we can detect presence.
const WRITE_TOOL_STUBS = {
  propose_create_node: "stub_create_node",
  propose_node_edit: "stub_node_edit",
  propose_create_triplet: "stub_create_triplet",
  propose_create_batch_triplet: "stub_batch_triplet",
};
const mockBuildGraphWriteTools = vi.fn(() => WRITE_TOOL_STUBS);
vi.mock("@/lib/ai/graphWriteTools", () => ({
  buildGraphWriteTools: (...args: unknown[]) => mockBuildGraphWriteTools(...args),
}));

// ── Stub prompts ────────────────────────────────────────────────────────────
vi.mock("@/lib/constants/prompt", () => ({
  getRoadmapCapabilitySnippet: vi.fn(() => ""),
  getPlannerCapabilitySnippet: vi.fn(() => ""),
  getWhiteboardCapabilitySnippet: vi.fn(() => ""),
  getResearchCapabilitySnippet: vi.fn(() => ""),
  getConnectionsCapabilitySnippet: vi.fn(() => ""),
  getGraphWalkerCapabilitySnippet: vi.fn(() => ""),
  getInfraCapabilitySnippet: vi.fn(() => ""),
  getWorkflowsCapabilitySnippet: vi.fn(() => ""),
  getPromptsCapabilitySnippet: vi.fn(() => ""),
  getConceptsCapabilitySnippet: vi.fn(() => ""),
}));

vi.mock("ai", () => ({ tool: vi.fn((t: unknown) => t) }));

vi.mock("@/lib/proposals/types", () => ({
  PROPOSE_FEATURE_TOOL: "propose_feature",
  PROPOSE_INITIATIVE_TOOL: "propose_initiative",
  PROPOSE_MILESTONE_TOOL: "propose_milestone",
  PROPOSE_NEW_PROMPT_TOOL: "propose_new_prompt",
  PROPOSE_PROMPT_UPDATE_TOOL: "propose_prompt_update",
  PROPOSE_NEW_CONCEPT_TOOL: "propose_new_concept",
  PROPOSE_CONCEPT_UPDATE_TOOL: "propose_concept_update",
  PROPOSE_CREATE_NODE_TOOL: "propose_create_node",
  PROPOSE_NODE_EDIT_TOOL: "propose_node_edit",
  PROPOSE_CREATE_TRIPLET_TOOL: "propose_create_triplet",
  PROPOSE_CREATE_BATCH_TRIPLET_TOOL: "propose_create_batch_triplet",
}));

// Gate mocks — both resolving independently.
const isPromptsCapabilityEnabledForOrg = vi.fn<
  (orgId: string | undefined) => Promise<boolean>
>();
const isGraphWriteCapabilityEnabledForOrg = vi.fn<
  (orgId: string | undefined) => Promise<boolean>
>();
vi.mock("@/lib/ai/capabilityGates", () => ({
  isPromptsCapabilityEnabledForOrg: (orgId: string | undefined) =>
    isPromptsCapabilityEnabledForOrg(orgId),
  isGraphWriteCapabilityEnabledForOrg: (orgId: string | undefined) =>
    isGraphWriteCapabilityEnabledForOrg(orgId),
}));

import {
  CAPABILITY_REGISTRY,
  composeCapabilityTools,
  composeWriteToolNames,
  resolveCapabilities,
  type CapabilityContext,
} from "@/lib/ai/capabilities";

// ── Baseline context ────────────────────────────────────────────────────────

function ctx(overrides?: Partial<CapabilityContext>): CapabilityContext {
  return {
    orgId: "org-1",
    userId: "user-1",
    capturedWebSearchResults: [],
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockBuildGraphWriteTools.mockClear();
  isPromptsCapabilityEnabledForOrg.mockResolvedValue(false);
  isGraphWriteCapabilityEnabledForOrg.mockResolvedValue(false);
});

describe("graph_writer tool gate (ctx.graphWriteEnabled)", () => {
  it("includes write tools when graphWriteEnabled is true", () => {
    const tools = CAPABILITY_REGISTRY.graph_walker.buildTools(
      ctx({ graphWriteEnabled: true }),
    );
    expect(tools).toHaveProperty("propose_create_node");
    expect(tools).toHaveProperty("propose_node_edit");
    expect(tools).toHaveProperty("propose_create_triplet");
    expect(tools).toHaveProperty("propose_create_batch_triplet");
    expect(mockBuildGraphWriteTools).toHaveBeenCalledWith("org-1", "user-1");
  });

  it("excludes write tools when graphWriteEnabled is false", () => {
    const tools = CAPABILITY_REGISTRY.graph_walker.buildTools(
      ctx({ graphWriteEnabled: false }),
    );
    expect(tools).not.toHaveProperty("propose_create_node");
    expect(tools).not.toHaveProperty("propose_node_edit");
    expect(tools).not.toHaveProperty("propose_create_triplet");
    expect(tools).not.toHaveProperty("propose_create_batch_triplet");
    expect(mockBuildGraphWriteTools).not.toHaveBeenCalled();
  });

  it("excludes write tools when graphWriteEnabled is absent", () => {
    const tools = CAPABILITY_REGISTRY.graph_walker.buildTools(ctx());
    expect(tools).not.toHaveProperty("propose_create_node");
    expect(mockBuildGraphWriteTools).not.toHaveBeenCalled();
  });

  it("always includes the read tools regardless of graphWriteEnabled", () => {
    const toolsOff = CAPABILITY_REGISTRY.graph_walker.buildTools(
      ctx({ graphWriteEnabled: false }),
    );
    expect(toolsOff).toHaveProperty("graph_get");
    expect(toolsOff).toHaveProperty("dispatch_graph_walk");

    const toolsOn = CAPABILITY_REGISTRY.graph_walker.buildTools(
      ctx({ graphWriteEnabled: true }),
    );
    expect(toolsOn).toHaveProperty("graph_get");
    expect(toolsOn).toHaveProperty("dispatch_graph_walk");
  });
});

describe("graph_walker writeToolNames", () => {
  const { writeToolNames } = CAPABILITY_REGISTRY.graph_walker;

  it("includes dispatch_graph_walk and finalize_graph_walk", () => {
    expect(writeToolNames).toContain("dispatch_graph_walk");
    expect(writeToolNames).toContain("finalize_graph_walk");
  });

  it("includes all four graph-write propose tool names", () => {
    expect(writeToolNames).toContain("propose_create_node");
    expect(writeToolNames).toContain("propose_node_edit");
    expect(writeToolNames).toContain("propose_create_triplet");
    expect(writeToolNames).toContain("propose_create_batch_triplet");
  });
});

describe("composeWriteToolNames with graph_walker", () => {
  it("includes all six graph_walker write names when graph_walker is resolved", () => {
    const resolved = resolveCapabilities(["graph_walker"]);
    const names = composeWriteToolNames(resolved);
    // dispatch/finalize
    expect(names).toContain("dispatch_graph_walk");
    expect(names).toContain("finalize_graph_walk");
    // four propose tools
    expect(names).toContain("propose_create_node");
    expect(names).toContain("propose_node_edit");
    expect(names).toContain("propose_create_triplet");
    expect(names).toContain("propose_create_batch_triplet");
  });
});

describe("composeCapabilityTools write-tool exclusion when graphWriteEnabled is off", () => {
  it("built toolset from roadmap (graph_walker included) excludes write tools when gate is off", () => {
    const resolved = resolveCapabilities(["roadmap"]);
    const tools = composeCapabilityTools(resolved, ctx({ graphWriteEnabled: false }));
    expect(tools).not.toHaveProperty("propose_create_node");
    expect(tools).not.toHaveProperty("propose_node_edit");
    expect(tools).not.toHaveProperty("propose_create_triplet");
    expect(tools).not.toHaveProperty("propose_create_batch_triplet");
  });

  it("built toolset from roadmap includes write tools when gate is on", () => {
    const resolved = resolveCapabilities(["roadmap"]);
    const tools = composeCapabilityTools(resolved, ctx({ graphWriteEnabled: true }));
    expect(tools).toHaveProperty("propose_create_node");
    expect(tools).toHaveProperty("propose_node_edit");
    expect(tools).toHaveProperty("propose_create_triplet");
    expect(tools).toHaveProperty("propose_create_batch_triplet");
  });
});
