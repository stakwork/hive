/**
 * Unit tests for how runCanvasAgent picks the `web_search` / `web_fetch`
 * backend on Bifrost-routed runs.
 *
 * Anthropic's native web tools are server tools, and the Bifrost gateway
 * re-versions them from the model name (`web_search_20250305` leaves as
 * `web_search_20260209`), which hands the model a `code_execution` sandbox
 * we never declared and ends the turn with a 400. So when the same rollout
 * gates the orchestrator applies say the call will ride Bifrost, the
 * runner pins both tools to aieo's shims instead:
 *  1. Gates open (workspace allow-listed, agent allow-listed, real user)
 *     → `backend: "exa"` for search, `backend: "http"` for fetch.
 *  2. Workspace gate closed → no `backend` override (aieo keeps native).
 *  3. Agent gate excludes this surface → no `backend` override.
 *  4. The agent gate is evaluated against the surface's own name
 *     (`canvas-agent` with an orgId, `chat-agent` without).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted handles — referenced from the provider mock factory below, which
// vitest hoists above every import.
// ---------------------------------------------------------------------------
const handles = vi.hoisted(() => ({
  createWebSearch: vi.fn(),
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
  createWebSearch: (...args: unknown[]) => handles.createWebSearch(...args),
  createWebFetch: (...args: unknown[]) => handles.createWebFetch(...args),
}));
vi.mock("aieo", () => ({ getProviderOptions: vi.fn(() => ({})) }));
vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/canvas-system-prompt", () => ({
  getCanvasSystemPrompt: vi.fn(async () => ({ value: "system", promptId: null })),
}));
vi.mock("@/lib/ai/capabilityGates", () => ({
  isJamieSlimPromptEnabledForUser: vi.fn(async () => false),
  isPromptsCapabilityEnabledForOrg: vi.fn(async () => false),
  isGraphWriteCapabilityEnabledForOrg: vi.fn(async () => false),
  isCodeChangeCapabilityEnabledForOrg: vi.fn(async () => false),
  isStrutCapabilityEnabledForOrg: vi.fn(async () => false),
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
import type { ModelMessage } from "ai";

function searchHandle() {
  return {
    tool: { description: "mock web_search", execute: vi.fn() },
    backend: "anthropic",
    native: true,
    results: [],
    capture: vi.fn(),
    promptSnippet: "",
    formatOutput: (markdown: string) => ({ content: markdown, converted: 0, skipped: 0 }),
  };
}

function fetchHandle() {
  return {
    tool: { description: "mock web_fetch", execute: vi.fn() },
    backend: "anthropic",
    native: true,
    results: [],
    capture: vi.fn(),
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

/** The options the runner handed to `createWebSearch` / `createWebFetch`. */
function handleArgs() {
  return {
    search: handles.createWebSearch.mock.calls.at(-1)?.[0] as Record<string, unknown>,
    fetch: handles.createWebFetch.mock.calls.at(-1)?.[0] as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runCanvasAgent — web tools on Bifrost-routed runs", () => {
  const savedEnv = {
    BIFROST_ENABLED: process.env.BIFROST_ENABLED,
    BIFROST_ENABLED_AGENTS: process.env.BIFROST_ENABLED_AGENTS,
  };
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    handles.createWebSearch.mockReturnValue(searchHandle());
    handles.createWebFetch.mockReturnValue(fetchHandle());
    delete process.env.BIFROST_ENABLED;
    delete process.env.BIFROST_ENABLED_AGENTS;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("pins web_search to the Exa shim and web_fetch to the HTTP shim when the gates cover the run", async () => {
    process.env.BIFROST_ENABLED = "ws-slug";

    await runCanvasAgent(opts());

    const { search, fetch } = handleArgs();
    expect(search).toEqual(expect.objectContaining({ provider: "anthropic", apiKey: "api-key", backend: "exa" }));
    expect(fetch).toEqual(expect.objectContaining({ provider: "anthropic", apiKey: "api-key", backend: "http" }));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("bifrost-routed run"),
      expect.objectContaining({ workspaces: ["ws-slug"], orgId: "org-1" }),
    );
  });

  it("leaves the backend to aieo when the workspace gate is closed", async () => {
    process.env.BIFROST_ENABLED = "some-other-slug";

    await runCanvasAgent(opts());

    const { search, fetch } = handleArgs();
    expect(search).not.toHaveProperty("backend");
    expect(fetch).not.toHaveProperty("backend");
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("bifrost-routed run"), expect.anything());
  });

  it("leaves the backend to aieo when BIFROST_ENABLED is unset (default-closed)", async () => {
    await runCanvasAgent(opts());

    const { search, fetch } = handleArgs();
    expect(search).not.toHaveProperty("backend");
    expect(fetch).not.toHaveProperty("backend");
  });

  it("leaves the backend to aieo when the agent gate excludes this surface", async () => {
    process.env.BIFROST_ENABLED = "*";
    process.env.BIFROST_ENABLED_AGENTS = "repo-agent,workflow-agent";

    await runCanvasAgent(opts());

    const { search, fetch } = handleArgs();
    expect(search).not.toHaveProperty("backend");
    expect(fetch).not.toHaveProperty("backend");
  });

  it("evaluates the agent gate against canvas-agent when an orgId is present", async () => {
    process.env.BIFROST_ENABLED = "*";
    process.env.BIFROST_ENABLED_AGENTS = "canvas-agent";

    await runCanvasAgent(opts());

    const { search, fetch } = handleArgs();
    expect(search).toEqual(expect.objectContaining({ backend: "exa" }));
    expect(fetch).toEqual(expect.objectContaining({ backend: "http" }));
  });

  it("evaluates the agent gate against chat-agent when there is no orgId", async () => {
    process.env.BIFROST_ENABLED = "*";
    process.env.BIFROST_ENABLED_AGENTS = "chat-agent";

    await runCanvasAgent(opts({ orgId: undefined }));

    const { search, fetch } = handleArgs();
    expect(search).toEqual(expect.objectContaining({ backend: "exa" }));
    expect(fetch).toEqual(expect.objectContaining({ backend: "http" }));
  });
});
