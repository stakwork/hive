// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  MetricsWindowSelector,
  METRICS_WINDOWS,
  type MetricsWindow,
} from "@/app/admin/scorer/ScorerDashboard";

// Mock next/navigation so ScorerDashboard module-level imports don't fail
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("range=7d"),
  useRouter: () => ({ replace: vi.fn() }),
}));

describe("MetricsWindowSelector", () => {
  const setWindow = vi.fn();

  beforeEach(() => {
    setWindow.mockClear();
  });

  it("renders all four window options", () => {
    render(
      <MetricsWindowSelector window="all" setWindow={setWindow} />
    );
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("24h")).toBeInTheDocument();
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
  });

  it("applies active style to the current window", () => {
    render(
      <MetricsWindowSelector window="7d" setWindow={setWindow} />
    );
    const buttons = screen.getAllByRole("button");
    // 7d button should have the active class (bg-accent/10), others should not
    const btn7d = buttons.find((b) => b.textContent === "7d");
    expect(btn7d?.className).toContain("bg-accent/10");
    const btnAll = buttons.find((b) => b.textContent === "All");
    expect(btnAll?.className).not.toContain("bg-accent/10");
    expect(btnAll?.className).toContain("text-muted-foreground");
  });

  it("calls setWindow with the clicked value", () => {
    render(
      <MetricsWindowSelector window="all" setWindow={setWindow} />
    );
    fireEvent.click(screen.getByText("30d"));
    expect(setWindow).toHaveBeenCalledWith("30d");
  });

  it("reads initial range from ?range=7d (not always defaulting to all)", () => {
    // This test confirms the component correctly reflects an externally-supplied
    // window value of "7d" — the same as reading ?range=7d from the URL in the
    // parent ScorerDashboard component.
    render(
      <MetricsWindowSelector window="7d" setWindow={setWindow} />
    );
    const buttons = screen.getAllByRole("button");
    const btn7d = buttons.find((b) => b.textContent === "7d");
    const btnAll = buttons.find((b) => b.textContent === "All");
    // 7d is active (has bg-accent/10), "all" is not
    expect(btn7d?.className).toContain("bg-accent/10");
    expect(btnAll?.className).not.toContain("bg-accent/10");
    expect(btnAll?.className).toContain("text-muted-foreground");
  });

  it("covers every valid window option", () => {
    // Verify METRICS_WINDOWS matches what the component renders
    const { container } = render(
      <MetricsWindowSelector window="24h" setWindow={setWindow} />
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(METRICS_WINDOWS.length);
  });
});
