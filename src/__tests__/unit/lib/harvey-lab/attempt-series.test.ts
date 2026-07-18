/**
 * Unit tests for buildAttemptSeries and buildAttemptSeriesFromMapped.
 */
import { describe, it, expect } from "vitest";
import {
  buildAttemptSeries,
  buildAttemptSeriesFromMapped,
} from "@/lib/harvey-lab/attempt-series";
import type { RawRunRow } from "@/lib/harvey-lab/attempt-series";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";
import { WorkflowStatus } from "@prisma/client";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRawRow(overrides: Partial<RawRunRow> & { taskSlug?: string; n_passed?: number; n_total?: number } = {}): RawRunRow {
  const { taskSlug = "antitrust/task-1", n_passed = 10, n_total = 42, ...rest } = overrides;
  return {
    id: `run-${Math.random()}`,
    workspaceId: "ws-1",
    status: "COMPLETED",
    projectId: null,
    createdAt: new Date().toISOString(),
    result: JSON.stringify({ taskSlug, n_passed, n_total, taskTitle: "Test Task", all_pass: false }),
    ...rest,
  };
}

function makeMappedRow(overrides: Partial<BenchmarkRunListRow> = {}): BenchmarkRunListRow {
  return {
    id: `run-${Math.random()}`,
    workspaceId: "ws-1",
    status: WorkflowStatus.COMPLETED,
    projectId: null,
    taskSlug: "antitrust/task-1",
    taskTitle: "Test Task",
    createdAt: new Date().toISOString(),
    n_passed: 10,
    n_total: 42,
    all_pass: false,
    ...overrides,
  };
}

// ── buildAttemptSeries ────────────────────────────────────────────────────────

describe("buildAttemptSeries", () => {
  it("returns an empty Map for an empty input", () => {
    const result = buildAttemptSeries([]);
    expect(result.size).toBe(0);
  });

  it("groups runs by taskSlug", () => {
    const rows: RawRunRow[] = [
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-01T00:00:00Z", n_passed: 10, n_total: 42 }),
      makeRawRow({ taskSlug: "ip/task-2", createdAt: "2024-01-01T00:00:00Z", n_passed: 5, n_total: 20 }),
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-02T00:00:00Z", n_passed: 20, n_total: 42 }),
    ];
    const result = buildAttemptSeries(rows);
    expect(result.size).toBe(2);
    expect(result.get("antitrust/task-1")).toHaveLength(2);
    expect(result.get("ip/task-2")).toHaveLength(1);
  });

  it("sorts each group by createdAt ascending", () => {
    const rows: RawRunRow[] = [
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-03T00:00:00Z", n_passed: 30, n_total: 42 }),
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-01T00:00:00Z", n_passed: 10, n_total: 42 }),
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-02T00:00:00Z", n_passed: 20, n_total: 42 }),
    ];
    const result = buildAttemptSeries(rows);
    const series = result.get("antitrust/task-1")!;
    expect(series[0].n_passed).toBe(10);
    expect(series[1].n_passed).toBe(20);
    expect(series[2].n_passed).toBe(30);
  });

  it("marks the earliest run as baseline (isBaseline: true), rest as reruns", () => {
    const rows: RawRunRow[] = [
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-01T00:00:00Z", n_passed: 10, n_total: 42 }),
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-02T00:00:00Z", n_passed: 20, n_total: 42 }),
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-03T00:00:00Z", n_passed: 30, n_total: 42 }),
    ];
    const result = buildAttemptSeries(rows);
    const series = result.get("antitrust/task-1")!;
    expect(series[0].isBaseline).toBe(true);
    expect(series[1].isBaseline).toBe(false);
    expect(series[2].isBaseline).toBe(false);
  });

  it("sets attemptIndex correctly (0, 1, 2, …)", () => {
    const rows: RawRunRow[] = [
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-01T00:00:00Z", n_passed: 10, n_total: 42 }),
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-02T00:00:00Z", n_passed: 20, n_total: 42 }),
    ];
    const result = buildAttemptSeries(rows);
    const series = result.get("antitrust/task-1")!;
    expect(series[0].attemptIndex).toBe(0);
    expect(series[1].attemptIndex).toBe(1);
  });

  it("drops rows whose result is null or unparseable", () => {
    const rows: RawRunRow[] = [
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-01T00:00:00Z", n_passed: 10, n_total: 42 }),
      { ...makeRawRow(), result: null },
      { ...makeRawRow(), result: "not-json" },
    ];
    const result = buildAttemptSeries(rows);
    const series = result.get("antitrust/task-1")!;
    expect(series).toHaveLength(1);
  });

  it("drops rows whose result lacks n_passed or n_total", () => {
    const missingNPassed: RawRunRow = {
      ...makeRawRow({ taskSlug: "antitrust/task-1" }),
      result: JSON.stringify({ taskSlug: "antitrust/task-1", n_total: 42 }),
    };
    const missingNTotal: RawRunRow = {
      ...makeRawRow({ taskSlug: "antitrust/task-1" }),
      result: JSON.stringify({ taskSlug: "antitrust/task-1", n_passed: 10 }),
    };
    const good = makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-01T00:00:00Z", n_passed: 10, n_total: 42 });
    const result = buildAttemptSeries([missingNPassed, missingNTotal, good]);
    expect(result.get("antitrust/task-1")).toHaveLength(1);
  });

  it("drops rows with no taskSlug in result", () => {
    const noSlug: RawRunRow = {
      ...makeRawRow(),
      result: JSON.stringify({ n_passed: 10, n_total: 42 }),
    };
    const result = buildAttemptSeries([noSlug]);
    expect(result.size).toBe(0);
  });

  it("a single-entry series has isBaseline: true and attemptIndex: 0", () => {
    const rows: RawRunRow[] = [
      makeRawRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-01T00:00:00Z", n_passed: 10, n_total: 42 }),
    ];
    const result = buildAttemptSeries(rows);
    const series = result.get("antitrust/task-1")!;
    expect(series).toHaveLength(1);
    expect(series[0].isBaseline).toBe(true);
    expect(series[0].attemptIndex).toBe(0);
  });
});

