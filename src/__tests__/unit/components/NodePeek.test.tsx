/**
 * Unit tests for NodePeekBody — the shared "peek at a graph node" renderer.
 *
 * Pins the live-Concept content-key contract: bodies under BOTH `docs` and
 * the schema-canonical `documentation` render as prose. Without
 * `documentation` in CONTENT_KEYS the live half of the fix-snapshot
 * comparison renders blank — which is the entire point of the click-through.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NodePeekBody } from "@/components/run-report/NodePeek";

describe("NodePeekBody — content keys", () => {
  it("renders a Concept whose body is under `docs` as prose", () => {
    render(
      <NodePeekBody
        payload={{
          ref_id: "c-1",
          node_type: "Concept",
          properties: { docs: "Doctrine text under docs." },
        }}
      />,
    );
    expect(screen.getByText("Doctrine text under docs.")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
  });

  it("renders a Concept whose body is under `documentation` as prose", () => {
    render(
      <NodePeekBody
        payload={{
          ref_id: "c-2",
          node_type: "Concept",
          properties: { documentation: "Doctrine text under documentation." },
        }}
      />,
    );
    expect(screen.getByText("Doctrine text under documentation.")).toBeInTheDocument();
    expect(screen.getByText("documentation")).toBeInTheDocument();
  });

  it("still renders the identity-only empty state when no content keys are present", () => {
    render(
      <NodePeekBody payload={{ ref_id: "c-3", node_type: "Concept", properties: {} }} />,
    );
    expect(screen.getByText(/identity only/i)).toBeInTheDocument();
  });
});
