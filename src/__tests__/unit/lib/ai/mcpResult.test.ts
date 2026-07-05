import { describe, it, expect } from "vitest";
import {
  MCP_FIELD_CHAR_CAP,
  MCP_TOTAL_CHAR_BUDGET,
  mcpText,
  truncateField,
  capMcpResult,
} from "@/lib/ai/mcpResult";

// Helper: build a minimal McpToolResult with a single text content item
function makeResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

describe("mcpText", () => {
  it("joins multiple content items with newline", () => {
    const result = { content: [{ type: "text" as const, text: "a" }, { type: "text" as const, text: "b" }] };
    expect(mcpText(result)).toBe("a\nb");
  });
});

describe("truncateField", () => {
  it("returns value unchanged when under cap", () => {
    expect(truncateField("hello", 10)).toBe("hello");
  });

  it("truncates and appends marker with correct N", () => {
    const value = "a".repeat(2010);
    const result = truncateField(value, 2000);
    expect(result).toBe("a".repeat(2000) + "…[truncated 10 chars]");
  });

  it("handles exact cap boundary (no truncation)", () => {
    const value = "x".repeat(2000);
    expect(truncateField(value, 2000)).toBe(value);
  });
});

describe("capMcpResult — per-field truncation", () => {
  it("truncates long message field with marker", () => {
    const longMsg = "m".repeat(3000);
    const hit = { message: longMsg, level: "info" };
    const result = makeResult(JSON.stringify([hit]));
    const out = capMcpResult(result, { fieldCap: 2000, totalBudget: MCP_TOTAL_CHAR_BUDGET });
    const parsed = JSON.parse(out);
    expect(parsed[0].message).toContain("…[truncated 1000 chars]");
    expect(parsed[0].message.startsWith("m".repeat(2000))).toBe(true);
  });

  it("truncates long stack field with correct N", () => {
    const longStack = "s".repeat(5000);
    const hit = { stack: longStack };
    const result = makeResult(JSON.stringify([hit]));
    const out = capMcpResult(result, { fieldCap: 2000, totalBudget: MCP_TOTAL_CHAR_BUDGET });
    const parsed = JSON.parse(out);
    expect(parsed[0].stack).toContain("…[truncated 3000 chars]");
  });

  it("handles hits wrapped in { hits: [...] }", () => {
    const longMsg = "z".repeat(3000);
    const payload = { hits: [{ message: longMsg }], total: 1 };
    const result = makeResult(JSON.stringify(payload));
    const out = capMcpResult(result, { fieldCap: 2000, totalBudget: MCP_TOTAL_CHAR_BUDGET });
    const parsed = JSON.parse(out);
    expect(parsed.hits[0].message).toContain("…[truncated 1000 chars]");
    expect(parsed.total).toBe(1);
  });

  it("leaves short fields untouched", () => {
    const hit = { message: "short", level: "warn" };
    const result = makeResult(JSON.stringify([hit]));
    const out = capMcpResult(result, { fieldCap: 2000, totalBudget: MCP_TOTAL_CHAR_BUDGET });
    const parsed = JSON.parse(out);
    expect(parsed[0].message).toBe("short");
    expect(parsed[0].level).toBe("warn");
  });
});

describe("capMcpResult — total budget (trailing hit dropping)", () => {
  it("drops trailing hits when over totalBudget and appends omitted note", () => {
    // Each hit has a field just under fieldCap but many hits push over totalBudget
    const hits = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      message: "x".repeat(1500),
    }));
    const result = makeResult(JSON.stringify(hits));
    const out = capMcpResult(result, { fieldCap: 2000, totalBudget: 8000 });
    expect(out).toContain("…[omitted");
    expect(out).toContain("hits due to size]");
    // Should still be valid JSON prefix (the note is appended after)
    const jsonPart = out.split("\n…[omitted")[0];
    const parsed = JSON.parse(jsonPart);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeLessThan(20);
  });
});

describe("capMcpResult — non-JSON / plain string fallback", () => {
  it("truncates plain string text to totalBudget without throwing", () => {
    const longPlain = "p".repeat(30000);
    const result = makeResult(longPlain);
    const out = capMcpResult(result, { fieldCap: 2000, totalBudget: 24000 });
    expect(out.length).toBeLessThanOrEqual(24000 + 50); // allow for marker chars
    expect(out).toContain("…[truncated");
    expect(() => out).not.toThrow();
  });

  it("does not throw on malformed/partial JSON", () => {
    const malformed = '{"hits": [{"message": "broken"';
    const result = makeResult(malformed);
    expect(() => capMcpResult(result)).not.toThrow();
    const out = capMcpResult(result);
    expect(typeof out).toBe("string");
  });
});

describe("capMcpResult — defaults", () => {
  it("uses MCP_FIELD_CHAR_CAP and MCP_TOTAL_CHAR_BUDGET by default", () => {
    // A hit with a field exactly at the default cap — no truncation
    const hit = { message: "a".repeat(MCP_FIELD_CHAR_CAP) };
    const result = makeResult(JSON.stringify([hit]));
    const out = capMcpResult(result);
    const parsed = JSON.parse(out);
    expect(parsed[0].message).not.toContain("truncated");
    expect(parsed[0].message.length).toBe(MCP_FIELD_CHAR_CAP);
  });

  it("exports sane default constants", () => {
    expect(MCP_FIELD_CHAR_CAP).toBe(2000);
    expect(MCP_TOTAL_CHAR_BUDGET).toBe(24000);
  });
});
