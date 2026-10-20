import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const { mockStrutRun, mockDispatch, mockSettle } = vi.hoisted(() => ({
  mockStrutRun: { findMany: vi.fn(), findFirst: vi.fn() },
  mockDispatch: vi.fn(),
  mockSettle: vi.fn(async (row: unknown) => row),
}));

vi.mock("@/lib/db", () => ({ db: { strutRun: mockStrutRun } }));
vi.mock("@/services/strut-runs", () => ({ dispatchStrutRun: mockDispatch, STRUT_RUN_LOG_TAG: "STRUT_RUN" }));
vi.mock("@/services/strut-runs/openhealth", async (orig) => ({
  ...(await orig<typeof import("@/services/strut-runs/openhealth")>()),
  settleFromStrut: mockSettle,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getBenchmark } from "@/lib/benchmarks/registry";
import { openHealthWorkdir } from "@/lib/openhealth-benchmarks/constants";
import { launchOpenHealthRun } from "@/services/strut-runs/openhealth";
import {
  getBenchmarkRun,
  handleBenchmarkRunSettled,
  hasPendingBenchmarkRun,
  launchBenchmarkRun,
  listBenchmarkRuns,
} from "@/services/strut-runs/benchmark";

const openhealth = getBenchmark("openhealth")!;
const benchmark = { slug: "openhealth", name: "OH", runWorkflow: "openhealth-run", denyKeys: ["secret"] };
const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  status: StrutRunStatus.SUCCESS,
  input: { taskId: 5, seed: 1 },
  output: { score: 0.7, metric: "f1", secret: "x", extra: 1 },
  error: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  settledAt: new Date("2026-01-01T00:05:00Z"),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("benchmark strut-run handler", () => {
  it("launches runWorkflow with { taskId, ...params } under kind benchmark:<slug>", async () => {
    mockDispatch.mockResolvedValue({ runId: "r", strutRunId: "s", swarmId: "w" });
    await launchBenchmarkRun({ workspaceId: "ws", userId: "u", publicBaseUrl: "https://h", benchmark, taskId: 5, params: { seed: 1 } });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "benchmark:openhealth",
        workflow: "openhealth-run",
        purpose: "benchmark",
        input: { seed: 1, taskId: 5 },
      }),
    );
  });
  it("openhealth: generic launch input equals what the OpenHealth route sends", async () => {
    mockDispatch.mockResolvedValue({ runId: "r", strutRunId: "s", swarmId: "w" });
    const gtId = 7532;
    // The task as `openhealth-list-tasks` lists it (parseTaskList keeps every field).
    const task = { id: gtId, gtId, title: String(gtId), task: "patient_diagnosis", difficulty: "hard", patientId: 1 };
    await launchBenchmarkRun({ workspaceId: "ws", userId: "u", publicBaseUrl: "https://h", benchmark: openhealth, taskId: gtId, task });
    await launchOpenHealthRun({ workspaceId: "ws", userId: "u", publicBaseUrl: "https://h", gtId, task: "patient_diagnosis" });
    const [generic, existing] = mockDispatch.mock.calls.map((c) => c[0]);
    expect(generic.input).toEqual(existing.input);
    expect(generic.input).toEqual({ gtId, task: "patient_diagnosis", workdir: openHealthWorkdir(gtId) });
    expect(generic.workflow).toBe(existing.workflow);
    expect(generic.purpose).toBe(existing.purpose);
  });
  it("params win over mapped task fields and defaults", async () => {
    mockDispatch.mockResolvedValue({ runId: "r", strutRunId: "s", swarmId: "w" });
    const task = { id: 1, title: "1", task: "patient_diagnosis" };
    await launchBenchmarkRun({ workspaceId: "ws", userId: "u", publicBaseUrl: "h", benchmark: openhealth, taskId: 1, task, params: { workdir: "x" } });
    expect(mockDispatch.mock.calls[0][0].input).toMatchObject({ gtId: 1, workdir: "x" });
  });
  it("openhealth rows identify the task by gtId", async () => {
    mockStrutRun.findMany.mockResolvedValue([row({ input: { gtId: 9, task: "patient_diagnosis", workdir: "gt-9" } })]);
    expect((await listBenchmarkRuns("ws", openhealth))[0].taskId).toBe(9);
    mockStrutRun.findFirst.mockResolvedValue({ id: "x" });
    await hasPendingBenchmarkRun("ws", openhealth, 9);
    expect(mockStrutRun.findFirst.mock.calls.at(-1)![0].where.input).toEqual({ path: ["gtId"], equals: 9 });
  });
  it("lists per benchmark kind with headline fields", async () => {
    mockStrutRun.findMany.mockResolvedValue([row()]);
    const runs = await listBenchmarkRuns("ws", benchmark);
    expect(mockStrutRun.findMany.mock.calls[0][0].where).toEqual({ workspaceId: "ws", kind: "benchmark:openhealth" });
    expect(runs[0]).toMatchObject({ id: "r1", taskId: 5, score: 0.7, metric: "f1", status: "SUCCESS" });
  });
  it("detail applies the deny list and returns params", async () => {
    mockStrutRun.findFirst.mockResolvedValue(row());
    const d = await getBenchmarkRun("ws", benchmark, "r1");
    expect(d?.extra.value).toEqual({ extra: 1 });
    expect(d?.params).toEqual({ seed: 1 });
    mockStrutRun.findFirst.mockResolvedValue(null);
    expect(await getBenchmarkRun("ws", benchmark, "nope")).toBeNull();
  });
  it("pending guard is per task", async () => {
    mockStrutRun.findFirst.mockResolvedValue({ id: "x" });
    expect(await hasPendingBenchmarkRun("ws", benchmark, 5)).toBe(true);
    expect(mockStrutRun.findFirst.mock.calls[0][0].where.input).toEqual({ path: ["taskId"], equals: 5 });
  });
  it("settle handler resolves", async () => {
    await expect(handleBenchmarkRunSettled(row() as never)).resolves.toBeUndefined();
  });
});
