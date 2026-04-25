// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { MilestoneResponse } from "@/types/initiatives";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@dnd-kit/core", () => ({
  closestCenter: "closestCenter",
  PointerSensor: class PointerSensor {},
  KeyboardSensor: class KeyboardSensor {},
  useSensor: vi.fn((Sensor) => ({ sensor: Sensor })),
  useSensors: vi.fn((...sensors) => sensors),
}));

vi.mock("@dnd-kit/sortable", () => ({
  arrayMove: vi.fn((arr: unknown[], from: number, to: number) => {
    const result = [...arr];
    const [removed] = result.splice(from, 1);
    result.splice(to, 0, removed);
    return result;
  }),
  sortableKeyboardCoordinates: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMilestone(overrides: Partial<MilestoneResponse> = {}): MilestoneResponse {
  return {
    id: "m-1",
    initiativeId: "ini-1",
    name: "Milestone 1",
    description: null,
    status: "NOT_STARTED",
    sequence: 1,
    dueDate: null,
    completedAt: null,
    assignee: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const milestones: MilestoneResponse[] = [
  makeMilestone({ id: "m-1", sequence: 1, name: "Alpha" }),
  makeMilestone({ id: "m-2", sequence: 2, name: "Beta" }),
  makeMilestone({ id: "m-3", sequence: 3, name: "Gamma" }),
];

describe("useReorderMilestones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns milestoneIds matching the input milestones", async () => {
    const { useReorderMilestones } = await import("@/hooks/useReorderMilestones");

    const onOptimisticUpdate = vi.fn();
    const { result } = renderHook(() =>
      useReorderMilestones({
        milestones,
        initiativeId: "ini-1",
        githubLogin: "test-org",
        onOptimisticUpdate,
      })
    );

    expect(result.current.milestoneIds).toEqual(["m-1", "m-2", "m-3"]);
    expect(result.current.collisionDetection).toBe("closestCenter");
  });

  it("handleDragEnd calls onOptimisticUpdate with reordered sequences (index + 1)", async () => {
    const { useReorderMilestones } = await import("@/hooks/useReorderMilestones");
    mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue([]) });

    const onOptimisticUpdate = vi.fn();
    const { result } = renderHook(() =>
      useReorderMilestones({
        milestones,
        initiativeId: "ini-1",
        githubLogin: "test-org",
        onOptimisticUpdate,
      })
    );

    // Simulate dragging m-1 to position of m-3 (index 0 → 2)
    await act(async () => {
      await result.current.handleDragEnd({
        active: { id: "m-1" },
        over: { id: "m-3" },
      } as Parameters<typeof result.current.handleDragEnd>[0]);
    });

    expect(onOptimisticUpdate).toHaveBeenCalledOnce();
    const reordered = onOptimisticUpdate.mock.calls[0][0] as MilestoneResponse[];
    // After moving m-1 to end: [m-2, m-3, m-1], sequences should be [1, 2, 3]
    expect(reordered.map((m) => m.sequence)).toEqual([1, 2, 3]);
    // m-2 should now be sequence 1, m-3 sequence 2, m-1 sequence 3
    expect(reordered[0].id).toBe("m-2");
    expect(reordered[1].id).toBe("m-3");
    expect(reordered[2].id).toBe("m-1");
  });

  it("handleDragEnd calls POST /reorder with correct payload", async () => {
    const { useReorderMilestones } = await import("@/hooks/useReorderMilestones");
    mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue([]) });

    const onOptimisticUpdate = vi.fn();
    const { result } = renderHook(() =>
      useReorderMilestones({
        milestones,
        initiativeId: "ini-1",
        githubLogin: "test-org",
        onOptimisticUpdate,
      })
    );

    await act(async () => {
      await result.current.handleDragEnd({
        active: { id: "m-1" },
        over: { id: "m-3" },
      } as Parameters<typeof result.current.handleDragEnd>[0]);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/orgs/test-org/initiatives/ini-1/milestones/reorder",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining('"milestones"'),
      })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.milestones).toHaveLength(3);
    // Sequences are reassigned as index + 1
    expect(body.milestones[0].sequence).toBe(1);
    expect(body.milestones[1].sequence).toBe(2);
    expect(body.milestones[2].sequence).toBe(3);
  });

  it("handleDragEnd reverts state when fetch fails", async () => {
    const { useReorderMilestones } = await import("@/hooks/useReorderMilestones");
    mockFetch.mockResolvedValue({ ok: false });

    const onOptimisticUpdate = vi.fn();
    const { result } = renderHook(() =>
      useReorderMilestones({
        milestones,
        initiativeId: "ini-1",
        githubLogin: "test-org",
        onOptimisticUpdate,
      })
    );

    await act(async () => {
      await result.current.handleDragEnd({
        active: { id: "m-1" },
        over: { id: "m-3" },
      } as Parameters<typeof result.current.handleDragEnd>[0]);
    });

    // Called twice: once optimistic, once revert
    expect(onOptimisticUpdate).toHaveBeenCalledTimes(2);
    // Second call restores original milestones
    const revert = onOptimisticUpdate.mock.calls[1][0] as MilestoneResponse[];
    expect(revert.map((m) => m.id)).toEqual(["m-1", "m-2", "m-3"]);
    expect(revert.map((m) => m.sequence)).toEqual([1, 2, 3]);
  });

  it("handleDragEnd does nothing when active equals over", async () => {
    const { useReorderMilestones } = await import("@/hooks/useReorderMilestones");
    const onOptimisticUpdate = vi.fn();
    const { result } = renderHook(() =>
      useReorderMilestones({
        milestones,
        initiativeId: "ini-1",
        githubLogin: "test-org",
        onOptimisticUpdate,
      })
    );

    await act(async () => {
      await result.current.handleDragEnd({
        active: { id: "m-1" },
        over: { id: "m-1" },
      } as Parameters<typeof result.current.handleDragEnd>[0]);
    });

    expect(onOptimisticUpdate).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handleDragEnd does nothing when over is null", async () => {
    const { useReorderMilestones } = await import("@/hooks/useReorderMilestones");
    const onOptimisticUpdate = vi.fn();
    const { result } = renderHook(() =>
      useReorderMilestones({
        milestones,
        initiativeId: "ini-1",
        githubLogin: "test-org",
        onOptimisticUpdate,
      })
    );

    await act(async () => {
      await result.current.handleDragEnd({
        active: { id: "m-1" },
        over: null,
      } as Parameters<typeof result.current.handleDragEnd>[0]);
    });

    expect(onOptimisticUpdate).not.toHaveBeenCalled();
  });
});
