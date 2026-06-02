import { describe, it, expect } from "vitest";
import type { CanvasScopeHint } from "@/lib/constants/prompt";
import { getQuickAskPrefixMessages } from "@/lib/constants/prompt";

// Helper: invoke the exported function and extract the system message content.
function getSystemContent(scope?: CanvasScopeHint): string {
  const msgs = getQuickAskPrefixMessages(
    [],       // concepts
    [],       // repoUrls
    null,     // clueMsgs
    undefined, // description
    undefined, // members
    scope !== undefined ? { orgId: "org-test", scope } : { orgId: "org-test" },
  );
  const system = msgs.find((m) => m.role === "system");
  return typeof system?.content === "string" ? system.content : "";
}

// Helper: pull the canvas scope section out of a system prompt string.
function getScopeSection(content: string): string {
  const idx = content.indexOf("## Current canvas scope");
  if (idx === -1) return "";
  return content.slice(idx);
}

describe("getCanvasScopeHint — selectedNodeIds (via getQuickAskPrefixMessages)", () => {
  it("emits nothing for selectedNodeIds: [] (empty array)", () => {
    const section = getScopeSection(
      getSystemContent({ currentCanvasRef: "", selectedNodeIds: [] }),
    );
    // The section exists (ref is provided) but no multi-node hint.
    expect(section).not.toContain("They have selected");
    expect(section).not.toContain("nodes:");
  });

  it("emits nothing for selectedNodeIds: undefined", () => {
    const section = getScopeSection(
      getSystemContent({ currentCanvasRef: "", selectedNodeIds: undefined }),
    );
    expect(section).not.toContain("They have selected");
  });

  it("emits hint for selectedNodeIds with 1 entry", () => {
    const section = getScopeSection(
      getSystemContent({
        currentCanvasRef: "",
        selectedNodeIds: ["initiative:abc123"],
      }),
    );
    expect(section).toContain("They have selected 1 nodes");
    expect(section).toContain("`initiative:abc123`");
    expect(section).toContain(
      'Treat "these nodes", "this group", or "all of these" as referring to this set',
    );
  });

  it("emits hint listing all IDs for selectedNodeIds with N entries", () => {
    const section = getScopeSection(
      getSystemContent({
        currentCanvasRef: "",
        selectedNodeIds: ["initiative:aaa", "ws:bbb", "note:ccc"],
      }),
    );
    expect(section).toContain("They have selected 3 nodes");
    expect(section).toContain("`initiative:aaa`");
    expect(section).toContain("`ws:bbb`");
    expect(section).toContain("`note:ccc`");
  });

  it("does NOT emit multi hint when selectedNodeId (single) is also set", () => {
    // Single-node selection takes priority; `!selected` guard suppresses multi hint.
    const section = getScopeSection(
      getSystemContent({
        currentCanvasRef: "",
        selectedNodeId: "initiative:solo",
        selectedNodeIds: ["initiative:solo", "ws:other"],
      }),
    );
    // Single-node hint appears.
    expect(section).toContain("They have selected node `initiative:solo`");
    // Multi-node hint must NOT appear.
    expect(section).not.toContain("They have selected 2 nodes");
  });

  it("single-node selectedNodeId path is unaffected when selectedNodeIds absent", () => {
    const section = getScopeSection(
      getSystemContent({
        currentCanvasRef: "",
        selectedNodeId: "ws:xyz",
      }),
    );
    expect(section).toContain("They have selected node `ws:xyz`");
    expect(section).toContain(
      'Treat "this node", "this initiative/workspace/milestone", or "it" as referring to that node',
    );
    // No multi-node hint.
    expect(section).not.toContain("They have selected 0 nodes");
    expect(section).not.toContain("They have selected 1 nodes");
  });
});

describe("getCanvasScopeHint — early-return guard", () => {
  it("returns empty scope section when no ref and no selected node(s)", () => {
    // No currentCanvasRef means refProvided=false; no selectedNodeId; no selectedNodeIds.
    const content = getSystemContent({});
    expect(getScopeSection(content)).toBe("");
  });

  it("does NOT bail early when selectedNodeIds has entries (even without a ref)", () => {
    // selectedNodeIds alone bypasses the `!refProvided && !selected && !(selectedNodeIds?.length)` guard.
    const section = getScopeSection(
      getSystemContent({ selectedNodeIds: ["note:hello"] }),
    );
    // The section should be rendered with the multi-node hint.
    expect(section).toContain("They have selected 1 nodes");
    expect(section).toContain("`note:hello`");
  });
});
