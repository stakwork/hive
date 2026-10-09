/**
 * "Workflow" means strut by default.
 *
 * A user who says "workflow" without naming Stakwork means a strut workflow,
 * so the loadable-capability menu and the `learn_capability` tool must send
 * a bare "workflow" to `strut` and reserve `stakwork_workflows` (the Stakwork workflow
 * library) for requests that explicitly say Stakwork. These tests lock that
 * wording — it is what the agent routes on.
 */

// @vitest-environment node

import { describe, it, expect, vi } from "vitest";

// Mock every capability tool builder so importing capabilities.ts stays light.
vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/htmlArtifactTools", () => ({ buildHtmlArtifactTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/infraTools", () => ({ buildInfraTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkerTools", () => ({ buildGraphWalkerTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkDispatchTools", () => ({
  buildGraphWalkDispatchTools: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/graphWriteTools", () => ({ buildGraphWriteTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/promptTools", () => ({ buildPromptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/conceptTools", () => ({ buildConceptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/workflowExplorerTools", () => ({
  buildWorkflowExplorerTools: vi.fn(() => ({})),
}));
vi.mock("@/lib/constants/prompt", () => ({
  getRoadmapCapabilitySnippet: vi.fn(() => ""),
  getPlannerCapabilitySnippet: vi.fn(() => ""),
  getWhiteboardCapabilitySnippet: vi.fn(() => ""),
  getResearchCapabilitySnippet: vi.fn(() => ""),
  getConnectionsCapabilitySnippet: vi.fn(() => ""),
  getHtmlPagesCapabilitySnippet: vi.fn(() => ""),
  getGraphWalkerCapabilitySnippet: vi.fn(() => ""),
  getInfraCapabilitySnippet: vi.fn(() => ""),
  getWorkflowsCapabilitySnippet: vi.fn(() => ""),
  getPromptsCapabilitySnippet: vi.fn(() => ""),
  getConceptsCapabilitySnippet: vi.fn(() => ""),
}));
vi.mock("ai", async (importOriginal) => {
  // ai@7's tool/capability modules reach for `jsonSchema` (and friends)
  // at import time, so spread the real module rather than replacing it.
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, tool: vi.fn((t: unknown) => t) };
});
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
  PROPOSE_DELETE_EDGE_TOOL: "propose_delete_edge",
  PROPOSE_MOVE_NODE_TOOL: "propose_move_node",
  PROPOSE_DELETE_NODE_TOOL: "propose_delete_node",
  PROPOSE_CODE_CHANGE_TOOL: "propose_code_change",
}));
vi.mock("@/lib/ai/capabilityGates", () => ({
  isPromptsCapabilityEnabledForOrg: vi.fn(async () => false),
  isGraphWriteCapabilityEnabledForOrg: vi.fn(async () => false),
  isStrutCapabilityEnabledForOrg: vi.fn(async () => false),
}));

import {
  CAPABILITY_REGISTRY,
  composeCapabilityPromptSuffix,
  composeCapabilityTools,
} from "@/lib/ai/capabilities";
import type { CapabilityContext, OrgCapability } from "@/lib/ai/capabilities";

const ctx = { orgId: "org-1", userId: "user-1" } as unknown as CapabilityContext;

const STRUT_HINT = "ALWAYS means strut: load `strut`";
const WORKFLOWS_HINT =
  "Load `stakwork_workflows` (the Stakwork workflow library) ONLY when the user explicitly names Stakwork";

function learnCapabilityDescription(selected: OrgCapability[]): string {
  const tools = composeCapabilityTools(selected, ctx);
  return (tools.learn_capability as unknown as { description: string }).description;
}

describe("loadable-capability menu blurbs", () => {
  it("stakwork_workflows (the Stakwork library) loads ONLY when the user names Stakwork", () => {
    const blurb = CAPABILITY_REGISTRY.stakwork_workflows.menuBlurb ?? "";
    expect(blurb).toContain("Load ONLY when the user explicitly names Stakwork");
    expect(blurb).toContain('A bare "workflow" is a strut workflow — that is `strut`, never this');
  });

  it("strut loads for any workflow request unless the user names Stakwork", () => {
    const blurb = CAPABILITY_REGISTRY.strut.menuBlurb ?? "";
    expect(blurb).toContain("Load whenever the user asks about a workflow");
    expect(blurb).toContain('"Workflow" means strut unless the user explicitly names Stakwork');
  });

  it("the composed menu carries both rules when both capabilities are selected", () => {
    const suffix = composeCapabilityPromptSuffix(["roadmap", "strut", "stakwork_workflows"]);
    expect(suffix).toContain("Load ONLY when the user explicitly names Stakwork");
    expect(suffix).toContain('"Workflow" means strut unless the user explicitly names Stakwork');
  });
});

describe("learn_capability description — workflow routing", () => {
  it("with strut loadable: a bare 'workflow' ALWAYS loads strut", () => {
    const description = learnCapabilityDescription(["strut"]);
    expect(description).toContain(STRUT_HINT);
    expect(description).not.toContain(WORKFLOWS_HINT);
  });

  it("with workflows loadable: the Stakwork library is explicit-Stakwork only", () => {
    const description = learnCapabilityDescription(["stakwork_workflows"]);
    expect(description).toContain(WORKFLOWS_HINT);
    expect(description).not.toContain(STRUT_HINT);
  });

  it("with both loadable: the strut default comes before the Stakwork exception", () => {
    const description = learnCapabilityDescription(["strut", "stakwork_workflows"]);
    const strutAt = description.indexOf(STRUT_HINT);
    const workflowsAt = description.indexOf(WORKFLOWS_HINT);
    expect(strutAt).toBeGreaterThan(-1);
    expect(workflowsAt).toBeGreaterThan(strutAt);
  });

  it("with neither loadable: no workflow routing is advertised", () => {
    const description = learnCapabilityDescription(["whiteboard"]);
    expect(description).not.toContain("strut");
    expect(description).not.toContain("Stakwork");
  });
});
