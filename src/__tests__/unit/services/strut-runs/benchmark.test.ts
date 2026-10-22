import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const { mockStrutRun } = vi.hoisted(() => ({ mockStrutRun: { findFirst: vi.fn() } }));

vi.mock("@/lib/db", () => ({ db: { strutRun: mockStrutRun } }));
vi.mock("@/services/strut-runs", () => ({ STRUT_RUN_LOG_TAG: "STRUT_RUN" }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getBenchmark } from "@/lib/benchmarks/registry";
import { handleBenchmarkRunSettled, hasPendingBenchmarkRun } from "@/services/strut-runs/benchmark";

beforeEach(() => vi.clearAllMocks());

describe("benchmark strut-run handler", () => {
  it("pending guard is per task, by the benchmark's task key", async () => {
    mockStrutRun.findFirst.mockResolvedValue({ id: "x" });
    expect(await hasPendingBenchmarkRun("ws", getBenchmark("harvey-lab")!, "banking/x")).toBe(true);
    expect(mockStrutRun.findFirst.mock.calls[0][0].where).toEqual({
      workspaceId: "ws",
      kind: "benchmark:harvey-lab",
      status: StrutRunStatus.PENDING,
      input: { path: ["task_slug"], equals: "banking/x" },
    });
    mockStrutRun.findFirst.mockResolvedValue(null);
    expect(await hasPendingBenchmarkRun("ws", { slug: "x", name: "x", runWorkflow: "x" }, 5)).toBe(false);
    expect(mockStrutRun.findFirst.mock.calls[1][0].where.input).toEqual({ path: ["taskId"], equals: 5 });
  });
  it("settle handler resolves", async () => {
    const row = { id: "r1", kind: "benchmark:harvey-lab", workspaceId: "ws", status: StrutRunStatus.SUCCESS };
    await expect(handleBenchmarkRunSettled(row as never)).resolves.toBeUndefined();
  });
});
