// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, test, expect } from "vitest";
import { GraphLegend } from "@/components/graph-explorer/GraphLegend";
import { getNodeColor } from "@/components/graph/graphUtils";

describe("GraphLegend", () => {
  test("renders nothing for an empty node list", () => {
    const { container } = render(<GraphLegend nodes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("aggregates per-type counts and sorts descending", () => {
    render(
      <GraphLegend
        nodes={[
          { type: "File" },
          { type: "Function" },
          { type: "File" },
          { type: "Function" },
          { type: "File" },
        ]}
      />
    );

    const fileEntry = screen.getByTestId("graph-legend-entry-File");
    const functionEntry = screen.getByTestId("graph-legend-entry-Function");

    expect(within(fileEntry).getByText("3")).toBeInTheDocument();
    expect(within(functionEntry).getByText("2")).toBeInTheDocument();

    // "File" (count 3) should come before "Function" (count 2) in the DOM.
    const entries = screen.getAllByTestId(/^graph-legend-entry-/);
    expect(entries[0]).toBe(fileEntry);
    expect(entries[1]).toBe(functionEntry);
  });

  test("toggle button collapses and expands the list, updating aria-expanded", async () => {
    const user = userEvent.setup();
    render(<GraphLegend nodes={[{ type: "File" }]} />);

    const toggle = screen.getByTestId("graph-legend-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("graph-legend-entry-File")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("graph-legend-entry-File")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("graph-legend-entry-File")).toBeInTheDocument();
  });

  test("swatch color matches getNodeColor for a listed and an unlisted type", () => {
    const colorMap = { File: "#123456" };
    render(
      <GraphLegend nodes={[{ type: "File" }, { type: "Mystery" }]} colorMap={colorMap} />
    );

    const fileEntry = screen.getByTestId("graph-legend-entry-File");
    const mysteryEntry = screen.getByTestId("graph-legend-entry-Mystery");

    const fileSwatch = fileEntry.querySelector("span[style]") as HTMLElement;
    const mysterySwatch = mysteryEntry.querySelector("span[style]") as HTMLElement;

    expect(fileSwatch.style.backgroundColor).toBe(rgbFromHex(getNodeColor("File", colorMap)));
    expect(mysterySwatch.style.backgroundColor).toBe(
      rgbFromHex(getNodeColor("Mystery", colorMap))
    );
  });
});

/** jsdom normalizes inline hex colors to rgb() when read back from style. */
function rgbFromHex(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
