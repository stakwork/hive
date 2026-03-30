// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GraphMindsetCard } from "@/components/onboarding/GraphMindsetCard";

vi.mock("@/components/onboarding/GraphNetworkIcon", () => ({
  GraphNetworkIcon: () => <div data-testid="graph-network-icon" />,
}));

describe("GraphMindsetCard", () => {
  it("renders left panel with $50 price badge", () => {
    render(<GraphMindsetCard />);
    expect(screen.getByText("$50")).toBeInTheDocument();
    expect(screen.getByText("/ workspace")).toBeInTheDocument();
  });

  it("renders left panel with GraphMindset title and subtitle", () => {
    render(<GraphMindsetCard />);
    expect(screen.getByText("GraphMindset")).toBeInTheDocument();
    expect(screen.getByText("Build a knowledge graph from your codebase")).toBeInTheDocument();
  });

  it("renders right panel with all three feature bullets", () => {
    render(<GraphMindsetCard />);
    expect(screen.getByText("Automatic code graph indexing")).toBeInTheDocument();
    expect(screen.getByText("AI-powered codebase queries")).toBeInTheDocument();
    expect(screen.getByText("Real-time graph updates on push")).toBeInTheDocument();
  });

  it("renders 'Create my graph' button that is always disabled", () => {
    render(<GraphMindsetCard />);
    const button = screen.getByRole("button", { name: /create my graph/i });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("button remains disabled even after typing in workspace name input", () => {
    render(<GraphMindsetCard />);
    const input = screen.getByPlaceholderText("e.g., my-api-graph");
    fireEvent.change(input, { target: { value: "my-workspace" } });
    const button = screen.getByRole("button", { name: /create my graph/i });
    expect(button).toBeDisabled();
  });

  it("workspace name input accepts text", () => {
    render(<GraphMindsetCard />);
    const input = screen.getByPlaceholderText("e.g., my-api-graph") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "my-api-graph" } });
    expect(input.value).toBe("my-api-graph");
  });
});
