// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { LingoCard } from "@/app/w/[slug]/learn/lingo/components/LingoCard";
import type { LingoNode } from "@/app/api/mock/lingo/nodes";

const baseNode: LingoNode = {
  ref_id: "test-ref-001",
  node_type: "Lingo",
  name: "Test Term",
  definition: "A test definition.",
  date_added_to_graph: 1750000000,
};

describe("LingoCard", () => {
  it("renders the node name", () => {
    render(<LingoCard node={baseNode} onClick={() => {}} />);
    expect(screen.getByText("Test Term")).toBeInTheDocument();
  });

  it("renders lingo-type-badge when lingo_type is present", () => {
    const node: LingoNode = { ...baseNode, lingo_type: "company_jargon" };
    render(<LingoCard node={node} onClick={() => {}} />);
    const badge = screen.getByTestId("lingo-type-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("company_jargon");
  });

  it("does not render lingo-type-badge when lingo_type is undefined", () => {
    render(<LingoCard node={baseNode} onClick={() => {}} />);
    expect(screen.queryByTestId("lingo-type-badge")).not.toBeInTheDocument();
  });

  it("renders definition when present", () => {
    render(<LingoCard node={baseNode} onClick={() => {}} />);
    expect(screen.getByText("A test definition.")).toBeInTheDocument();
  });
});