// ── buildAttemptSeriesFromMapped ──────────────────────────────────────────────

describe("buildAttemptSeriesFromMapped", () => {
  it("groups by taskSlug from mapped rows", () => {
    const rows = [
      makeMappedRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-01T00:00:00Z", n_passed: 10, n_total: 42 }),
      makeMappedRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-02T00:00:00Z", n_passed: 25, n_total: 42 }),
      makeMappedRow({ taskSlug: "ip/task-2", createdAt: "2024-01-01T00:00:00Z", n_passed: 5, n_total: 20 }),
    ];
    const result = buildAttemptSeriesFromMapped(rows);
    expect(result.get("antitrust/task-1")).toHaveLength(2);
    expect(result.get("ip/task-2")).toHaveLength(1);
  });

  it("drops rows missing n_passed or n_total", () => {
    const rows = [
      makeMappedRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-01T00:00:00Z", n_passed: 10, n_total: 42 }),
      makeMappedRow({ taskSlug: "antitrust/task-1", n_passed: undefined, n_total: 42 }),
    ];
    const result = buildAttemptSeriesFromMapped(rows);
    expect(result.get("antitrust/task-1")).toHaveLength(1);
  });

  it("sorts by createdAt ascending and marks baseline", () => {
    const rows = [
      makeMappedRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-03T00:00:00Z", n_passed: 30, n_total: 42 }),
      makeMappedRow({ taskSlug: "antitrust/task-1", createdAt: "2024-01-01T00:00:00Z", n_passed: 10, n_total: 42 }),
    ];
    const result = buildAttemptSeriesFromMapped(rows);
    const series = result.get("antitrust/task-1")!;
    expect(series[0].n_passed).toBe(10);
    expect(series[0].isBaseline).toBe(true);
    expect(series[1].n_passed).toBe(30);
    expect(series[1].isBaseline).toBe(false);
  });
});
