/**
 * Render tests for `MaterializedGraph`: tiles show coverage, the
 * nothing-landed notice appears only when nothing was accepted, reason
 * chips filter, tiles filter by status, and the type groups render.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MaterializedGraph } from "@/components/system-map/MaterializedGraph";
import { parseMaterializedGraph } from "@/components/system-map/MaterializedGraph/model";
import { MATERIALIZED_FIXTURE } from "./materialized-fixture";

describe("MaterializedGraph", () => {
  it("shows coverage tiles, reasons and type groups", () => {
    render(<MaterializedGraph graph={parseMaterializedGraph(MATERIALIZED_FIXTURE)!} />);
    expect(within(screen.getByTestId("materialized-tile-nodes-accepted")).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByTestId("materialized-tile-nodes-rejected")).getByText("4")).toBeInTheDocument();
    expect(within(screen.getByTestId("materialized-tile-edges-rejected")).getByText("3")).toBeInTheDocument();
    expect(screen.queryByTestId("materialized-nothing-landed")).not.toBeInTheDocument();
    expect(screen.getByTestId("materialized-reasons")).toHaveTextContent("missing_required_properties");
    expect(screen.getByTestId("materialized-reasons")).toHaveTextContent("missing_endpoint");
    expect(screen.getAllByTestId("materialized-type-group")).toHaveLength(4);
    expect(screen.getByTestId("materialized-count")).toHaveTextContent("5 of 5 nodes · 4 of 4 edges");
  });

  it("warns when nothing landed", () => {
    const nothing = {
      ...MATERIALIZED_FIXTURE,
      observedGraph: { nodes: [], edges: [] },
      coverage: { ...MATERIALIZED_FIXTURE.coverage, nodesAccepted: 0, edgesAccepted: 0 },
    };
    render(<MaterializedGraph graph={parseMaterializedGraph(nothing)!} />);
    expect(screen.getByTestId("materialized-nothing-landed")).toBeInTheDocument();
  });

  it("filters by status tile and by reason chip", () => {
    render(<MaterializedGraph graph={parseMaterializedGraph(MATERIALIZED_FIXTURE)!} />);
    fireEvent.click(screen.getByTestId("materialized-tile-nodes-accepted"));
    expect(screen.getByTestId("materialized-count")).toHaveTextContent("1 of 5 nodes · 1 of 4 edges");
    fireEvent.click(screen.getByText("Clear filters"));
    fireEvent.click(within(screen.getByTestId("materialized-reasons")).getByText("missing_endpoint"));
    expect(screen.getByTestId("materialized-count")).toHaveTextContent("0 of 5 nodes · 3 of 4 edges");
  });
});
