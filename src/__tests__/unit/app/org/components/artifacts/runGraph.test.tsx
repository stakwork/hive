/**
 * The run graph artifact's viewers (`viewers/runGraph.tsx`): the panel
 * draws the run graph of the run the ref names, from that run's own route
 * under its workspace, filling the panel — and starts over when the panel
 * steps to another version, which is another run. The card's fact counts
 * what the run touched.
 */

import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunGraphInline, RunGraphPanel, runGraphFact } from "@/app/org/[githubLogin]/_components/artifacts/viewers/runGraph";
import type { ArtifactContents, ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

const { mounts } = vi.hoisted(() => ({ mounts: [] as Array<Record<string, unknown>> }));

vi.mock("@/components/strut-run-graph", async () => {
  const { useEffect, useState } = await import("react");
  return {
    // Records the props it mounted with, once per mount.
    StrutRunGraph: (props: Record<string, unknown>) => {
      const [mounted] = useState(props);
      useEffect(() => void mounts.push(mounted), [mounted]);
      return <div data-testid="run-graph-stub" />;
    },
  };
});

const content: ArtifactContents["run_graph"] = { workspace: "acme", run: "row-1", calls: 14, nodes: 37 };
const artifact: ArtifactRef = { id: "run-graph-job-1", kind: "run_graph", title: "Dark mode plan", source: { type: "inline", content } };

beforeEach(() => {
  mounts.length = 0;
});

describe("RunGraphPanel", () => {
  test("draws the run's graph from its own route, filling the panel, linked to its workspace", () => {
    render(<RunGraphPanel artifact={artifact} content={content} />);
    expect(screen.getByTestId("run-graph-stub")).toBeTruthy();
    expect(mounts).toEqual([{ endpoint: "/api/workspaces/acme/strut/runs/row-1/graph", workspaceSlug: "acme", fill: true }]);
  });

  test("another version is another run, and the view starts over; the same run does not", () => {
    const view = render(<RunGraphPanel artifact={artifact} content={content} />);
    view.rerender(<RunGraphPanel artifact={artifact} content={{ ...content, run: "row-3" }} />);
    view.rerender(<RunGraphPanel artifact={artifact} content={{ ...content, run: "row-3", calls: 15 }} />);
    expect(mounts.map((props) => props.endpoint)).toEqual([
      "/api/workspaces/acme/strut/runs/row-1/graph",
      "/api/workspaces/acme/strut/runs/row-3/graph",
    ]);
  });
});

describe("the card", () => {
  test("names the workspace whose graph it shows", () => {
    render(<RunGraphInline artifact={artifact} content={content} />);
    expect(screen.getByText("acme")).toBeTruthy();
  });

  test("its fact counts the calls and the nodes, and is nothing without the counts", () => {
    expect(runGraphFact(content)).toBe("14 calls · 37 nodes");
    expect(runGraphFact({ ...content, calls: 1, nodes: 1 })).toBe("1 call · 1 node");
    expect(runGraphFact({ workspace: "acme", run: "row-1", calls: 3 })).toBe("3 calls");
    expect(runGraphFact({ workspace: "acme", run: "row-1" })).toBeNull();
  });
});
