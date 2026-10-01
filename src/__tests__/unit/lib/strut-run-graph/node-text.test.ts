/**
 * Unit tests for `lib/strut-run-graph/node-text.ts`: what of a node is its
 * text, and what is an attribute.
 */

import { describe, it, expect } from "vitest";
import { nodeText, NODE_TEXT_KEYS } from "@/lib/strut-run-graph/node-text";

describe("nodeText", () => {
  it("reads a Concept's docs first, and its other properties as attributes", () => {
    const text = nodeText({
      ref_id: "c-1",
      name: "Problem List",
      namespace: "default",
      docs: "# Problem List",
      description: "One line per problem.",
      source: "gitree",
      weight: 3,
    });
    expect(text.prose).toEqual([
      ["docs", "# Problem List"],
      ["description", "One line per problem."],
    ]);
    expect(text.rest).toEqual([
      ["source", "gitree"],
      ["weight", 3],
    ]);
  });

  it("still reads the deprecated documentation property, after docs", () => {
    expect(NODE_TEXT_KEYS.indexOf("docs")).toBeLessThan(NODE_TEXT_KEYS.indexOf("documentation"));
    expect(nodeText({ documentation: "Older body" }).prose).toEqual([["documentation", "Older body"]]);
  });

  it("joins a list of strings into prose, and leaves blanks and empties out", () => {
    const text = nodeText({ content: ["First.", "Second."], docs: "   ", summary: "", empty: null, label: "" });
    expect(text.prose).toEqual([["content", "First.\n\nSecond."]]);
    expect(text.rest).toEqual([]);
  });

  it("has nothing to say of a node with identity only", () => {
    expect(nodeText({ ref_id: "c-1", name: "Problem List", date_added_to_graph: 1700000000000 })).toEqual({
      prose: [],
      rest: [],
    });
  });
});
