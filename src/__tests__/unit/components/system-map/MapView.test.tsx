/**
 * Render tests for the Domain nodes tab's Map view: plates, nodes, wires,
 * chips and labels render from the model; clicking a node or chip selects
 * it; the board toggle switches tiers; the panel floats over the canvas.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MapView } from "@/components/system-map/DomainNodesTab/MapView";
import { buildMapLayout } from "@/components/system-map/DomainNodesTab/map-layout";
import { matchPackageCves } from "@/components/system-map/DomainNodesTab/package-cves";
import { buildDependencies } from "@/components/system-map/DomainNodesTab/dependencies";
import type { SystemMapDomainEdge, SystemMapDomainNode } from "@/types/system-map";

function node(refId: string, type: string, properties: Record<string, unknown> = {}): SystemMapDomainNode {
  return { refId, type, name: (properties.name as string) ?? refId, properties };
}
function edge(source: string, edgeType: string, target: string): SystemMapDomainEdge {
  return { source, target, edgeType };
}

const NODES = [
  node("device", "SysTrustZone", { name: "device" }),
  node("internal", "SysTrustZone", { name: "internal" }),
  node("app", "SysComponent", { name: "app", kind: "frontend" }),
  node("brain", "SysComponent", { name: "brain", kind: "service" }),
  node("cli", "SysInterface", { name: "app cli" }),
  node("user", "Actor", { name: "Authenticated User" }),
  node("db", "SysResource", { name: "app SQLite", kind: "database" }),
  node("key", "SysDataAsset", { name: "API_KEY", classification: "secret" }),
  node("owner", "SysPrincipal", { name: "device owner" }),
  node("flow", "SysDataFlow", { name: "app -> brain", kind: "request" }),
  node("lock", "SysArtifact", { name: "Cargo.lock" }),
  node("top", "SysPackage", { name: "top", version: "1.0.0", ecosystem: "cargo" }),
  node("mid", "SysPackage", { name: "mid", version: "0.2.0", ecosystem: "cargo" }),
];
const EDGES = [
  edge("app", "IN_ZONE", "device"),
  edge("brain", "IN_ZONE", "internal"),
  edge("app", "EXPOSES", "cli"),
  edge("user", "CAN_REACH", "cli"),
  edge("app", "WRITES_TO", "db"),
  edge("brain", "PROCESSES", "key"),
  edge("owner", "AUTHENTICATES_WITH", "key"),
  edge("flow", "FROM", "app"),
  edge("flow", "TO", "brain"),
  edge("app", "DEPENDS_ON", "lock"),
  edge("lock", "CONTAINS", "top"),
  edge("lock", "CONTAINS", "mid"),
  edge("top", "DEPENDS_ON", "mid"),
];

const model = buildMapLayout(NODES, EDGES);
const cves = matchPackageCves(
  [
    {
      name: "mid",
      version: "0.2.0",
      ecosystem: "cargo",
      purl: "",
      refId: "mid",
      sourcePath: "",
      severity: "HIGH",
      fixedIn: "0.3.0",
      advisories: [],
      fetchErrors: [],
    },
  ],
  buildDependencies(NODES, EDGES).packages,
  "2026-10-22T00:00:00Z",
);

describe("MapView", () => {
  it("renders the plates, nodes, wires, board and labels from the model", () => {
    render(<MapView model={model} cves={null} selectedId={null} onSelect={() => {}} />);
    expect(screen.getAllByTestId("map-plate")).toHaveLength(model.regions.length);
    expect(screen.getAllByTestId("map-node")).toHaveLength(model.nodes.size);
    expect(screen.getAllByTestId("map-wire")).toHaveLength(model.wires.length);
    expect(screen.getAllByTestId("map-board")).toHaveLength(1);
    expect(screen.getAllByTestId("map-chip")).toHaveLength(2);
    expect(screen.getByTestId("map-signpost")).toBeInTheDocument();
    expect(within(screen.getByTestId("map-labels")).getByText("cli")).toBeInTheDocument();
    expect(screen.getByTestId("map-toolbar")).toHaveTextContent("1 cross-zone");
    expect(screen.getAllByTestId("map-zone-card").map((c) => c.getAttribute("data-zone"))).toEqual(
      expect.arrayContaining(["packages", "actors", "device", "internal"]),
    );
  });

  it("selects a node or a chip on click and floats the panel", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<MapView model={model} cves={null} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("map-canvas").querySelector('[data-ref-id="brain"]')!);
    expect(onSelect).toHaveBeenLastCalledWith("brain");
    fireEvent.click(screen.getByTestId("map-canvas").querySelector('[data-ref-id="mid"]')!);
    expect(onSelect).toHaveBeenLastCalledWith("mid");
    rerender(<MapView model={model} cves={null} selectedId="brain" onSelect={onSelect} panel={<p>brain details</p>} />);
    expect(screen.getByTestId("map-panel")).toHaveTextContent("brain details");
    expect(screen.getByTestId("map-canvas").querySelector('[data-ref-id="user"]')).toHaveAttribute("opacity", "0.16");
    expect(screen.getByTestId("map-canvas").querySelector('[data-ref-id="key"]')).toHaveAttribute("opacity", "1");
  });

  it("switches between the map and the board, and counts vulnerable packages", () => {
    render(<MapView model={model} cves={cves} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByTestId("map-board-toggle")).toHaveTextContent("2 packages");
    expect(screen.getByTestId("map-board-toggle")).toHaveTextContent("1");
    fireEvent.click(screen.getByTestId("map-board-toggle"));
    expect(screen.getByTestId("map-board-toggle")).toHaveTextContent("Back to map");
    expect(screen.getByTestId("map-canvas")).toHaveTextContent("Bottom row");
    fireEvent.click(screen.getByTestId("map-board-toggle"));
    expect(screen.getByTestId("map-canvas")).toHaveTextContent("Plates are trust zones");
    fireEvent.click(screen.getByTestId("map-signpost"));
    expect(screen.getByTestId("map-board-toggle")).toHaveTextContent("Back to map");
  });

  it("focuses a zone from its card and clears it with Escape", () => {
    const onSelect = vi.fn();
    render(<MapView model={model} cves={null} selectedId={null} onSelect={onSelect} />);
    const card = screen.getAllByTestId("map-zone-card").find((c) => c.getAttribute("data-zone") === "device")!;
    fireEvent.click(card);
    expect(card.className).toContain("ring-2");
    expect(screen.getByTestId("map-canvas").querySelector('[data-ref-id="brain"]')).toHaveAttribute("opacity", "0.16");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(card.className).not.toContain("ring-2");
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
