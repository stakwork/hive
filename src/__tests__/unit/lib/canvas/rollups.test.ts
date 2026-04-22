import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Covers both halves of the child-canvas rollup:
 *   - `summarizeChildObjectives`: pure aggregation over a node list.
 *   - `computeChildRollups`: end-to-end shape including the batched
 *     db.canvas.findMany read and the formatted customData payload.
 */

vi.mock("@/lib/db", () => ({
  db: {
    canvas: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { summarizeChildObjectives, computeChildRollups } from "@/lib/canvas";
import type { CanvasNode } from "@/lib/canvas";

const dbMock = db as unknown as {
  canvas: { findMany: ReturnType<typeof vi.fn> };
};

function objective(id: string, status?: string): CanvasNode {
  return {
    id,
    type: "text",
    x: 0,
    y: 0,
    text: id,
    category: "objective",
    ...(status ? { customData: { status } } : {}),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("summarizeChildObjectives", () => {
  it("returns null for an empty canvas (no signal to report)", () => {
    expect(summarizeChildObjectives([])).toBeNull();
  });

  it("returns null when there are no objective-category children", () => {
    // Notes and decisions don't count toward the parent's roll-up;
    // they're UX scaffolding, not work items.
    const nodes: CanvasNode[] = [
      { id: "n1", type: "text", x: 0, y: 0, text: "reminder", category: "note" },
      {
        id: "d1",
        type: "text",
        x: 0,
        y: 0,
        text: "which db?",
        category: "decision",
      },
    ];
    expect(summarizeChildObjectives(nodes)).toBeNull();
  });

  it("counts only status==ok as done", () => {
    const nodes = [
      objective("o1", "ok"),
      objective("o2", "ok"),
      objective("o3", "attn"),
      objective("o4", "risk"),
      objective("o5"), // no status → default, not done
    ];
    expect(summarizeChildObjectives(nodes)).toEqual({
      done: 2,
      total: 5,
      percent: 0.4,
    });
  });

  it("reports 100% when all children are ok", () => {
    const nodes = [objective("o1", "ok"), objective("o2", "ok")];
    expect(summarizeChildObjectives(nodes)).toEqual({
      done: 2,
      total: 2,
      percent: 1,
    });
  });

  it("ignores non-objective children in the denominator", () => {
    const nodes: CanvasNode[] = [
      objective("o1", "ok"),
      { id: "n1", type: "text", x: 0, y: 0, text: "note", category: "note" },
      objective("o2", "attn"),
    ];
    expect(summarizeChildObjectives(nodes)).toEqual({
      done: 1,
      total: 2,
      percent: 0.5,
    });
  });
});

describe("computeChildRollups", () => {
  it("returns an empty map when no parent node has a child-canvas ref", async () => {
    const result = await computeChildRollups("org-1", [
      objective("obj-1"), // no ref yet
      { id: "n1", type: "text", x: 0, y: 0, text: "note", category: "note" },
    ]);
    expect(result).toEqual({});
    expect(dbMock.canvas.findMany).not.toHaveBeenCalled();
  });

  it("batches all drillable children into ONE findMany by `ref IN (...)`", async () => {
    dbMock.canvas.findMany.mockResolvedValue([]);
    await computeChildRollups("org-1", [
      { ...objective("obj-1"), ref: "node:obj-1" },
      { ...objective("obj-2"), ref: "node:obj-2" },
      { ...objective("obj-3"), ref: "node:obj-3" },
    ]);
    expect(dbMock.canvas.findMany).toHaveBeenCalledTimes(1);
    const call = dbMock.canvas.findMany.mock.calls[0][0];
    expect(call.where.orgId).toBe("org-1");
    expect(call.where.ref).toEqual({
      in: ["node:obj-1", "node:obj-2", "node:obj-3"],
    });
  });

  it("formats the rollup as { primary: 'N%', secondary: 'done/total', status }", async () => {
    dbMock.canvas.findMany.mockResolvedValue([
      {
        ref: "node:obj-1",
        data: {
          nodes: [
            objective("c1", "ok"),
            objective("c2", "ok"),
            objective("c3", "attn"),
            objective("c4", "risk"),
          ],
          edges: [],
        },
      },
    ]);

    const result = await computeChildRollups("org-1", [
      { ...objective("obj-1"), ref: "node:obj-1" },
    ]);
    expect(result["obj-1"]).toEqual({
      primary: "50%",
      secondary: "2/4",
      status: "attn",
    });
  });

  it("reports status=ok when all children are done (100%)", async () => {
    dbMock.canvas.findMany.mockResolvedValue([
      {
        ref: "node:obj-1",
        data: {
          nodes: [objective("c1", "ok"), objective("c2", "ok")],
          edges: [],
        },
      },
    ]);

    const result = await computeChildRollups("org-1", [
      { ...objective("obj-1"), ref: "node:obj-1" },
    ]);
    expect(result["obj-1"]).toEqual({
      primary: "100%",
      secondary: "2/2",
      status: "ok",
    });
  });

  it("emits nothing for parents whose child canvas has no objectives", async () => {
    // Empty canvas OR only notes/decisions inside → no signal to stamp.
    // Leaving customData untouched lets the user's own manual status
    // continue to render until they add real mini-objectives.
    dbMock.canvas.findMany.mockResolvedValue([
      {
        ref: "node:obj-1",
        data: {
          nodes: [
            { id: "n1", type: "text", x: 0, y: 0, text: "todo", category: "note" },
          ],
          edges: [],
        },
      },
    ]);

    const result = await computeChildRollups("org-1", [
      { ...objective("obj-1"), ref: "node:obj-1" },
    ]);
    expect(result["obj-1"]).toBeUndefined();
  });

  it("emits nothing for parents whose child canvas doesn't exist yet (first click)", async () => {
    dbMock.canvas.findMany.mockResolvedValue([]); // no row in the batch
    const result = await computeChildRollups("org-1", [
      { ...objective("obj-1"), ref: "node:obj-1" },
    ]);
    expect(result).toEqual({});
  });
});
