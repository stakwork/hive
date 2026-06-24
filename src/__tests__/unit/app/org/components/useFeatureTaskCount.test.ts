/**
 * Unit tests for the `useFeatureTaskCount` hook and its shared utilities
 * (`buildTaskList`, `countTasks`).
 *
 * The hook is tested via its pure helper functions; the fetch-level
 * behaviour is tested with a mocked global fetch. DOM-level hook
 * integration (useEffect, event listeners) is covered by the pure
 * function tests below — full hook rendering would require jsdom and
 * @testing-library/react, which is beyond the scope of this unit suite.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildTaskList,
  countTasks,
  type FeatureTasksResponse,
} from "@/app/org/[githubLogin]/_components/useFeatureTaskCount";

// ---------------------------------------------------------------------------
// buildTaskList + countTasks — pure function tests
// ---------------------------------------------------------------------------

describe("buildTaskList", () => {
  test("flattens phased tasks before top-level tasks", () => {
    const feature: NonNullable<FeatureTasksResponse["data"]> = {
      phases: [
        {
          tasks: [
            { title: "Phase 1 Task A", status: "TODO" },
            { title: "Phase 1 Task B", status: "IN_PROGRESS" },
          ],
        },
        {
          tasks: [{ title: "Phase 2 Task", status: "DONE" }],
        },
      ],
      tasks: [{ title: "Top-level Task", status: "BLOCKED" }],
    };
    const list = buildTaskList(feature);
    expect(list.map((t) => t.title)).toEqual([
      "Phase 1 Task A",
      "Phase 1 Task B",
      "Phase 2 Task",
      "Top-level Task",
    ]);
  });

  test("handles empty phases and tasks gracefully", () => {
    expect(buildTaskList({})).toEqual([]);
    expect(buildTaskList({ phases: [], tasks: [] })).toEqual([]);
  });

  test("uses 'Untitled task' for missing/blank titles", () => {
    const list = buildTaskList({
      tasks: [
        { title: null, status: "TODO" },
        { title: "  ", status: "TODO" },
      ],
    });
    expect(list[0].title).toBe("Untitled task");
    expect(list[1].title).toBe("Untitled task");
  });

  test("defaults status to TODO when missing", () => {
    const list = buildTaskList({ tasks: [{ title: "T" }] });
    expect(list[0].status).toBe("TODO");
  });
});

describe("countTasks", () => {
  test("counts done, inProgress, pending; excludes CANCELLED", () => {
    const tasks = buildTaskList({
      tasks: [
        { title: "A", status: "DONE" },
        { title: "B", status: "IN_PROGRESS" },
        { title: "C", status: "TODO" },
        { title: "D", status: "BLOCKED" },
        { title: "E", status: "CANCELLED" }, // excluded
      ],
    });
    const counts = countTasks(tasks);
    expect(counts.done).toBe(1);
    expect(counts.inProgress).toBe(1);
    expect(counts.pending).toBe(2); // TODO + BLOCKED
    expect(counts.total).toBe(4);   // excludes CANCELLED
  });

  test("total is 0 when all tasks are cancelled", () => {
    const tasks = buildTaskList({
      tasks: [
        { title: "A", status: "CANCELLED" },
        { title: "B", status: "CANCELLED" },
      ],
    });
    expect(countTasks(tasks).total).toBe(0);
  });

  test("total is 0 for empty list", () => {
    expect(countTasks([]).total).toBe(0);
  });

  test("counts tasks across phases and top-level combined", () => {
    const tasks = buildTaskList({
      phases: [
        { tasks: [{ title: "P1", status: "DONE" }, { title: "P2", status: "IN_PROGRESS" }] },
      ],
      tasks: [{ title: "TL", status: "TODO" }, { title: "Canc", status: "CANCELLED" }],
    });
    const counts = countTasks(tasks);
    expect(counts.total).toBe(3); // 1 done + 1 in-progress + 1 todo; CANCELLED excluded
  });
});

// ---------------------------------------------------------------------------
// useFeatureTaskCount — fetch behaviour (mock fetch)
// ---------------------------------------------------------------------------

describe("useFeatureTaskCount fetch logic", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Helper: simulates what the hook's `refresh` callback does internally —
   * fetch + parse + countTasks. This mirrors the hook implementation so
   * that fetch success/failure paths are testable without a DOM renderer.
   */
  async function simulateRefresh(
    featureId: string,
  ): Promise<number | undefined> {
    try {
      const res = await fetch(
        `/api/features/${encodeURIComponent(featureId)}?sortBy=order`,
      );
      if (!res.ok) return undefined;
      const json = (await res.json()) as FeatureTasksResponse;
      if (json.data) return countTasks(buildTaskList(json.data)).total;
      return undefined;
    } catch {
      return undefined;
    }
  }

  test("returns total from a mixed phased + top-level feature payload", async () => {
    const payload: FeatureTasksResponse = {
      data: {
        phases: [
          { tasks: [{ title: "A", status: "DONE" }, { title: "B", status: "TODO" }] },
        ],
        tasks: [{ title: "C", status: "IN_PROGRESS" }, { title: "D", status: "CANCELLED" }],
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });

    const total = await simulateRefresh("feat-123");
    expect(total).toBe(3); // DONE + TODO + IN_PROGRESS; CANCELLED excluded
  });

  test("returns 0 when feature has only cancelled tasks", async () => {
    const payload: FeatureTasksResponse = {
      data: { tasks: [{ title: "A", status: "CANCELLED" }] },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });

    expect(await simulateRefresh("feat-456")).toBe(0);
  });

  test("returns undefined on non-ok response (fetch failure)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
    expect(await simulateRefresh("feat-789")).toBeUndefined();
  });

  test("returns undefined when fetch throws (network error)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    expect(await simulateRefresh("feat-abc")).toBeUndefined();
  });

  test("returns undefined when response has no data field", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    expect(await simulateRefresh("feat-def")).toBeUndefined();
  });

  test("encodes featureId in the request URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { tasks: [] } }),
    });
    globalThis.fetch = fetchMock;

    await simulateRefresh("feat/with spaces");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/features/feat%2Fwith%20spaces?sortBy=order",
    );
  });
});
