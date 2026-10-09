/**
 * Unit tests for `countStrutRunGraph` (`services/strut-runs/run-graph.ts`):
 * what a settled run did in the graph, as the trace card counts it — from
 * the run's log alone, never the graph.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEvents } = vi.hoisted(() => ({ mockEvents: vi.fn() }));

vi.mock("@/services/strut-runs/lab", () => ({ fetchStrutRunEvents: mockEvents }));
vi.mock("@/services/strut-runs", () => ({ labForRow: vi.fn() }));

import { countStrutRunGraph } from "@/services/strut-runs/run-graph";

const ROW = { id: "row-1", swarmId: "swarm-1", workflow: "job", strutRunId: "1790000000000" };

const end = (path: string, stepType: string, nodes: unknown[]) => ({ type: "step.end", path, stepType, nodes });

beforeEach(() => vi.clearAllMocks());

describe("countStrutRunGraph", () => {
  it("counts the run's graph calls and the distinct nodes they read or wrote — a search's hits are not nodes", async () => {
    mockEvents.mockResolvedValue([
      { type: "run.start", path: "job" },
      end("job/agent/001-graph_graph_search", "tool:graph_graph_search", [{ ref_id: "hit-1" }, { ref_id: "hit-2" }]),
      end("job/agent/002-graph_graph_get", "tool:graph_graph_get", [{ ref_id: "a" }, { ref_id: "b" }]),
      end("job/agent/003-graph_graph_get", "tool:graph_graph_get", [{ ref_id: "a" }]),
      end("job/agent/004-bash", "tool:bash", []),
    ]);
    expect(await countStrutRunGraph(ROW, 8_000)).toEqual({ calls: 3, nodes: 2 });
    expect(mockEvents).toHaveBeenCalledWith(ROW, 8_000);
  });

  it("null when the run touched the graph not at all, or its log could not be read", async () => {
    mockEvents.mockResolvedValue([{ type: "run.start", path: "job" }, end("job/agent/001-bash", "tool:bash", [])]);
    expect(await countStrutRunGraph(ROW)).toBeNull();
    mockEvents.mockResolvedValue(null);
    expect(await countStrutRunGraph(ROW)).toBeNull();
  });
});
