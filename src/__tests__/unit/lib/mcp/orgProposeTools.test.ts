// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const {
  mockAppend,
  mockResolveConv,
  mockCapability,
  mockFindOrg,
  executeMocks,
} = vi.hoisted(() => ({
  mockAppend: vi.fn(),
  mockResolveConv: vi.fn(),
  mockCapability: vi.fn(),
  mockFindOrg: vi.fn(),
  executeMocks: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

const CONCEPT = ["propose_new_concept", "propose_concept_update"];
const GRAPH = [
  "propose_create_node",
  "propose_node_edit",
  "propose_create_triplet",
  "propose_create_batch_triplet",
  "propose_delete_edge",
  "propose_move_node",
  "propose_delete_node",
];

function fakeTools(names: string[]) {
  return Object.fromEntries(
    names.map((n) => {
      executeMocks[n] = executeMocks[n] ?? vi.fn();
      return [
        n,
        {
          description: `desc of ${n}`,
          inputSchema: z.object({ foo: z.string() }),
          execute: (...a: unknown[]) => executeMocks[n](...a),
        },
      ];
    }),
  );
}

vi.mock("@/lib/ai/conceptTools", () => ({
  buildConceptTools: () => fakeTools(CONCEPT),
}));
vi.mock("@/lib/ai/graphWriteTools", () => ({
  buildGraphWriteTools: () => fakeTools(GRAPH),
}));
vi.mock("@/lib/ai/capabilityGates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/capabilityGates")>()),
  isGraphWriteCapabilityEnabledForOrg: mockCapability,
}));
vi.mock("@/services/org-canvas-conversation", () => ({
  resolveOrgConversationRowId: mockResolveConv,
}));
vi.mock("@/services/canvas-turn-persistence", () => ({
  appendTurnMessages: mockAppend,
}));
vi.mock("@/lib/db", () => ({
  db: { sourceControlOrg: { findUnique: mockFindOrg } },
}));
vi.mock("@/lib/mcp/orgMcpTools", () => ({}));

import { registerOrgProposeTools } from "@/lib/mcp/orgProposeTools";
import { findProposal } from "@/lib/proposals/handleApproval";

type Handler = (
  args: Record<string, unknown>,
  extra: unknown,
) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const handlers: Record<string, Handler> = {};
const configs: Record<string, { description: string; inputSchema: Record<string, unknown> }> = {};
const server = {
  registerTool: (name: string, cfg: never, h: Handler) => {
    configs[name] = cfg;
    handlers[name] = h;
  },
};

const extraFor = (permissions: string[]) => ({
  authInfo: {
    extra: { scope: "org", orgId: "org1", userId: "u1", permissions, purpose: "x" },
  },
});
const ALL = [...CONCEPT, ...GRAPH];
const PROPOSAL = { kind: "k", proposalId: "p1", payload: {}, meta: {} };

describe("registerOrgProposeTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(executeMocks).forEach((m) => m.mockReset());
    mockResolveConv.mockResolvedValue("conv1");
    mockCapability.mockResolvedValue(true);
    mockAppend.mockResolvedValue(true);
    mockFindOrg.mockResolvedValue({ githubLogin: "acme" });
    for (const n of ALL) executeMocks[n]?.mockResolvedValue(PROPOSAL);
    registerOrgProposeTools(server as never);
  });

  it("registers all nine tools with conversationId added", () => {
    for (const n of ALL) {
      expect(handlers[n]).toBeDefined();
      expect(configs[n].inputSchema).toHaveProperty("foo");
      expect(configs[n].inputSchema).toHaveProperty("conversationId");
      expect(configs[n].description).toContain(`desc of ${n}`);
      expect(configs[n].description).toContain("approve");
    }
  });

  it.each(ALL)("%s appends one card row and returns proposalId", async (n) => {
    const res = await handlers[n]({ foo: "bar", conversationId: "conv1" }, extraFor(["read", "write"]));
    expect(res.isError).toBeUndefined();
    const body = JSON.parse(res.content[0].text);
    expect(body.proposalId).toBe("p1");
    expect(body.link).toContain("/org/acme?chat=conv1");
    expect(executeMocks[n].mock.calls[0][0]).toEqual({ foo: "bar" });
    expect(mockAppend).toHaveBeenCalledTimes(1);
    const arg = mockAppend.mock.calls[0][0];
    expect(arg.reason).toBe("mcp");
    expect(arg.rows).toHaveLength(1);
    const row = arg.rows[0];
    expect(row.id).toMatch(/^mcp-.+-a0$/);
    expect(row.id.startsWith(arg.idPrefix)).toBe(true);
    expect(row.toolCalls).toEqual([
      expect.objectContaining({
        toolName: n,
        input: { foo: "bar" },
        output: PROPOSAL,
        status: "output-available",
      }),
    ]);
  });

  it("refuses read-only tokens", async () => {
    const res = await handlers.propose_new_concept({ foo: "a", conversationId: "c" }, extraFor(["read"]));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("write permission required");
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("refuses unknown conversation", async () => {
    mockResolveConv.mockResolvedValue(null);
    const res = await handlers.propose_new_concept({ foo: "a", conversationId: "c" }, extraFor(["write"]));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("conversation not found");
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("append returning false -> conversation not found error", async () => {
    mockAppend.mockResolvedValue(false);
    const res = await handlers.propose_new_concept({ foo: "a", conversationId: "c" }, extraFor(["write"]));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Error: conversation not found");
  });

  it("builder error -> isError, no append", async () => {
    executeMocks.propose_delete_node.mockResolvedValue({ error: "nope" });
    const res = await handlers.propose_delete_node({ foo: "a", conversationId: "c" }, extraFor(["write"]));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("nope");
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("graph tool refused when capability disabled; concept tool unaffected", async () => {
    mockCapability.mockResolvedValue(false);
    const g = await handlers.propose_move_node({ foo: "a", conversationId: "c" }, extraFor(["write"]));
    expect(g.isError).toBe(true);
    expect(mockAppend).not.toHaveBeenCalled();
    const c = await handlers.propose_new_concept({ foo: "a", conversationId: "c" }, extraFor(["write"]));
    expect(c.isError).toBeUndefined();
  });

  it("existing approval lookup finds the appended proposal", async () => {
    await handlers.propose_create_node({ foo: "a", conversationId: "c" }, extraFor(["write"]));
    const row = mockAppend.mock.calls[0][0].rows[0];
    expect(findProposal([row], "p1")).toEqual(PROPOSAL);
  });
});
