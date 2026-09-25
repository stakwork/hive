/**
 * Render tests for `SystemMapReport`: the KPI tiles show the summary
 * counts, the type tree renders its families, a tile click filters both
 * tabs, the search narrows by evidence, and "Clear filters" restores.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SystemMapReport } from "@/components/system-map/SystemMapReport";
import { parseSystemMapReport } from "@/components/system-map/SystemMapReport/model";
import { REPORT_FIXTURE } from "./fixture";

function renderReport() {
  const report = parseSystemMapReport(REPORT_FIXTURE)!;
  return render(<SystemMapReport report={report} />);
}

describe("SystemMapReport", () => {
  it("shows one tile per verdict with the summary counts", () => {
    renderReport();
    expect(within(screen.getByTestId("system-map-tile-match")).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByTestId("system-map-tile-missing")).getByText("7")).toBeInTheDocument();
    expect(within(screen.getByTestId("system-map-tile-partial")).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByTestId("system-map-tile-unknown")).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByTestId("system-map-tile-conflict")).getByText("0")).toBeInTheDocument();
  });

  it("renders the type families expanded one level and the full count", () => {
    renderReport();
    expect(screen.getByText("SysComponent")).toBeInTheDocument();
    expect(screen.getByText("SysApplicationComponent")).toBeInTheDocument();
    // Depth 2 is folded by default.
    expect(screen.queryByText("SysWebApplication")).not.toBeInTheDocument();
    expect(screen.getByTestId("system-map-report-count")).toHaveTextContent("8 of 8 types · 6 of 6 edges");
  });

  it("filters by verdict when a tile is clicked, and clears", () => {
    renderReport();
    fireEvent.click(screen.getByTestId("system-map-tile-match"));
    expect(screen.getByTestId("system-map-tile-match")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("system-map-report-count")).toHaveTextContent("2 of 8 types · 1 of 6 edges");
    // Orphan UNKNOWN family is gone; MATCH ancestors stay.
    expect(screen.queryByText("SysFirewallComponent")).not.toBeInTheDocument();
    expect(screen.getByText("SysComponent")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear filters"));
    expect(screen.getByTestId("system-map-report-count")).toHaveTextContent("8 of 8 types · 6 of 6 edges");
  });

  it("searches evidence text", () => {
    renderReport();
    fireEvent.change(screen.getByTestId("system-map-report-search"), { target: { value: "redis" } });
    expect(screen.getByTestId("system-map-report-count")).toHaveTextContent("1 of 8 types · 0 of 6 edges");
    expect(screen.getByText("SysTechnology")).toBeInTheDocument();
    expect(screen.getByText("SysCacheTechnology")).toBeInTheDocument();
  });

  it("lists edge groups on the Edges tab", async () => {
    renderReport();
    await userEvent.click(screen.getByRole("tab", { name: "Edges" }));
    const groups = screen.getAllByTestId("system-map-edge-group");
    expect(groups.map((g) => g.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("CHILD_OF"), expect.stringContaining("CALLS")]),
    );
    expect(groups).toHaveLength(4);
  });
});
