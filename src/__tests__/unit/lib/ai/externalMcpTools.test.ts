// @vitest-environment node
/**
 * Unit tests for connectExternalMcpTools / decryptMcpHeaders.
 *
 * Covers:
 * - Tool namespacing (`{server}_{tool}`) and toolFilter allowlisting
 * - Result capping: execute wraps MCP content into a capped string,
 *   and `toModelOutput` is stripped
 * - A failed server is skipped without breaking the others
 * - closeAll closes every connected client and is idempotent
 * - Header encryption round-trip and corrupted-header fallback
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db");
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn(),
}));

import { createMCPClient } from "@ai-sdk/mcp";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { connectExternalMcpTools, decryptMcpHeaders } from "@/lib/ai/externalMcpTools";

const mockedDb = vi.mocked(db);
const mockedCreateClient = vi.mocked(createMCPClient);

type ExecutableTool = {
  execute: (args: unknown, opts: unknown) => Promise<unknown>;
  toModelOutput?: unknown;
};

function mcpText(text: string) {
  return { content: [{ type: "text", text }] };
}

function makeClient(tools: Record<string, unknown>) {
  const close = vi.fn(async () => {});
  const client = { tools: vi.fn(async () => tools), close };
  return { client, close };
}

function serverRow(
  overrides: Partial<{ name: string; url: string; headers: string | null; toolFilter: string[] }> = {},
) {
  return {
    name: "linear",
    url: "https://mcp.example.com/mcp",
    headers: null,
    toolFilter: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("connectExternalMcpTools", () => {
  it("returns empty toolset when the org has no servers", async () => {
    mockedDb.orgMcpServer.findMany = vi.fn().mockResolvedValue([]) as never;
    const { tools, closeAll } = await connectExternalMcpTools("org-1");
    expect(tools).toEqual({});
    await closeAll();
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("namespaces tools, applies toolFilter, and caps results", async () => {
    mockedDb.orgMcpServer.findMany = vi.fn().mockResolvedValue([serverRow({ toolFilter: ["create_issue"] })]) as never;
    const execute = vi.fn(async () => mcpText("created ABC-123"));
    const { client } = makeClient({
      create_issue: { description: "Create an issue", execute, toModelOutput: () => {} },
      delete_issue: { description: "Delete", execute: vi.fn() },
    });
    mockedCreateClient.mockResolvedValue(client as never);

    const { tools, closeAll } = await connectExternalMcpTools("org-1");
    expect(Object.keys(tools)).toEqual(["linear_create_issue"]);
    const tool = tools["linear_create_issue"] as unknown as ExecutableTool;
    // MCP-shaped toModelOutput must not survive — execute returns a string.
    expect(tool.toModelOutput).toBeUndefined();
    const result = await tool.execute({ title: "x" }, { toolCallId: "1", messages: [] });
    expect(result).toBe("created ABC-123");
    expect(execute).toHaveBeenCalledOnce();
    await closeAll();
  });

  it("truncates oversized results", async () => {
    mockedDb.orgMcpServer.findMany = vi.fn().mockResolvedValue([serverRow()]) as never;
    const { client } = makeClient({
      dump: { execute: vi.fn(async () => mcpText("x".repeat(50_000))) },
    });
    mockedCreateClient.mockResolvedValue(client as never);

    const { tools } = await connectExternalMcpTools("org-1");
    const result = (await (tools["linear_dump"] as unknown as ExecutableTool).execute(
      {},
      { toolCallId: "1", messages: [] },
    )) as string;
    expect(result.length).toBeLessThan(50_000);
    expect(result).toContain("truncated");
  });

  it("skips a failing server but keeps the healthy one", async () => {
    mockedDb.orgMcpServer.findMany = vi
      .fn()
      .mockResolvedValue([
        serverRow({ name: "broken", url: "https://down.example.com/mcp" }),
        serverRow({ name: "ok", url: "https://up.example.com/mcp" }),
      ]) as never;
    const { client } = makeClient({ ping: { execute: vi.fn(async () => mcpText("pong")) } });
    mockedCreateClient.mockImplementation((async (opts: { transport: { url?: string } }) => {
      if (opts.transport.url?.includes("down")) throw new Error("connect refused");
      return client;
    }) as never);

    const { tools } = await connectExternalMcpTools("org-1");
    expect(Object.keys(tools)).toEqual(["ok_ping"]);
  });

  it("closeAll closes every client and is idempotent", async () => {
    mockedDb.orgMcpServer.findMany = vi
      .fn()
      .mockResolvedValue([serverRow({ name: "a" }), serverRow({ name: "b" })]) as never;
    const a = makeClient({ t: { execute: vi.fn(async () => mcpText("1")) } });
    const b = makeClient({ t: { execute: vi.fn(async () => mcpText("2")) } });
    mockedCreateClient.mockResolvedValueOnce(a.client as never).mockResolvedValueOnce(b.client as never);

    const { closeAll } = await connectExternalMcpTools("org-1");
    await closeAll();
    await closeAll();
    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).toHaveBeenCalledOnce();
  });

  it("returns empty toolset on DB failure", async () => {
    mockedDb.orgMcpServer.findMany = vi.fn().mockRejectedValue(new Error("db down")) as never;
    const { tools } = await connectExternalMcpTools("org-1");
    expect(tools).toEqual({});
  });
});

describe("decryptMcpHeaders", () => {
  it("round-trips encrypted headers", () => {
    const encrypted = JSON.stringify(
      EncryptionService.getInstance().encryptField("mcpHeaders", JSON.stringify({ Authorization: "Bearer tok" })),
    );
    expect(decryptMcpHeaders(encrypted, "s")).toEqual({ Authorization: "Bearer tok" });
  });

  it("returns {} for null or corrupted values", () => {
    expect(decryptMcpHeaders(null, "s")).toEqual({});
    expect(decryptMcpHeaders("not-json", "s")).toEqual({});
  });
});
