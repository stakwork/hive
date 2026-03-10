import { describe, it, expect } from "vitest";
import { extractMermaidBody } from "@/lib/ai/utils";

describe("extractMermaidBody", () => {
  it("extracts the body from a valid fenced mermaid block", () => {
    const input = "```mermaid\ngraph TD\n  A --> B\n```";
    expect(extractMermaidBody(input)).toBe("graph TD\n  A --> B");
  });

  it("returns null when no mermaid block is present", () => {
    const input = "Here is some text with no mermaid block.";
    expect(extractMermaidBody(input)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractMermaidBody("")).toBeNull();
  });

  it("extracts only the first mermaid block when multiple exist", () => {
    const input =
      "```mermaid\ngraph TD\n  A --> B\n```\n\nSome text\n\n```mermaid\nsequenceDiagram\n  Alice->>Bob: Hi\n```";
    expect(extractMermaidBody(input)).toBe("graph TD\n  A --> B");
  });

  it("handles surrounding prose in the response", () => {
    const input =
      "Sure! Here is the diagram you requested:\n\n```mermaid\nflowchart LR\n  X --> Y\n```\n\nLet me know if you need changes.";
    expect(extractMermaidBody(input)).toBe("flowchart LR\n  X --> Y");
  });

  it("returns null when code block is not mermaid", () => {
    const input = "```typescript\nconst x = 1;\n```";
    expect(extractMermaidBody(input)).toBeNull();
  });

  it("handles mermaid block with extra whitespace after backticks", () => {
    const input = "```mermaid   \ngraph TD\n  A --> B\n```";
    expect(extractMermaidBody(input)).toBe("graph TD\n  A --> B");
  });
});
