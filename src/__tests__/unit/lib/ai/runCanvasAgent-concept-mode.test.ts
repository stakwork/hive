/**
 * Concept mode wiring in runCanvasAgent (the A/B arm against full mode).
 *
 * Uses the REAL tool builders, capability registry and prompt builders so the
 * tool list asserted here is the one the model would see: exactly 52 tools on
 * a user turn (53 with `stay_silent` on a wake turn), global and bare-named,
 * sorted by name with `web_search` / `web_fetch` last.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
vi.mock("gitsee/server", () => ({ RepoAnalyzer: vi.fn() }));
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: vi.fn() }));
const askTools = vi.fn(() => ({}));
vi.mock("@/lib/ai/askTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/askTools")>()),
  askTools: (...a: unknown[]) => askTools(...(a as [])),
  listConcepts: vi.fn(async () => ({ concepts: [] })),
}));
const askToolsMulti = vi.fn(() => ({ a__repo_agent: { description: "x" } }));
vi.mock("@/lib/ai/askToolsMulti", () => ({
  askToolsMulti: (...a: unknown[]) => askToolsMulti(...(a as [])),
}));
vi.mock("@/lib/ai/workspaceConfig", () => ({
  buildWorkspaceConfigs: vi.fn(async (slugs: string[]) =>
    slugs.map((slug, i) => ({
      workspaceId: `ws-${i + 1}`,
      userId: "user-1",
      slug,
      name: `Workspace ${slug}`,
      swarmUrl: "https://swarm",
      swarmApiKey: "key",
      repoUrls: [`https://github.com/o/${slug}`],
      pat: "pat",
      description: "",
      members: [{ name: "Roster Person", githubUsername: "roster", role: "OWNER", description: null }],
      currentUserGithubUsername: "alice",
    })),
  ),
  buildPublicWorkspaceConfig: vi.fn(),
  fetchConceptsForWorkspaces: vi.fn(async () => ({})),
  markOrgDefaultWorkspace: vi.fn(async (configs: unknown[]) => configs),
}));
vi.mock("@/lib/canvas/linkedWorkspaces", () => ({ getLinkedWorkspacesForInitiative: vi.fn(() => []) }));
vi.mock("@/lib/ai/message-sanitizer", () => ({
  sanitizeAndCompleteToolCalls: vi.fn(async (msgs: unknown) => msgs),
}));
vi.mock("@/lib/ai/provider", () => ({
  getModel: vi.fn(() => ({ modelId: "mock-model" })),
  getApiKeyForProvider: vi.fn(() => "api-key"),
  WEB_SEARCH_TOOL_NAME: "web_search",
  WEB_FETCH_TOOL_NAME: "web_fetch",
  createWebFetch: vi.fn(() => ({ tool: { description: "web_fetch" }, results: [], capture: vi.fn() })),
  createWebSearch: vi.fn(() => ({
    tool: { description: "web_search" },
    results: [],
    capture: vi.fn(),
    promptSnippet: "",
    formatOutput: (markdown: string) => ({ content: markdown, converted: 0, skipped: 0 }),
  })),
}));
vi.mock("aieo", () => ({
  getProviderOptions: vi.fn(() => ({})),
  hasApiKeyForProvider: vi.fn(() => true),
  PROVIDERS: ["anthropic"],
}));
vi.mock("@/services/bifrost/orchestrator", () => ({ getBifrostForLLM: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/canvas-system-prompt", () => ({
  getCanvasSystemPrompt: vi.fn(async () => ({
    value: "PERSONA FROM PROMPT MANAGER",
    name: "CANVAS_AGENT_SYSTEM_PROMPT",
    promptId: null,
    promptVersionId: null,
  })),
}));
const gates = { prompts: true, strut: true, graphWrite: true };
vi.mock("@/lib/ai/capabilityGates", () => ({
  isPromptsCapabilityEnabledForOrg: vi.fn(async () => gates.prompts),
  isGraphWriteCapabilityEnabledForOrg: vi.fn(async () => gates.graphWrite),
  isStrutCapabilityEnabledForOrg: vi.fn(async () => gates.strut),
}));
const connectExternalMcpTools = vi.fn(async () => ({ tools: {}, closeAll: async () => {} }));
vi.mock("@/lib/ai/externalMcpTools", () => ({
  connectExternalMcpTools: (...a: unknown[]) => connectExternalMcpTools(...(a as [])),
}));

const mockStreamText = vi.fn((..._a: unknown[]) => ({
  toUIMessageStreamResponse: vi.fn(() => new Response("ok")),
  consumeStream: vi.fn(async () => {}),
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText: (...args: unknown[]) => mockStreamText(...args),
}));

import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import { buildDeferredCheckTools } from "@/lib/ai/deferredCheckTools";
import { CONCEPT_MODE_TOOL_NAMES_52 } from "../../../fixtures/concept-mode-tools";
import type { ModelMessage } from "ai";

function lastCall() {
  return mockStreamText.mock.calls.at(-1)?.[0] as {
    tools: Record<string, unknown>;
    messages: ModelMessage[];
  };
}
const toolNames = () => Object.keys(lastCall().tools);
const systemText = () => {
  const sys = lastCall().messages.find((m) => m.role === "system");
  return String(sys?.content ?? "");
};

function opts(overrides: Partial<Parameters<typeof runCanvasAgent>[0]> = {}) {
  return {
    userId: "user-1",
    orgId: "org-1",
    workspaceSlugs: ["alpha", "beta"],
    mode: "concept",
    messages: [{ role: "user", content: "hello" }] as ModelMessage[],
    // `schedule_check` arrives through additionalTools in the quick route.
    additionalTools: buildDeferredCheckTools({ conversationId: "c1", orgId: "org-1", userId: "user-1" }),
    ...overrides,
  } satisfies Parameters<typeof runCanvasAgent>[0];
}

describe("runCanvasAgent — concept mode", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    gates.prompts = gates.strut = gates.graphWrite = true;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  it("hands the model exactly the 52 concept tools: sorted, then web_search / web_fetch", async () => {
    const res = await runCanvasAgent(opts());
    expect(res.mode).toBe("concept");
    const names = toolNames();
    expect(names).toHaveLength(52);
    expect(names.slice(0, -2)).toEqual([...CONCEPT_MODE_TOOL_NAMES_52].filter((n) => !n.startsWith("web_")).sort());
    expect(names.slice(-2)).toEqual(["web_search", "web_fetch"]);
    expect([...names].sort()).toEqual([...CONCEPT_MODE_TOOL_NAMES_52].sort());
    expect(names.some((n) => n.includes("__"))).toBe(false);
  });

  it("adds stay_silent on a wake turn through additionalTools (53)", async () => {
    await runCanvasAgent(
      opts({
        additionalTools: {
          ...buildDeferredCheckTools({ conversationId: "c1", orgId: "org-1", userId: "user-1" }),
          stay_silent: { description: "stay silent" } as never,
        },
      }),
    );
    const names = toolNames();
    expect(names).toHaveLength(53);
    expect(names).toContain("stay_silent");
  });

  it("builds the same toolset for a single-workspace org", async () => {
    await runCanvasAgent(opts({ workspaceSlugs: ["alpha"] }));
    expect([...toolNames()].sort()).toEqual([...CONCEPT_MODE_TOOL_NAMES_52].sort());
    expect(askTools).not.toHaveBeenCalled();
  });

  it("skips the full-mode tool sources: per-workspace tools, learn_capability, Sphinx, external MCP", async () => {
    await runCanvasAgent(opts());
    expect(askToolsMulti).not.toHaveBeenCalled();
    expect(connectExternalMcpTools).not.toHaveBeenCalled();
    const names = toolNames();
    for (const gone of [
      "learn_capability",
      "send_sphinx_message",
      "list_concepts",
      "unassign_feature_from_workspace",
    ]) {
      expect(names).not.toContain(gone);
    }
  });

  it("uses the tiny system prompt: persona + workspaces, no capability text, no seeded pairs", async () => {
    const res = await runCanvasAgent(opts());
    const sys = systemText();
    expect(sys).toContain("PERSONA FROM PROMPT MANAGER");
    expect(sys).toContain("## Available Workspaces & Repositories");
    expect(sys).toContain("slug: `alpha`");
    expect(sys).toContain("slug: `beta`");
    expect(sys).toContain('When you are done print "[END_OF_ANSWER]"');
    expect(sys).toContain("## Current canvas scope");
    for (const gone of [
      "Tool Naming Convention",
      "learn_capability",
      "More capabilities",
      "Team Members",
      "Roster Person",
    ]) {
      expect(sys).not.toContain(gone);
    }
    expect(lastCall().messages.filter((m) => m.role === "assistant" || m.role === "tool")).toHaveLength(0);
    expect(res.assembledPrefix[0].role).toBe("system");
  });

  it("drops gated capabilities' tools for an org that fails the gates", async () => {
    gates.prompts = gates.strut = gates.graphWrite = false;
    await runCanvasAgent(opts());
    const names = toolNames();
    for (const gone of ["get_prompt", "propose_new_prompt", "dispatch_strut", "start_job", "propose_create_node"]) {
      expect(names).not.toContain(gone);
    }
    expect(names).toContain("graph_get");
    expect(names).toContain("repo_agent");
  });

  it("readonly strips the write tools", async () => {
    await runCanvasAgent(opts({ readonly: true }));
    const names = toolNames();
    for (const gone of ["propose_feature", "update_canvas", "save_html", "dispatch_research", "propose_new_concept"]) {
      expect(names).not.toContain(gone);
    }
    expect(names).toContain("read_canvas");
    expect(names).toContain("web_search");
  });

  it("repairs a hallucinated {workspace}__ prefix on a bare concept tool", async () => {
    const { stripBogusWorkspacePrefix } = await import("@/lib/ai/runCanvasAgent");
    await runCanvasAgent(opts());
    expect(stripBogusWorkspacePrefix("alpha__graph_search", lastCall().tools as never)).toBe("graph_search");
  });

  it("runs as full mode without an orgId (concept mode is org-only)", async () => {
    const res = await runCanvasAgent(opts({ orgId: undefined, additionalTools: undefined }));
    expect(res.mode).toBe("full");
    expect(askToolsMulti).toHaveBeenCalled();
  });

  it("defaults to full mode", async () => {
    const res = await runCanvasAgent(opts({ mode: undefined }));
    expect(res.mode).toBe("full");
    expect(askToolsMulti).toHaveBeenCalled();
    expect(systemText()).toContain("Tool Naming Convention");
  });
});
