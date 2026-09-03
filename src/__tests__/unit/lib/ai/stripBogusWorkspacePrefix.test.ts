/**
 * Unit tests for the hallucinated-`{workspace}__`-prefix tool-call repair
 * (stripBogusWorkspacePrefix + the experimental_repairToolCall wiring in
 * runCanvasAgent).
 *
 * Prod motivation: the model called `stakwork__list_prompts` (workspace-
 * slug prefix glued onto the bare org-level `list_prompts` tool), which
 * the AI SDK rejects as an unavailable tool. The repair strips the bogus
 * prefix when — and only when — the remainder is a registered tool.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must come before any import that transitively loads them.
// ---------------------------------------------------------------------------
vi.mock("@/lib/db", () => ({
  db: { workspace: { findFirst: vi.fn(async () => null) } },
}));
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getWorkspaceChannelName: vi.fn(() => "ch"),
  PUSHER_EVENTS: { HIGHLIGHT_NODES: "highlight" },
}));
vi.mock("@/lib/ai/askTools", () => ({
  // Single-workspace toolset: one bare global tool the repair can
  // resolve to, plus a decoy whose name embeds `__` internally.
  askTools: vi.fn(() => ({
    web_search: { description: "d", inputSchema: {}, execute: vi.fn() },
    list_prompts: { description: "d", inputSchema: {}, execute: vi.fn() },
  })),
  listConcepts: vi.fn(async () => ({ concepts: [] })),
  createHasEndMarkerCondition: vi.fn(() => () => false),
}));
vi.mock("@/lib/ai/askToolsMulti", () => ({ askToolsMulti: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/workspaceConfig", () => ({
  buildWorkspaceConfigs: vi.fn(async () => [
    {
      workspaceId: "ws-1",
      userId: "user-1",
      slug: "ws-slug",
      swarmUrl: "https://swarm",
      swarmApiKey: "key",
      repoUrls: [],
      pat: "pat",
      description: "",
      members: [],
      currentUserGithubUsername: null,
    },
  ]),
  buildPublicWorkspaceConfig: vi.fn(),
  fetchConceptsForWorkspaces: vi.fn(async () => ({})),
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
  WEB_SEARCH_TOOL_NAME: "web_search",
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

// Controllable streamText mock that captures the options it was called
// with, so tests can pull out experimental_repairToolCall and drive it.
// NoSuchToolError mirrors the AI SDK's static isInstance contract.
const { mockStreamText, MockNoSuchToolError } = vi.hoisted(() => {
  class MockNoSuchToolError extends Error {
    static isInstance(e: unknown): boolean {
      return e instanceof MockNoSuchToolError;
    }
  }
  return {
    MockNoSuchToolError,
    mockStreamText: vi.fn((..._args: unknown[]) => ({
      toUIMessageStreamResponse: vi.fn(),
      consumeStream: vi.fn(async () => {}),
    })),
  };
});
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  tool: vi.fn((t: unknown) => t),
  NoSuchToolError: MockNoSuchToolError,
}));

import {
  runCanvasAgent,
  stripBogusWorkspacePrefix,
} from "@/lib/ai/runCanvasAgent";
import type { ModelMessage, ToolSet } from "ai";

const TOOLS = {
  list_prompts: {},
  web_search: {},
  stakwork__list_concepts: {},
} as unknown as ToolSet;

describe("stripBogusWorkspacePrefix", () => {
  test("strips a workspace-slug prefix when the bare tool is registered", () => {
    expect(stripBogusWorkspacePrefix("stakwork__list_prompts", TOOLS)).toBe(
      "list_prompts",
    );
    expect(stripBogusWorkspacePrefix("hive__web_search", TOOLS)).toBe(
      "web_search",
    );
  });

  test("returns null when the suffix is not a registered tool", () => {
    expect(stripBogusWorkspacePrefix("stakwork__get_prompt", TOOLS)).toBeNull();
  });

  test("returns null for names without a __ separator or with a leading one", () => {
    expect(stripBogusWorkspacePrefix("list_prompts_typo", TOOLS)).toBeNull();
    expect(stripBogusWorkspacePrefix("__list_prompts", TOOLS)).toBeNull();
  });

  test("walks multiple __ boundaries until a registered suffix matches", () => {
    // First boundary yields "ws__list_prompts" (unregistered); the second
    // yields the real tool.
    expect(stripBogusWorkspacePrefix("my__ws__list_prompts", TOOLS)).toBe(
      "list_prompts",
    );
    // A doubly-prefixed namespaced tool resolves to the namespaced name.
    expect(
      stripBogusWorkspacePrefix("bogus__stakwork__list_concepts", TOOLS),
    ).toBe("stakwork__list_concepts");
  });
});

describe("runCanvasAgent — experimental_repairToolCall wiring", () => {
  beforeEach(() => {
    mockStreamText.mockClear();
  });

  async function captureRepairFn() {
    await runCanvasAgent({
      userId: "user-1",
      workspaceSlugs: ["ws-slug"],
      messages: [{ role: "user", content: "hello" }] as ModelMessage[],
    });
    expect(mockStreamText).toHaveBeenCalledTimes(1);
    const opts = mockStreamText.mock.calls[0][0] as unknown as {
      tools: ToolSet;
      experimental_repairToolCall?: (args: {
        toolCall: { type: string; toolCallId: string; toolName: string; input: string };
        tools: ToolSet;
        error: unknown;
      }) => Promise<{ toolName: string } | null>;
    };
    expect(typeof opts.experimental_repairToolCall).toBe("function");
    return opts;
  }

  test("repairs a slug-prefixed call to the registered bare tool on NoSuchToolError", async () => {
    const opts = await captureRepairFn();
    const repaired = await opts.experimental_repairToolCall!({
      toolCall: {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "ws-slug__list_prompts",
        input: "{}",
      },
      tools: opts.tools,
      error: new MockNoSuchToolError("Model tried to call unavailable tool"),
    });
    expect(repaired).toMatchObject({
      toolCallId: "c1",
      toolName: "list_prompts",
      input: "{}",
    });
  });

  test("returns null for non-NoSuchToolError errors (invalid input is not repaired)", async () => {
    const opts = await captureRepairFn();
    const repaired = await opts.experimental_repairToolCall!({
      toolCall: {
        type: "tool-call",
        toolCallId: "c2",
        toolName: "ws-slug__list_prompts",
        input: "not-json",
      },
      tools: opts.tools,
      error: new Error("InvalidToolInputError"),
    });
    expect(repaired).toBeNull();
  });

  test("returns null when the stripped name is not a registered tool", async () => {
    const opts = await captureRepairFn();
    const repaired = await opts.experimental_repairToolCall!({
      toolCall: {
        type: "tool-call",
        toolCallId: "c3",
        toolName: "ws-slug__totally_made_up",
        input: "{}",
      },
      tools: opts.tools,
      error: new MockNoSuchToolError("Model tried to call unavailable tool"),
    });
    expect(repaired).toBeNull();
  });
});
