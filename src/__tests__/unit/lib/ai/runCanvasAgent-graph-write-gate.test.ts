/**
 * Unit tests for the graph-write capability wiring in runCanvasAgent.
 *
 * The four `propose_*` graph-write tools are only composed when
 * `CapabilityContext.graphWriteEnabled` is true, and runCanvasAgent is the
 * only place that resolves it (via `isGraphWriteCapabilityEnabledForOrg`).
 * The registry-level tests cover `buildTools` given the flag; these cover
 * the wiring that produces the flag — the gap that shipped the tools with
 * no caller able to reach them.
 *
 * Acceptance criteria verified:
 *  1. Gate ON  → propose tools reach the streamText toolset (single-workspace).
 *  2. Gate OFF → they do not, while the read-only graph tools survive.
 *  3. Same wiring on the multi-workspace branch (the two sites stay in sync).
 *  4. The gate is consulted with the acting orgId.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must come before any import that transitively loads them.
// ---------------------------------------------------------------------------
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getWorkspaceChannelName: vi.fn(() => "ch"),
  PUSHER_EVENTS: { HIGHLIGHT_NODES: "highlight" },
}));
vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn(() => ({})),
  listConcepts: vi.fn(async () => ({ concepts: [] })),
  createHasEndMarkerCondition: vi.fn(() => () => false),
}));
vi.mock("@/lib/ai/askToolsMulti", () => ({ askToolsMulti: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/workspaceConfig", () => ({
  buildWorkspaceConfigs: vi.fn(async (slugs: string[]) =>
    slugs.map((slug, i) => ({
      workspaceId: `ws-${i + 1}`,
      userId: "user-1",
      slug,
      swarmUrl: "https://swarm",
      swarmApiKey: "key",
      repoUrls: [],
      pat: "pat",
      description: "",
      members: [],
      currentUserGithubUsername: null,
    })),
  ),
  buildPublicWorkspaceConfig: vi.fn(),
  fetchConceptsForWorkspaces: vi.fn(async () => ({})),
}));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/infraTools", () => ({ buildInfraTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkerTools", () => ({
  buildGraphWalkerTools: vi.fn(() => ({ graph_get: {}, graph_search: {} })),
}));
vi.mock("@/lib/ai/graphWalkDispatchTools", () => ({
  buildGraphWalkDispatchTools: vi.fn(() => ({ dispatch_graph_walk: {} })),
}));
vi.mock("@/lib/ai/graphWriteTools", () => ({
  buildGraphWriteTools: vi.fn(() => ({
    propose_create_node: {},
    propose_node_edit: {},
    propose_create_triplet: {},
    propose_create_batch_triplet: {},
  })),
}));
vi.mock("@/lib/ai/workflowExplorerTools", () => ({ buildWorkflowExplorerTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/promptTools", () => ({ buildPromptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/conceptTools", () => ({ buildConceptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/canvas/linkedWorkspaces", () => ({
  getLinkedWorkspacesForInitiative: vi.fn(() => []),
}));
vi.mock("@/lib/ai/message-sanitizer", () => ({
  sanitizeAndCompleteToolCalls: vi.fn(async (msgs: unknown) => msgs),
}));
vi.mock("@/lib/ai/provider", () => ({
  getModel: vi.fn(() => ({ modelId: "mock-model" })),
  getApiKeyForProvider: vi.fn(() => "api-key"),
}));
vi.mock("aieo", () => ({ getProviderOptions: vi.fn(() => ({})) }));
vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/canvas-system-prompt", () => ({
  getCanvasSystemPrompt: vi.fn(async () => ({ value: "system", promptId: null })),
}));

const isGraphWriteCapabilityEnabledForOrg = vi.fn<
  (orgId: string | undefined) => Promise<boolean>
>();
vi.mock("@/lib/ai/capabilityGates", () => ({
  isPromptsCapabilityEnabledForOrg: vi.fn(async () => false),
  isGraphWriteCapabilityEnabledForOrg: (orgId: string | undefined) =>
    isGraphWriteCapabilityEnabledForOrg(orgId),
}));
vi.mock("@/lib/constants/prompt", () => ({
  getMultiWorkspacePrefixMessages: vi.fn(() => []),
  getQuickAskPrefixMessages: vi.fn(() => []),
  buildCanvasScopeMessage: vi.fn(() => null),
  getRoadmapCapabilitySnippet: vi.fn(() => ""),
  getWhiteboardCapabilitySnippet: vi.fn(() => ""),
  getPlannerCapabilitySnippet: vi.fn(() => ""),
  getResearchCapabilitySnippet: vi.fn(() => ""),
  getConnectionsCapabilitySnippet: vi.fn(() => ""),
  getGraphWalkerCapabilitySnippet: vi.fn(() => ""),
  getInfraCapabilitySnippet: vi.fn(() => ""),
  getWorkflowsCapabilitySnippet: vi.fn(() => ""),
  getPromptsCapabilitySnippet: vi.fn(() => ""),
  getConceptsCapabilitySnippet: vi.fn(() => ""),
  getCanvasPromptSuffix: vi.fn(() => ""),
}));

const mockStreamText = vi.fn(() => ({
  toUIMessageStreamResponse: vi.fn(() => new Response("ok")),
  consumeStream: vi.fn(async () => {}),
}));
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...(args as [])),
  tool: vi.fn((t: unknown) => t),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import type { ModelMessage } from "ai";

const WRITE_TOOLS = [
  "propose_create_node",
  "propose_node_edit",
  "propose_create_triplet",
  "propose_create_batch_triplet",
] as const;

/** Tool names handed to streamText on the most recent run. */
function toolNames(): string[] {
  const opts = mockStreamText.mock.calls.at(-1)?.[0] as
    | { tools?: Record<string, unknown> }
    | undefined;
  return Object.keys(opts?.tools ?? {});
}

function opts(overrides: Partial<Parameters<typeof runCanvasAgent>[0]> = {}) {
  return {
    userId: "user-1",
    orgId: "org-1",
    workspaceSlugs: ["ws-slug"],
    capabilities: ["graph_walker"],
    messages: [{ role: "user", content: "hello" }] as ModelMessage[],
    ...overrides,
  } satisfies Parameters<typeof runCanvasAgent>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runCanvasAgent — graph-write org gate wiring", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    isGraphWriteCapabilityEnabledForOrg.mockResolvedValue(false);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("hands the propose tools to the model when the org gate is on", async () => {
    isGraphWriteCapabilityEnabledForOrg.mockResolvedValue(true);

    await runCanvasAgent(opts());

    const names = toolNames();
    for (const t of WRITE_TOOLS) expect(names).toContain(t);
  });

  it("withholds them when the gate is off, keeping the read tools", async () => {
    await runCanvasAgent(opts());

    const names = toolNames();
    for (const t of WRITE_TOOLS) expect(names).not.toContain(t);
    expect(names).toContain("graph_get");
    expect(names).toContain("dispatch_graph_walk");
  });

  it("applies the same wiring on the multi-workspace branch", async () => {
    isGraphWriteCapabilityEnabledForOrg.mockResolvedValue(true);

    await runCanvasAgent(opts({ workspaceSlugs: ["ws-a", "ws-b"] }));

    const names = toolNames();
    for (const t of WRITE_TOOLS) expect(names).toContain(t);
  });

  it("consults the gate with the acting orgId", async () => {
    await runCanvasAgent(opts());

    expect(isGraphWriteCapabilityEnabledForOrg).toHaveBeenCalledWith("org-1");
  });
});
