import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import PromptsPage from "@/app/w/[slug]/prompts/page";
import * as useWorkspaceModule from "@/hooks/useWorkspace";

// Mock dependencies
vi.mock("@/hooks/useWorkspace");
vi.mock("@/components/prompts", () => ({
  PromptsPanel: vi.fn(({ variant, workspaceSlug }) => (
    <div data-testid="prompts-panel" data-variant={variant} data-workspace-slug={workspaceSlug}>
      Prompts Panel Mock
    </div>
  )),
}));

vi.mock("@/components/ui/page-header", () => ({
  PageHeader: vi.fn(({ title, icon, description }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  )),
}));

describe("PromptsPage", () => {
  const mockSlug = "test-workspace";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      slug: mockSlug,
      workspace: {
        id: "workspace-1",
        name: "Test Workspace",
        slug: mockSlug,
      },
      loading: false,
      error: null,
    } as any);
  });

  test("renders page with correct title", () => {
    render(<PromptsPage />);

    const pageHeader = screen.getByTestId("page-header");
    expect(pageHeader).toBeInTheDocument();
    expect(screen.getByText("Prompts")).toBeInTheDocument();
  });

  test("renders page with correct description", () => {
    render(<PromptsPage />);

    expect(screen.getByText("Manage reusable prompts for workflows")).toBeInTheDocument();
  });

  test("renders PromptsPanel component with fullpage variant", () => {
    render(<PromptsPage />);

    const promptsPanel = screen.getByTestId("prompts-panel");
    expect(promptsPanel).toBeInTheDocument();
    expect(promptsPanel).toHaveAttribute("data-variant", "fullpage");
  });

  test("passes workspaceSlug to PromptsPanel", () => {
    render(<PromptsPage />);

    const promptsPanel = screen.getByTestId("prompts-panel");
    expect(promptsPanel).toHaveAttribute("data-workspace-slug", mockSlug);
  });

  test("uses workspace slug from useWorkspace hook", () => {
    const customSlug = "custom-workspace";
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      slug: customSlug,
      workspace: {
        id: "workspace-2",
        name: "Custom Workspace",
        slug: customSlug,
      },
      loading: false,
      error: null,
    } as any);

    render(<PromptsPage />);

    const promptsPanel = screen.getByTestId("prompts-panel");
    expect(promptsPanel).toHaveAttribute("data-workspace-slug", customSlug);
  });

  test("renders page structure with space-y-6 container", () => {
    const { container } = render(<PromptsPage />);

    const mainContainer = container.querySelector(".space-y-6");
    expect(mainContainer).toBeInTheDocument();
  });

  test("page is accessible at correct route structure", () => {
    // This test verifies the component can be rendered,
    // which confirms it's properly set up for the route
    const { container } = render(<PromptsPage />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
