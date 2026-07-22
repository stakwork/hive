// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { LingoCard } from "@/app/w/[slug]/lingo/components/LingoCard";
import { LingoCard as LearnLingoCard } from "@/app/w/[slug]/learn/lingo/components/LingoCard";
import type { LingoNode } from "@/app/api/mock/lingo/nodes";

const baseNode: LingoNode = {
  ref_id: "test-ref-001",
  node_type: "Lingo",
  name: "Test Term",
  definition: "A test definition.",
  date_added_to_graph: 1750000000,
};

// Run the same test suite for both component tree locations
const testSuites: Array<{ label: string; Component: typeof LingoCard }> = [
  { label: "lingo/LingoCard", Component: LingoCard },
  { label: "learn/lingo/LingoCard", Component: LearnLingoCard },
];

testSuites.forEach(({ label, Component }) => {
  describe(label, () => {
    it("renders the node name", () => {
      render(<Component node={baseNode} onClick={() => {}} />);
      expect(screen.getByText("Test Term")).toBeInTheDocument();
    });

    it("renders lingo-type-badge when lingo_type is present", () => {
      const node: LingoNode = { ...baseNode, lingo_type: "company_jargon" };
      render(<Component node={node} onClick={() => {}} />);
      const badge = screen.getByTestId("lingo-type-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("company_jargon");
    });

    it("does not render lingo-type-badge when lingo_type is undefined", () => {
      render(<Component node={baseNode} onClick={() => {}} />);
      expect(screen.queryByTestId("lingo-type-badge")).not.toBeInTheDocument();
    });

    it("renders definition when present", () => {
      render(<Component node={baseNode} onClick={() => {}} />);
      expect(screen.getByText("A test definition.")).toBeInTheDocument();
    });

    it("renders icon thumbnail when icon_url is set", () => {
      const node: LingoNode = {
        ...baseNode,
        icon_url: "uploads/ws-1/lingo-icons/123_abc_logo.png",
      };
      render(<Component node={node} onClick={() => {}} />);
      const img = screen.getByTestId("lingo-icon-thumbnail");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute(
        "src",
        "/api/upload/presigned-url?s3Key=uploads%2Fws-1%2Flingo-icons%2F123_abc_logo.png",
      );
      expect(img).toHaveAttribute("loading", "lazy");
    });

    it("does not render icon thumbnail when icon_url is absent", () => {
      render(<Component node={baseNode} onClick={() => {}} />);
      expect(screen.queryByTestId("lingo-icon-thumbnail")).not.toBeInTheDocument();
    });

    it("does not render icon thumbnail when icon_url is null", () => {
      const node: LingoNode = { ...baseNode, icon_url: null };
      render(<Component node={node} onClick={() => {}} />);
      expect(screen.queryByTestId("lingo-icon-thumbnail")).not.toBeInTheDocument();
    });

    it("renders both badge and thumbnail when both icon_url and lingo_type are set", () => {
      const node: LingoNode = {
        ...baseNode,
        lingo_type: "company_jargon",
        icon_url: "uploads/ws-1/lingo-icons/img.png",
      };
      render(<Component node={node} onClick={() => {}} />);
      expect(screen.getByTestId("lingo-icon-thumbnail")).toBeInTheDocument();
      expect(screen.getByTestId("lingo-type-badge")).toBeInTheDocument();
    });
  });
});
