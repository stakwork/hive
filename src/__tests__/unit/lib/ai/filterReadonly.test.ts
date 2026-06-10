/**
 * Unit tests for filterReadonly (exported from runCanvasAgent).
 *
 * Verifies that:
 *   1. Write tools are stripped by default when readonly: true.
 *   2. keepWriteToolNames spares named tools from the strip.
 *   3. Read-only tools are always kept regardless of keepWriteToolNames.
 */

import { describe, test, expect } from "vitest";

// We only import the exported helper — no side-effectful module graph.
// filterReadonly is exported from runCanvasAgent but we want to test it
// without instantiating the full agent. Mock the heavy deps first.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/pusher", () => ({ pusherServer: { trigger: vi.fn() }, getWorkspaceChannelName: vi.fn(), PUSHER_EVENTS: {} }));
vi.mock("@/lib/ai/askTools", () => ({ askTools: vi.fn(), listConcepts: vi.fn(), createHasEndMarkerCondition: vi.fn() }));
vi.mock("@/lib/ai/askToolsMulti", () => ({ askToolsMulti: vi.fn() }));
vi.mock("@/lib/ai/workspaceConfig", () => ({
  buildWorkspaceConfigs: vi.fn(),
  buildPublicWorkspaceConfig: vi.fn(),
  fetchConceptsForWorkspaces: vi.fn(),
}));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/canvas/linkedWorkspaces", () => ({ getLinkedWorkspacesForInitiative: vi.fn(() => []) }));
vi.mock("@/lib/ai/message-sanitizer", () => ({ sanitizeAndCompleteToolCalls: vi.fn(async (msgs: unknown) => msgs) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: vi.fn(() => ({})), getApiKeyForProvider: vi.fn(() => "key") }));
vi.mock("aieo", () => ({ getProviderOptions: vi.fn(() => ({})) }));
vi.mock("@/services/bifrost/orchestrator", () => ({ getBifrostForLLM: vi.fn(async () => undefined) }));
vi.mock("ai", () => ({ streamText: vi.fn(() => ({})), tool: vi.fn((t: unknown) => t) }));
vi.mock("@/lib/constants/prompt", () => ({
  getMultiWorkspacePrefixMessages: vi.fn(() => []),
  getQuickAskPrefixMessages: vi.fn(() => []),
}));

import { vi } from "vitest";
import { filterReadonly } from "@/lib/ai/runCanvasAgent";
import type { ToolSet } from "ai";

function makeFakeTool() {
  return { description: "fake", inputSchema: {}, execute: async () => ({}) } as unknown as ToolSet[string];
}

describe("filterReadonly", () => {
  const tools: ToolSet = {
    // write tools that should be stripped
    update_canvas: makeFakeTool(),
    patch_canvas: makeFakeTool(),
    save_research: makeFakeTool(),
    update_research: makeFakeTool(),
    save_connection: makeFakeTool(),
    update_connection: makeFakeTool(),
    propose_initiative: makeFakeTool(),
    propose_feature: makeFakeTool(),
    propose_milestone: makeFakeTool(),
    assign_feature_to_initiative: makeFakeTool(),
    assign_feature_to_workspace: makeFakeTool(),
    unassign_feature_from_workspace: makeFakeTool(),
    // read tools that should be kept
    list_research: makeFakeTool(),
    read_research: makeFakeTool(),
    web_search: makeFakeTool(),
    list_concepts: makeFakeTool(),
  };

  test("strips all READONLY_STRIP_TOOL_NAMES when keepWriteToolNames is absent", () => {
    const result = filterReadonly(tools);
    // Write tools gone
    expect(result).not.toHaveProperty("update_canvas");
    expect(result).not.toHaveProperty("patch_canvas");
    expect(result).not.toHaveProperty("save_research");
    expect(result).not.toHaveProperty("update_research");
    expect(result).not.toHaveProperty("save_connection");
    expect(result).not.toHaveProperty("propose_initiative");
    expect(result).not.toHaveProperty("propose_feature");
    expect(result).not.toHaveProperty("propose_milestone");
    expect(result).not.toHaveProperty("assign_feature_to_initiative");
    expect(result).not.toHaveProperty("assign_feature_to_workspace");
    expect(result).not.toHaveProperty("unassign_feature_from_workspace");
    // Read tools kept
    expect(result).toHaveProperty("list_research");
    expect(result).toHaveProperty("read_research");
    expect(result).toHaveProperty("web_search");
    expect(result).toHaveProperty("list_concepts");
  });

  test("spares update_research when keepWriteToolNames includes it", () => {
    const result = filterReadonly(tools, ["update_research"]);
    // update_research spared
    expect(result).toHaveProperty("update_research");
    // other write tools still stripped
    expect(result).not.toHaveProperty("save_research");
    expect(result).not.toHaveProperty("update_canvas");
    expect(result).not.toHaveProperty("patch_canvas");
    expect(result).not.toHaveProperty("save_connection");
    expect(result).not.toHaveProperty("propose_initiative");
    expect(result).not.toHaveProperty("propose_feature");
    expect(result).not.toHaveProperty("propose_milestone");
    expect(result).not.toHaveProperty("assign_feature_to_initiative");
    // read tools still present
    expect(result).toHaveProperty("list_research");
    expect(result).toHaveProperty("read_research");
    expect(result).toHaveProperty("web_search");
  });

  test("keepWriteToolNames with a name not in strip set has no effect", () => {
    const result = filterReadonly(tools, ["web_search"]);
    // web_search is not in the strip set; still present
    expect(result).toHaveProperty("web_search");
    // write tools still stripped
    expect(result).not.toHaveProperty("update_research");
    expect(result).not.toHaveProperty("save_research");
  });

  test("empty keepWriteToolNames behaves same as absent", () => {
    const resultNoKeep = filterReadonly(tools);
    const resultEmptyKeep = filterReadonly(tools, []);
    expect(Object.keys(resultNoKeep).sort()).toEqual(Object.keys(resultEmptyKeep).sort());
  });
});
