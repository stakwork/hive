// @vitest-environment jsdom
/**
 * Unit tests for the run graph's canvas: what it draws of a layout — a node
 * in every cell that touched it, each cell's own edges and hops — at the
 * whole run and at a step of a replay.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RunGraphCanvas } from "@/components/strut-run-graph/RunGraphCanvas";
import { layoutRunGraph } from "@/lib/strut-run-graph/layout";
import { replayFrame } from "@/lib/strut-run-graph/replay";
import type { RunGraphCall, RunGraphQueryValue } from "@/lib/strut-run-graph/types";
import { runGraphHops, runGraphLinks } from "@/lib/strut-run-graph/walk";

function call(path: string, query: Record<string, RunGraphQueryValue>, refs: string[]): RunGraphCall {
  return {
    path,
    tool: path.split("-").pop() ?? "",
    by: "agent",
    access: "read",
    startedAt: null,
    endedAt: null,
    durationMs: null,
    query,
    nodes: refs.map((ref_id) => ({ ref_id })),
  };
}

const CALLS = [
  call("wf/seed/001-graph_graph_search", { q: "problem list" }, ["concept"]),
  call("wf/ingest#0/ingest/001-graph_create_batch_triplet", {}, ["doc", "finding"]),
  call("wf/ingest#1/ingest/001-graph_create_batch_triplet", {}, ["doc-2"]),
  call("wf/produce/001-graph_graph_neighbors", { ref_id: "doc" }, ["doc", "finding", "concept"]),
];
const NODES = [
  { id: "concept", name: "Problem List", type: "Concept" },
  { id: "doc", name: "enc-0-hpi.md", type: "Document" },
  { id: "finding", name: "Lethargic on arrival", type: "ClinicalFinding" },
  { id: "doc-2", name: "enc-1-hpi.md", type: "Document" },
];
const LINKS = runGraphLinks(
  [
    { source: "doc", target: "finding", edge_type: "CONTAINS" },
    { source: "doc-2", target: "finding", edge_type: "CONTAINS" },
  ],
  runGraphHops(CALLS),
);
const LAYOUT = layoutRunGraph(
  CALLS,
  NODES.map((n) => n.id),
  LINKS,
);

function renderAt(step: number | null, selectedId: string | null = null, onNodeClick = vi.fn()) {
  const frame = replayFrame(CALLS, step ?? CALLS.length);
  render(
    <RunGraphCanvas
      layout={LAYOUT}
      nodes={NODES}
      links={LINKS}
      colorMap={{ Document: "#3b82f6" }}
      activeIds={frame.active}
      selectedId={selectedId}
      step={step}
      onNodeClick={onNodeClick}
    />,
  );
  return onNodeClick;
}

const linkStates = () => screen.queryAllByTestId("run-graph-link").map((el) => el.getAttribute("data-state"));
const drawn = () =>
  screen.getAllByTestId("run-graph-node").map((el) => `${el.getAttribute("data-cell")} ${el.textContent}`);
const active = () =>
  screen
    .getAllByTestId("run-graph-node")
    .filter((el) => el.getAttribute("data-active") === "true")
    .map((el) => `${el.getAttribute("data-cell")} ${el.textContent}`);

describe("RunGraphCanvas", () => {
  it("draws the stages as lanes and a looping stage's iterations as cells", () => {
    renderAt(null);

    // The produce stage only went back to nodes the others had touched.
    expect(screen.getAllByTestId("run-graph-lane").map((el) => el.getAttribute("data-stage"))).toEqual([
      "seed",
      "ingest",
      "produce",
    ]);
    expect(screen.getAllByTestId("run-graph-cell").map((el) => el.textContent)).toEqual(["#0", "#1"]);
  });

  it("draws a node in every cell whose calls touched it, with each cell's own edges and hops", () => {
    renderAt(null);

    expect(drawn()).toEqual([
      "seed# Problem List",
      "ingest#0 enc-0-hpi.md",
      "ingest#0 Lethargic on arrival",
      "ingest#1 enc-1-hpi.md",
      "produce# enc-0-hpi.md",
      "produce# Lethargic on arrival",
      "produce# Problem List",
    ]);
    // In the ingest, doc → finding is an edge; in produce it was walked, and doc → concept is a hop with no
    // edge under it. doc-2 → finding joins two cells and is drawn in neither.
    expect(linkStates()).toEqual(["edge", "walked", "walked"]);
  });

  it("draws only what the run had touched at a step of the replay", () => {
    renderAt(1);

    expect(drawn()).toEqual(["seed# Problem List", "ingest#0 enc-0-hpi.md", "ingest#0 Lethargic on arrival"]);
    expect(linkStates()).toEqual(["edge"]);
    expect(active()).toEqual(["ingest#0 enc-0-hpi.md", "ingest#0 Lethargic on arrival"]);
  });

  it("brings out the hops of the step's own call, in its cell", () => {
    renderAt(3);

    expect(linkStates()).toEqual(["edge", "current", "current"]);
    expect(active()).toEqual(["produce# enc-0-hpi.md", "produce# Lethargic on arrival", "produce# Problem List"]);
  });

  it("rings the picked node wherever it is drawn", () => {
    renderAt(1, "doc");

    expect(active()).toEqual(["ingest#0 enc-0-hpi.md", "ingest#0 Lethargic on arrival"]);
    cleanup();
    renderAt(null, "doc");
    expect(active()).toEqual(["ingest#0 enc-0-hpi.md", "produce# enc-0-hpi.md"]);
  });

  it("tells which node was clicked", () => {
    const onNodeClick = renderAt(null);

    fireEvent.click(screen.getAllByText("enc-0-hpi.md")[1]);

    expect(onNodeClick).toHaveBeenCalledWith("doc");
  });
});
