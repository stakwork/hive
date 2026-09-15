import { describe, it, expect } from "vitest";
import type { CanvasNode } from "system-canvas";
import { compactNode } from "@/lib/ai/canvasTools";

describe("compactNode", () => {
  it("includes type and label for a group node with a label", () => {
    const node: CanvasNode = {
      id: "group-1",
      type: "group",
      x: 10,
      y: 20,
      label: "Q3 Initiatives",
    };

    const result = compactNode(node);

    expect(result.type).toBe("group");
    expect(result.label).toBe("Q3 Initiatives");
  });

  it("includes type and omits label for a text node without a label", () => {
    const node: CanvasNode = {
      id: "text-1",
      type: "text",
      x: 0,
      y: 0,
      category: "note",
      text: "A note",
    };

    const result = compactNode(node);

    expect(result.type).toBe("text");
    expect(result).not.toHaveProperty("label");
  });
});
