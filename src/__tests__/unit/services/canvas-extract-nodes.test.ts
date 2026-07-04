import { describe, it, expect } from "vitest";
import { extractCanvasNoteNodes } from "@/services/canvas-mirror/extract-canvas-nodes";

describe("extractCanvasNoteNodes", () => {
  const REF = "org:clm123";

  it("returns empty array for null/undefined input", () => {
    expect(extractCanvasNoteNodes(null, REF)).toEqual([]);
    expect(extractCanvasNoteNodes(undefined, REF)).toEqual([]);
  });

  it("returns empty array for non-object input (string, number)", () => {
    expect(extractCanvasNoteNodes("bad", REF)).toEqual([]);
    expect(extractCanvasNoteNodes(42, REF)).toEqual([]);
  });

  it("returns empty array for empty object with no nodes field", () => {
    expect(extractCanvasNoteNodes({}, REF)).toEqual([]);
  });

  it("returns empty array when nodes field is not an array", () => {
    expect(extractCanvasNoteNodes({ nodes: "bad" }, REF)).toEqual([]);
    expect(extractCanvasNoteNodes({ nodes: null }, REF)).toEqual([]);
  });

  it("returns empty array for empty nodes array", () => {
    expect(extractCanvasNoteNodes({ nodes: [] }, REF)).toEqual([]);
  });

  it("extracts note nodes from { nodes: [...] } shape", () => {
    const data = {
      nodes: [
        { id: "n1", type: "text", category: "note", text: "Remember this", x: 10, y: 20 },
        { id: "n2", type: "text", category: "feature", text: "A feature" },
      ],
    };
    const result = extractCanvasNoteNodes(data, REF);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("n1");
    expect(result[0].category).toBe("note");
    expect(result[0].text).toBe("Remember this");
    expect(result[0].x).toBe(10);
    expect(result[0].y).toBe(20);
    expect(result[0].canvasRef).toBe(REF);
  });

  it("extracts decision nodes", () => {
    const data = {
      nodes: [
        { id: "d1", type: "text", category: "decision", text: "We decided X" },
      ],
    };
    const result = extractCanvasNoteNodes(data, REF);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("decision");
  });

  it("handles flat array shape (data is an array of nodes)", () => {
    const data = [
      { id: "n1", category: "note", text: "Flat note" },
      { id: "n2", category: "milestone", text: "Skip this" },
    ];
    const result = extractCanvasNoteNodes(data, REF);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("n1");
  });

  it("filters mixed categories — only note and decision pass through", () => {
    const data = {
      nodes: [
        { id: "a", category: "note", text: "note" },
        { id: "b", category: "decision", text: "decision" },
        { id: "c", category: "feature", text: "feature" },
        { id: "d", category: "milestone", text: "milestone" },
        { id: "e", category: "service", text: "service" },
        { id: "f", category: "initiative", text: "initiative" },
      ],
    };
    const result = extractCanvasNoteNodes(data, REF);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("skips nodes with missing or non-string id", () => {
    const data = {
      nodes: [
        { id: null, category: "note", text: "No id" },
        { category: "note", text: "Missing id" },
        { id: 123, category: "note", text: "Numeric id" },
        { id: "ok", category: "note", text: "Valid" },
      ],
    };
    const result = extractCanvasNoteNodes(data, REF);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ok");
  });

  it("skips non-object entries in the nodes array", () => {
    const data = { nodes: [null, "string", 42, { id: "n1", category: "note", text: "ok" }] };
    const result = extractCanvasNoteNodes(data, REF);
    expect(result).toHaveLength(1);
  });

  it("defaults missing text to empty string", () => {
    const data = { nodes: [{ id: "n1", category: "note" }] };
    const result = extractCanvasNoteNodes(data, REF);
    expect(result[0].text).toBe("");
  });

  it("defaults missing x/y to null", () => {
    const data = { nodes: [{ id: "n1", category: "note", text: "hi" }] };
    const result = extractCanvasNoteNodes(data, REF);
    expect(result[0].x).toBeNull();
    expect(result[0].y).toBeNull();
  });
});
