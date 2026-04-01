import { describe, it, expect } from "vitest";
import {
  parseMermaidToParsedDiagram,
  UnsupportedMermaidTypeError,
} from "@/lib/diagrams/mermaid-to-parsed-diagram";

describe("parseMermaidToParsedDiagram", () => {
  describe("basic parsing", () => {
    it("parses a basic graph TD with two nodes and an edge", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A --> B");
      expect(result.components).toHaveLength(2);
      expect(result.components.find((c) => c.id === "A")).toBeDefined();
      expect(result.components.find((c) => c.id === "B")).toBeDefined();
      expect(result.connections).toHaveLength(1);
      expect(result.connections[0]).toMatchObject({ from: "A", to: "B", label: "" });
    });

    it("parses a flowchart LR variant", () => {
      const result = parseMermaidToParsedDiagram("flowchart LR\n  X --> Y");
      expect(result.components).toHaveLength(2);
      expect(result.connections[0]).toMatchObject({ from: "X", to: "Y" });
    });

    it("parses graph TB direction", () => {
      const result = parseMermaidToParsedDiagram("graph TB\n  A --> B");
      expect(result.components).toHaveLength(2);
    });
  });

  describe("node shapes", () => {
    it("maps [] brackets to rect shape", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A[My Label]");
      const node = result.components.find((c) => c.id === "A");
      expect(node?.shape).toBe("rect");
      expect(node?.name).toBe("My Label");
    });

    it("maps () parens to rounded-rect shape", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A(My Label)");
      const node = result.components.find((c) => c.id === "A");
      expect(node?.shape).toBe("rounded-rect");
    });

    it("maps (()) double parens to rounded-rect shape", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A((My Label))");
      const node = result.components.find((c) => c.id === "A");
      expect(node?.shape).toBe("rounded-rect");
    });

    it("maps {} curly braces to diamond shape", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A{Decision}");
      const node = result.components.find((c) => c.id === "A");
      expect(node?.shape).toBe("diamond");
    });

    it("maps > angle bracket to rect shape", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A>Label]");
      const node = result.components.find((c) => c.id === "A");
      expect(node?.shape).toBe("rect");
    });

    it("defaults bare ID to rounded-rect shape", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A --> B");
      const node = result.components.find((c) => c.id === "A");
      expect(node?.shape).toBe("rounded-rect");
    });

    it("strips quotes from quoted labels", () => {
      const result = parseMermaidToParsedDiagram('graph TD\n  A["Some label"]');
      const node = result.components.find((c) => c.id === "A");
      expect(node?.name).toBe("Some label");
    });
  });

  describe("style directives", () => {
    it("maps style NodeId fill:#hex to backgroundColor on component", () => {
      const result = parseMermaidToParsedDiagram(
        "graph TD\n  A[Node]\n  style A fill:#f66"
      );
      const node = result.components.find((c) => c.id === "A");
      expect(node?.backgroundColor).toBe("#f66");
    });

    it("handles style with fill and stroke (extracts fill only)", () => {
      const result = parseMermaidToParsedDiagram(
        "graph TD\n  A[Node]\n  style A fill:#ff0000,stroke:#333"
      );
      const node = result.components.find((c) => c.id === "A");
      expect(node?.backgroundColor).toBe("#ff0000");
    });
  });

  describe("subgraph flattening", () => {
    it("flattens nodes inside subgraph...end as regular components", () => {
      const result = parseMermaidToParsedDiagram(`graph TD
  subgraph Group1
    A[Node A]
    B[Node B]
  end
  A --> B`);
      const ids = result.components.map((c) => c.id);
      expect(ids).toContain("A");
      expect(ids).toContain("B");
      // Only 2 unique components (no subgraph pseudo-node)
      expect(result.components).toHaveLength(2);
    });
  });

  describe("label handling", () => {
    it("strips <br/> from labels and replaces with space", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A[Line1<br/>Line2]");
      const node = result.components.find((c) => c.id === "A");
      expect(node?.name).toBe("Line1 Line2");
    });

    it("strips <br> (no slash) from labels", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A[Line1<br>Line2]");
      const node = result.components.find((c) => c.id === "A");
      expect(node?.name).toBe("Line1 Line2");
    });
  });

  describe("edge labels", () => {
    it("parses edge labels via |label| syntax", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A -->|yes| B");
      expect(result.connections[0]).toMatchObject({ from: "A", to: "B", label: "yes" });
    });

    it("parses edge labels via -- label --> syntax", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A -- click --> B");
      expect(result.connections[0]).toMatchObject({ from: "A", to: "B", label: "click" });
    });

    it("parses edges without labels", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A --> B");
      expect(result.connections[0].label).toBe("");
    });
  });

  describe("implicit nodes", () => {
    it("adds implicit nodes referenced only in edges (never declared)", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A --> B\n  B --> C");
      const ids = result.components.map((c) => c.id).sort();
      expect(ids).toEqual(["A", "B", "C"]);
    });

    it("uses ID as name and rounded-rect shape for implicit nodes", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A --> B");
      const nodeB = result.components.find((c) => c.id === "B");
      expect(nodeB?.name).toBe("B");
      expect(nodeB?.shape).toBe("rounded-rect");
    });
  });

  describe("comments", () => {
    it("strips %% comment lines before processing", () => {
      const result = parseMermaidToParsedDiagram(
        "%% This is a comment\ngraph TD\n  A --> B"
      );
      expect(result.components).toHaveLength(2);
    });
  });

  describe("unsupported diagram types", () => {
    it("throws UnsupportedMermaidTypeError for sequenceDiagram", () => {
      expect(() =>
        parseMermaidToParsedDiagram("sequenceDiagram\n  Alice->>Bob: Hi")
      ).toThrow(UnsupportedMermaidTypeError);
    });

    it("includes the diagram type in the error", () => {
      try {
        parseMermaidToParsedDiagram("classDiagram\n  class Animal");
      } catch (e) {
        expect(e).toBeInstanceOf(UnsupportedMermaidTypeError);
        expect((e as UnsupportedMermaidTypeError).diagramType).toBe("classDiagram");
      }
    });

    it("throws for erDiagram", () => {
      expect(() =>
        parseMermaidToParsedDiagram("erDiagram\n  USER ||--o{ ORDER : places")
      ).toThrow(UnsupportedMermaidTypeError);
    });

    it("throws for gantt", () => {
      expect(() =>
        parseMermaidToParsedDiagram("gantt\n  title A Gantt Chart")
      ).toThrow(UnsupportedMermaidTypeError);
    });
  });

  describe("trailing semicolons", () => {
    it("strips trailing semicolon from the 'to' endpoint token (A --> B;)", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A --> B;");
      const nodeB = result.components.find((c) => c.id === "B");
      expect(nodeB).toBeDefined();
      expect(nodeB?.id).toBe("B");
      expect(nodeB?.name).toBe("B");
      // Ensure the semicolon-suffixed variant is NOT registered
      expect(result.components.find((c) => c.id === "B;")).toBeUndefined();
    });

    it("strips trailing semicolon from the 'from' endpoint token (A; --> B)", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A; --> B");
      const nodeA = result.components.find((c) => c.id === "A");
      expect(nodeA).toBeDefined();
      expect(nodeA?.id).toBe("A");
      expect(nodeA?.name).toBe("A");
      expect(result.components.find((c) => c.id === "A;")).toBeUndefined();
    });

    it("still registers the correct connection after stripping semicolons", () => {
      const result = parseMermaidToParsedDiagram("graph TD\n  A --> B;");
      expect(result.connections).toHaveLength(1);
      expect(result.connections[0]).toMatchObject({ from: "A", to: "B" });
    });
  });

  describe("real-world example", () => {
    it("parses a multi-subgraph diagram with style directives", () => {
      const diagram = `graph TD
  %% Main flow
  subgraph Frontend
    A[User Interface]
    B(API Gateway)
  end
  subgraph Backend
    C{Router}
    D[Service A]
    E[Service B]
  end
  A --> B
  B --> C
  C -->|route A| D
  C -->|route B| E
  style A fill:#4CAF50
  style C fill:#FF9800`;

      const result = parseMermaidToParsedDiagram(diagram);

      // All nodes present
      const ids = result.components.map((c) => c.id).sort();
      expect(ids).toEqual(["A", "B", "C", "D", "E"]);

      // Correct shapes
      expect(result.components.find((c) => c.id === "A")?.shape).toBe("rect");
      expect(result.components.find((c) => c.id === "B")?.shape).toBe("rounded-rect");
      expect(result.components.find((c) => c.id === "C")?.shape).toBe("diamond");

      // Style directives applied
      expect(result.components.find((c) => c.id === "A")?.backgroundColor).toBe("#4CAF50");
      expect(result.components.find((c) => c.id === "C")?.backgroundColor).toBe("#FF9800");

      // Connections
      expect(result.connections).toHaveLength(4);
      expect(result.connections.find((c) => c.from === "C" && c.to === "D")?.label).toBe("route A");
      expect(result.connections.find((c) => c.from === "C" && c.to === "E")?.label).toBe("route B");
    });
  });
});
