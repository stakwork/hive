/**
 * Unit tests for the `web_fetch` wiring in runCanvasAgent.
 *
 * `createWebFetch` (aieo, via `@/lib/ai/provider`) builds one handle per
 * run — Anthropic's native tool or aieo's guarded HTTP shim — and
 * runCanvasAgent is the only place that registers it. These cover the
 * registration rules, which mirror `web_search`:
 *  1. The tool reaches the streamText toolset as `web_fetch`, beside `web_search`.
 *  2. It survives `readonly: true` (reading a public page touches nothing of ours).
 *  3. It is registered after `additionalTools`, so a caller can't shadow it.
 *  4. A handle without a tool (Anthropic, no key) is dropped, not fatal.
 *  5. Each step's content is fed to the handle's `capture`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted handles — referenced from the provider mock factory below, which
// vitest hoists above every import.
// ---------------------------------------------------------------------------
const handles = vi.hoisted(() => ({
  fetchTool: { description: "mock web_fetch", execute: vi.fn() },
  fetchCapture: vi.fn(),
  createWebFetch: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks — must come before any import that transitively loads them.
// ---------------------------------------------------------------------------
vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  },
}));
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
  markOrgDefaultWorkspace: vi.fn(async (configs: unknown[]) => configs),
}));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/htmlArtifactTools", () => ({ buildHtmlArtifactTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/infraTools", () => ({ buildInfraTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkerTools", () => ({
  buildGraphWalkerTools: vi.fn(() => ({ graph_get: {}, graph_search: {} })),
}));
vi.mock("@/lib/ai/graphWalkDispatchTools", () => ({
  buildGraphWalkDispatchTools: vi.fn(() => ({ dispatch_graph_walk: {} })),
}));
vi.mock("@/lib/ai/graphWriteTools", () => ({ buildGraphWriteTools: vi.fn(() => ({})) }));
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
  WEB_SEARCH_TOOL_NAME: "web_search",
  WEB_FETCH_TOOL_NAME: "web_fetch",
  createWebFetch: (...args: unknown[]) => handles.createWebFetch(...args),
  createWebSearch: vi.fn(() => ({
    tool: { description: "mock web_search", execute: vi.fn() },
    backend: "anthropic",
    native: true,
    results: [],
    capture: vi.fn(),
    promptSnippet: "",
    formatOutput: (markdown: string) => ({ content: markdown, converted: 0, skipped: 0 }),
  })),
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
import { createWebSearch } from "@/lib/ai/provider";
import type { ModelMessage, ToolSet } from "ai";

type StreamTextOpts = {
  tools?: Record<string, unknown>;
  onStepFinish?: (step: { content: unknown[] }) => Promise<void> | void;
};

/** The options handed to streamText on the most recent run. */
function lastStreamTextOpts(): StreamTextOpts {
  return (mockStreamText.mock.calls.at(-1)?.[0] ?? {}) as StreamTextOpts;
}

function fetchHandle(overrides: Record<string, unknown> = {}) {
  return {
    tool: handles.fetchTool,
    backend: "anthropic",
    native: true,
    results: [],
    capture: handles.fetchCapture,
    ...overrides,
  };
}

function opts(overrides: Partial<Parameters<typeof runCanvasAgent>[0]> = {}) {
  return {
    userId: "user-1",
    orgId: "org-1",
    workspaceSlugs: ["ws-slug"],
    capabilities: ["graph_walker"],
    messages: [{ role: "user", content: "hello" }] as ModelMessage[],
    silentPusher: true,
    ...overrides,
  } satisfies Parameters<typeof runCanvasAgent>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runCanvasAgent — web_fetch wiring", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    handles.createWebFetch.mockReturnValue(fetchHandle());
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("registers web_fetch beside web_search with the run's provider and key", async () => {
    await runCanvasAgent(opts());

    const { tools } = lastStreamTextOpts();
    expect(tools?.web_fetch).toBe(handles.fetchTool);
    expect(tools).toHaveProperty("web_search");

    // One handle per run, built from the same provider/key as web_search.
    expect(handles.createWebFetch).toHaveBeenCalledTimes(1);
    const searchArgs = vi.mocked(createWebSearch).mock.calls[0][0];
    expect(handles.createWebFetch).toHaveBeenCalledWith(
      expect.objectContaining({ provider: searchArgs.provider, apiKey: "api-key" }),
    );
  });

  it("survives the readonly strip, like web_search", async () => {
    await runCanvasAgent(opts({ readonly: true }));

    const { tools } = lastStreamTextOpts();
    expect(tools?.web_fetch).toBe(handles.fetchTool);
    expect(tools).toHaveProperty("web_search");
  });

  it("is registered after additionalTools, so a caller cannot shadow it", async () => {
    const impostor = { description: "impostor" };
    await runCanvasAgent(
      opts({ additionalTools: { web_fetch: impostor } as unknown as ToolSet }),
    );

    expect(lastStreamTextOpts().tools?.web_fetch).toBe(handles.fetchTool);
  });

  it("drops the tool (with a warning) when the handle has none, keeping web_search", async () => {
    handles.createWebFetch.mockReturnValueOnce(
      fetchHandle({ tool: undefined, backend: undefined, native: false }),
    );
    await runCanvasAgent(opts());

    const { tools } = lastStreamTextOpts();
    expect(tools).not.toHaveProperty("web_fetch");
    expect(tools).toHaveProperty("web_search");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no web_fetch backend"));
  });

  it("feeds every step's content to the handle's capture", async () => {
    await runCanvasAgent(opts());

    const { onStepFinish } = lastStreamTextOpts();
    expect(onStepFinish).toBeTypeOf("function");
    const content = [
      {
        type: "tool-result",
        toolName: "web_fetch",
        output: { type: "web_fetch_result", url: "https://example.com" },
      },
    ];
    await onStepFinish!({ content });

    expect(handles.fetchCapture).toHaveBeenCalledTimes(1);
    expect(handles.fetchCapture).toHaveBeenCalledWith(content);
  });
});
