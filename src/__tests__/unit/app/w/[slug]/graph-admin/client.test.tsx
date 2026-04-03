// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraphAdminClient } from "@/app/w/[slug]/graph-admin/client";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Mock fetch so useEffect API calls don't fail
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ isPublic: false, endpoints: [] }),
});

describe("GraphAdminClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "Graph swarm is not yet configured" when swarmUrl is null', () => {
    render(<GraphAdminClient swarmUrl={null} workspaceSlug="my-graph" />);
    expect(screen.getByText(/Graph swarm is not yet configured/i)).toBeTruthy();
  });

  it("does not render Quick Links card when swarmUrl is null", () => {
    render(<GraphAdminClient swarmUrl={null} workspaceSlug="my-graph" />);
    expect(screen.queryByText("Quick Links")).toBeNull();
  });

  it('renders Graph Viewer with correct href using workspaceSlug', () => {
    render(
      <GraphAdminClient
        swarmUrl="https://some-other-host.example.com"
        workspaceSlug="my-graph"
      />,
    );
    const link = screen.getByRole("link", { name: /Graph Viewer/i });
    expect(link.getAttribute("href")).toBe("https://my-graph.sphinx.chat:8000");
  });

  it('renders Swarm Dashboard with correct href using workspaceSlug', () => {
    render(
      <GraphAdminClient
        swarmUrl="https://some-other-host.example.com"
        workspaceSlug="my-graph"
      />,
    );
    const link = screen.getByRole("link", { name: /Swarm Dashboard/i });
    expect(link.getAttribute("href")).toBe("https://my-graph.sphinx.chat:8800");
  });

  it("renders both Quick Link buttons immediately without Skeleton in Quick Links card", () => {
    render(
      <GraphAdminClient
        swarmUrl="https://some-other-host.example.com"
        workspaceSlug="my-graph"
      />,
    );
    // Both buttons should be present right away
    expect(screen.getByRole("link", { name: /Graph Viewer/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Swarm Dashboard/i })).toBeTruthy();
  });
});
