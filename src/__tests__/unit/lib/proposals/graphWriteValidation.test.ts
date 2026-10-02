/**
 * Unit tests for the validation shared by the graph-write propose tools and
 * the approval handlers (src/lib/proposals/graphWriteValidation.ts).
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockKgGetNode } = vi.hoisted(() => ({ mockKgGetNode: vi.fn() }));
vi.mock("@/lib/ai/kg-adapter", () => ({ kgGetNode: mockKgGetNode }));

import {
  DEFAULT_MOVE_EDGE,
  findReservedKeyViolation,
  findReservedKeys,
  wouldCycle,
} from "@/lib/proposals/graphWriteValidation";

const config = { jarvisUrl: "https://swarm.example:8444", apiKey: "k" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reserved keys", () => {
  it("reserves Jarvis's delete flags, since reads skip whatever carries them", () => {
    expect(findReservedKeys({ is_muted: true, is_deleted: true, name: "x" })).toEqual(["is_muted", "is_deleted"]);
    expect(findReservedKeyViolation([["edge_data", { is_muted: true }]])).toBe(
      "edge_data contains reserved key(s): is_muted.",
    );
  });
});

describe("wouldCycle", () => {
  it("is true when the node is already an ancestor of the destination", async () => {
    mockKgGetNode.mockResolvedValue({
      ref_id: "dest",
      node_type: "Concept",
      name: "Dest",
      ancestors: [
        { ref_id: "mid", name: "Mid", node_type: "Concept", depth: 1, parents: ["node"] },
        { ref_id: "node", name: "Node", node_type: "Concept", depth: 2, parents: [] },
      ],
    });

    expect(await wouldCycle(config, { ref_id: "node", to_ref_id: "dest", edge_type: DEFAULT_MOVE_EDGE })).toBe(true);
    expect(mockKgGetNode).toHaveBeenCalledWith(config.jarvisUrl, config.apiKey, "dest", { includeAncestors: true });
  });

  it("is false for a destination elsewhere, an unreadable one, and any other edge type", async () => {
    mockKgGetNode.mockResolvedValue({
      ref_id: "dest",
      node_type: "Concept",
      name: "Dest",
      ancestors: [{ ref_id: "root", name: "Root", node_type: "Concept", depth: 1, parents: [] }],
    });
    expect(await wouldCycle(config, { ref_id: "node", to_ref_id: "dest", edge_type: "PARENT_OF" })).toBe(false);

    mockKgGetNode.mockResolvedValue(null);
    expect(await wouldCycle(config, { ref_id: "node", to_ref_id: "dest", edge_type: "PARENT_OF" })).toBe(false);

    mockKgGetNode.mockClear();
    expect(await wouldCycle(config, { ref_id: "node", to_ref_id: "dest", edge_type: "DEPENDS_ON" })).toBe(false);
    expect(mockKgGetNode).not.toHaveBeenCalled();
  });
});
