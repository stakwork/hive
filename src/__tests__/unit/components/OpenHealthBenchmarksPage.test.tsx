/**
 * @vitest-environment jsdom
 *
 * Unit tests for the OpenHealth Benchmarks page:
 * - Slug "hive" with a resolved workspace renders the page.
 * - Any other slug (including "openhealth") calls notFound() once the
 *   workspace has resolved.
 * - While useWorkspace().loading is true, neither the tasks panel nor the
 *   run history render — regardless of slug.
 * - The tab comes from `?tab=`.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

globalThis.React = React;

const mockUseWorkspace = vi.hoisted(() => vi.fn());
const mockNotFound = vi.hoisted(() => vi.fn());
const mockSearchParams = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: mockUseWorkspace,
}));

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/w/hive/openhealth/benchmarks",
  useSearchParams: mockSearchParams,
}));

vi.mock("@/components/openhealth/OpenHealthTasksPanel", () => ({
  OpenHealthTasksPanel: () => <div data-testid="tasks-panel">Tasks</div>,
}));

vi.mock("@/components/openhealth/OpenHealthRunsHistory", () => ({
  OpenHealthRunsHistory: () => <div data-testid="runs-history">Runs</div>,
}));

const OpenHealthBenchmarksPage = (
  await import("@/app/w/[slug]/openhealth/benchmarks/page")
).default;

describe("OpenHealthBenchmarksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.mockReturnValue(new URLSearchParams());
  });

  it("renders the page for slug hive once resolved", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { id: "ws-hive", slug: "hive" },
      loading: false,
    });

    render(<OpenHealthBenchmarksPage />);

    expect(mockNotFound).not.toHaveBeenCalled();
    expect(screen.getByText("OpenHealth Benchmarks")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-panel")).toBeInTheDocument();
  });

  it("opens the runs tab from the URL", () => {
    mockSearchParams.mockReturnValue(new URLSearchParams("tab=runs&run=run-1"));
    mockUseWorkspace.mockReturnValue({
      workspace: { id: "ws-hive", slug: "hive" },
      loading: false,
    });

    render(<OpenHealthBenchmarksPage />);

    expect(screen.getByTestId("runs-history")).toBeInTheDocument();
    expect(screen.queryByTestId("tasks-panel")).not.toBeInTheDocument();
  });

  it("calls notFound() for the openhealth slug once the workspace has resolved", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { id: "ws-openhealth", slug: "openhealth" },
      loading: false,
    });

    render(<OpenHealthBenchmarksPage />);

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("calls notFound() for any other non-hive slug once resolved", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { id: "ws-other", slug: "some-other-workspace" },
      loading: false,
    });

    render(<OpenHealthBenchmarksPage />);

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("calls notFound() when the workspace failed to resolve (null) and loading is false", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: null,
      loading: false,
    });

    render(<OpenHealthBenchmarksPage />);

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("renders neither the tasks panel nor the runs history while loading is true, for any slug", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: null,
      loading: true,
    });

    const { container } = render(<OpenHealthBenchmarksPage />);

    expect(mockNotFound).not.toHaveBeenCalled();
    expect(screen.queryByTestId("tasks-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("runs-history")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
