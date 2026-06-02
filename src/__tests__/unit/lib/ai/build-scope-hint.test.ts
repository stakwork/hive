import { describe, it, expect } from "vitest";
import { buildScopeHint } from "@/lib/ai/runCanvasAgent";

const NO_WORKSPACES: Array<{ id: string; slug: string; name: string }> = [];

describe("buildScopeHint — selectedNodeIds validation", () => {
  it("returns undefined when scope is undefined and no linked workspaces", () => {
    expect(buildScopeHint(undefined, NO_WORKSPACES)).toBeUndefined();
  });

  it("passes through a valid string[] as-is", () => {
    const hint = buildScopeHint(
      { selectedNodeIds: ["initiative:aaa", "ws:bbb"] },
      NO_WORKSPACES,
    );
    expect(hint?.selectedNodeIds).toEqual(["initiative:aaa", "ws:bbb"]);
  });

  it("returns undefined for selectedNodeIds when the array contains non-string entries", () => {
    // The guard uses `.every(s => typeof s === "string")` — a mixed array is rejected.
    const hint = buildScopeHint(
      { selectedNodeIds: ["valid", 42 as unknown as string, null as unknown as string] },
      NO_WORKSPACES,
    );
    expect(hint?.selectedNodeIds).toBeUndefined();
  });

  it("returns undefined for selectedNodeIds when it is not an array", () => {
    const hint = buildScopeHint(
      { selectedNodeIds: "not-an-array" as unknown as string[] },
      NO_WORKSPACES,
    );
    expect(hint?.selectedNodeIds).toBeUndefined();
  });

  it("passes through an empty string[] (valid, though produces no hint text)", () => {
    const hint = buildScopeHint({ selectedNodeIds: [] }, NO_WORKSPACES);
    // An empty valid array passes validation and is returned as-is.
    expect(hint?.selectedNodeIds).toEqual([]);
  });

  it("does not affect selectedNodeId when selectedNodeIds is also provided", () => {
    const hint = buildScopeHint(
      {
        selectedNodeId: "ws:solo",
        selectedNodeIds: ["ws:solo", "initiative:other"],
      },
      NO_WORKSPACES,
    );
    expect(hint?.selectedNodeId).toBe("ws:solo");
    expect(hint?.selectedNodeIds).toEqual(["ws:solo", "initiative:other"]);
  });

  it("passes through other scope fields unchanged", () => {
    const hint = buildScopeHint(
      {
        currentCanvasRef: "initiative:xyz",
        currentCanvasBreadcrumb: "Acme › Auth",
        selectedNodeIds: ["note:123"],
      },
      NO_WORKSPACES,
    );
    expect(hint?.currentCanvasRef).toBe("initiative:xyz");
    expect(hint?.currentCanvasBreadcrumb).toBe("Acme › Auth");
    expect(hint?.selectedNodeIds).toEqual(["note:123"]);
  });

  it("includes linkedWorkspaces when provided", () => {
    const linked = [{ id: "ws-1", slug: "my-ws", name: "My WS" }];
    const hint = buildScopeHint({ selectedNodeIds: ["note:abc"] }, linked);
    expect(hint?.linkedWorkspaces).toEqual(linked);
  });
});
