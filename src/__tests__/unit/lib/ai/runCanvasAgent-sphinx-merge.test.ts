/**
 * Unit tests for send_sphinx_message merge wiring in runCanvasAgent.
 *
 * The candidate/connected rules live in resolveSphinxToolTarget; this
 * file asserts the helper is actually consulted on both tool-assembly
 * branches and that the tool lands in (or stays out of) streamText's
 * toolset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn<(...args: unknown[]) => Promise<{ id: string; slug: string } | null>>(
    async () => null,
  ),
}));

vi.mock("@/lib/db", () => ({
  db: { workspace: { findFirst: mockFindFirst } },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getWorkspaceChannelName: vi.fn(() => "ch"),
  PUSHER_EVENTS: { HIGHLIGHT_NODES: "highlight" },
}));
vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn(() => ({ list_concepts: {} })),
  listConcepts: vi.fn(async () => ({ concepts: [] })),
  createHasEndMarkerCondition: vi.fn(() => () => false),
}));
vi.mock("@/lib/ai/askToolsMulti", () => ({
  askToolsMulti: vi.fn(() => ({ list_concepts: {} })),
}));
vi.mock("@/lib/ai/workspaceConfig", () => ({
  buildWorkspaceConfigs: vi.fn(async (slugs: string[]) =>
    slugs.map((slug) => ({
      workspaceId: `cuid-${slug}`,
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
  buildPublicWorkspaceConfig: vi.fn(async (slug: string) => ({
    workspaceId: `cuid-${slug}`,
    userId: "__public_viewer__",
    slug,
    swarmUrl: "https://swarm",
    swarmApiKey: "key",
    repoUrls: [],
    pat: "pat",
    description: "",
    members: [],
  })),
  fetchConceptsForWorkspaces: vi.fn(async () => ({})),
  markOrgDefaultWorkspace: vi.fn(async (configs: unknown) => configs),
}));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/htmlArtifactTools", () => ({ buildHtmlArtifactTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/infraTools", () => ({ buildInfraTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkerTools", () => ({ buildGraphWalkerTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkDispatchTools", () => ({ buildGraphWalkDispatchTools: vi.fn(() => ({})) }));
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
vi.mock("@/lib/ai/capabilityGates", () => ({
  isPromptsCapabilityEnabledForOrg: vi.fn(async () => false),
  isGraphWriteCapabilityEnabledForOrg: vi.fn(async () => false),
  isCodeChangeCapabilityEnabledForOrg: vi.fn(async () => false),
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
  getHtmlPagesCapabilitySnippet: vi.fn(() => ""),
  getGraphWalkerCapabilitySnippet: vi.fn(() => ""),
  getInfraCapabilitySnippet: vi.fn(() => ""),
  getWorkflowsCapabilitySnippet: vi.fn(() => ""),
  getPromptsCapabilitySnippet: vi.fn(() => ""),
  getConceptsCapabilitySnippet: vi.fn(() => ""),
  getCanvasPromptSuffix: vi.fn(() => ""),
}));
vi.mock("@/lib/ai/sphinxTools", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/sphinxTools")>(
    "@/lib/ai/sphinxTools",
  );
  return {
    ...actual,
    buildSphinxTools: vi.fn(() => ({
      send_sphinx_message: { description: "sphinx" },
    })),
  };
});

const mockStreamText = vi.fn((..._args: unknown[]) => ({
  toUIMessageStreamResponse: vi.fn(),
  consumeStream: vi.fn(async () => {}),
}));
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  tool: vi.fn((t: unknown) => t),
}));

import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import { buildSphinxTools } from "@/lib/ai/sphinxTools";
import type { ModelMessage } from "ai";

function toolNames(): string[] {
  const lastCall = mockStreamText.mock.calls.at(-1);
  const callOpts = lastCall?.[0] as { tools?: Record<string, unknown> } | undefined;
  return Object.keys(callOpts?.tools ?? {});
}

function opts(overrides: Partial<Parameters<typeof runCanvasAgent>[0]> = {}) {
  return {
    userId: "user-1",
    workspaceSlugs: ["alpha"],
    messages: [{ role: "user", content: "hello" }] as ModelMessage[],
    ...overrides,
  } satisfies Parameters<typeof runCanvasAgent>[0];
}

describe("runCanvasAgent — send_sphinx_message merge", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockFindFirst.mockResolvedValue({ id: "cuid-alpha", slug: "alpha" });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("merges for a single-workspace call even when orgId is undefined", async () => {
    await runCanvasAgent(opts());

    expect(buildSphinxTools).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "cuid-alpha",
      workspaceSlug: "alpha",
    });
    expect(toolNames()).toContain("send_sphinx_message");
  });

  it("omits the tool when the in-scope workspace is not Sphinx-connected", async () => {
    mockFindFirst.mockResolvedValue(null);

    await runCanvasAgent(opts());

    expect(buildSphinxTools).not.toHaveBeenCalled();
    expect(toolNames()).not.toContain("send_sphinx_message");
  });

  it("omits the tool when readonly", async () => {
    await runCanvasAgent(opts({ readonly: true }));

    expect(buildSphinxTools).not.toHaveBeenCalled();
    expect(toolNames()).not.toContain("send_sphinx_message");
  });

  it("omits the tool when silentPusher", async () => {
    await runCanvasAgent(opts({ silentPusher: true }));

    expect(buildSphinxTools).not.toHaveBeenCalled();
    expect(toolNames()).not.toContain("send_sphinx_message");
  });

  it("omits the tool for a public viewer", async () => {
    await runCanvasAgent(
      opts({
        userId: null,
        publicViewer: { workspaceId: "cuid-alpha", primarySlug: "alpha" },
      }),
    );

    expect(buildSphinxTools).not.toHaveBeenCalled();
    expect(toolNames()).not.toContain("send_sphinx_message");
  });

  it("omits the tool on multi-workspace org-root / initiative scope", async () => {
    await runCanvasAgent(
      opts({
        workspaceSlugs: ["alpha", "beta"],
        scope: { currentCanvasRef: "" },
      }),
    );
    expect(buildSphinxTools).not.toHaveBeenCalled();

    await runCanvasAgent(
      opts({
        workspaceSlugs: ["alpha", "beta"],
        scope: { currentCanvasRef: "initiative:init-1" },
      }),
    );
    expect(buildSphinxTools).not.toHaveBeenCalled();
    expect(toolNames()).not.toContain("send_sphinx_message");
  });

  it("merges for multi-workspace only when currentCanvasRef is ws:<id> of a connected conversation workspace", async () => {
    mockFindFirst.mockResolvedValue({ id: "cuid-alpha", slug: "alpha" });

    await runCanvasAgent(
      opts({
        workspaceSlugs: ["alpha", "beta"],
        scope: { currentCanvasRef: "ws:cuid-alpha" },
      }),
    );

    expect(buildSphinxTools).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "cuid-alpha",
      workspaceSlug: "alpha",
    });
    expect(toolNames()).toContain("send_sphinx_message");
  });

  it("strips send_sphinx_message from a readonly org toolset even if it were merged", async () => {
    await runCanvasAgent(
      opts({
        orgId: "org-1",
        readonly: true,
        capabilities: ["infra"],
      }),
    );

    expect(toolNames()).not.toContain("send_sphinx_message");
  });
});
