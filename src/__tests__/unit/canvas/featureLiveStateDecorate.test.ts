import { describe, it, expect } from "vitest";
import type { CanvasData } from "system-canvas-react";
import {
  deriveFeatureSnapshots,
  decorateNodesWithLiveState,
  type FeatureLiveOverlay,
} from "@/app/org/[githubLogin]/connections/useFeatureLiveState";

function featureNode(
  id: string,
  customData: Record<string, unknown>,
): CanvasData["nodes"] extends (infer N)[] | undefined ? N : never {
  return {
    id,
    type: "text",
    category: "feature",
    x: 0,
    y: 0,
    customData,
  } as never;
}

describe("deriveFeatureSnapshots", () => {
  it("extracts a snapshot per feature node, stripping the id prefix", () => {
    const canvas: CanvasData = {
      nodes: [
        featureNode("feature:abc", {
          plannerRunning: true,
          agentTasks: [{ id: "t1", workflowStatus: "IN_PROGRESS" }],
          agentsRunningCount: 1,
        }),
        { id: "note:1", type: "text", category: "note", x: 0, y: 0 } as never,
      ],
      edges: [],
    };

    const seeds = deriveFeatureSnapshots([canvas]);

    expect(seeds).toHaveLength(1);
    expect(seeds[0].featureId).toBe("abc");
    expect(seeds[0].snapshot.plannerRunning).toBe(true);
    expect(seeds[0].snapshot.agentsRunningCount).toBe(1);
    expect(seeds[0].snapshot.agentTasks).toEqual([
      { id: "t1", workflowStatus: "IN_PROGRESS" },
    ]);
  });

  it("dedupes a feature that appears on more than one canvas", () => {
    const a: CanvasData = {
      nodes: [featureNode("feature:abc", { agentsRunningCount: 1 })],
      edges: [],
    };
    const b: CanvasData = {
      nodes: [featureNode("feature:abc", { agentsRunningCount: 2 })],
      edges: [],
    };

    const seeds = deriveFeatureSnapshots([a, b]);

    expect(seeds).toHaveLength(1);
    expect(seeds[0].snapshot.agentsRunningCount).toBe(1);
  });

  it("tolerates null canvases and missing customData", () => {
    const canvas: CanvasData = {
      nodes: [featureNode("feature:abc", {})],
      edges: [],
    };

    const seeds = deriveFeatureSnapshots([null, undefined, canvas]);

    expect(seeds).toHaveLength(1);
    expect(seeds[0].snapshot.plannerRunning).toBe(false);
    expect(seeds[0].snapshot.agentsRunningCount).toBe(0);
    expect(seeds[0].snapshot.agentTasks).toEqual([]);
  });
});

describe("decorateNodesWithLiveState", () => {
  const live = new Map<string, FeatureLiveOverlay>([
    ["abc", { plannerRunning: true, agentsRunningCount: 3 }],
  ]);

  it("overlays live values onto the matching feature node", () => {
    const canvas: CanvasData = {
      nodes: [
        featureNode("feature:abc", {
          plannerRunning: false,
          agentsRunningCount: 0,
          status: "IN_PROGRESS",
        }),
      ],
      edges: [],
    };

    const out = decorateNodesWithLiveState(canvas, live);
    const cd = out.nodes![0].customData as Record<string, unknown>;

    expect(cd.plannerRunning).toBe(true);
    expect(cd.agentsRunningCount).toBe(3);
    // preserves other customData
    expect(cd.status).toBe("IN_PROGRESS");
  });

  it("returns the same reference when nothing changed", () => {
    const canvas: CanvasData = {
      nodes: [
        featureNode("feature:abc", { plannerRunning: true, agentsRunningCount: 3 }),
      ],
      edges: [],
    };

    const out = decorateNodesWithLiveState(canvas, live);

    expect(out).toBe(canvas);
  });

  it("leaves features with no live entry untouched", () => {
    const canvas: CanvasData = {
      nodes: [featureNode("feature:other", { plannerRunning: false })],
      edges: [],
    };

    const out = decorateNodesWithLiveState(canvas, live);

    expect(out).toBe(canvas);
  });
});
