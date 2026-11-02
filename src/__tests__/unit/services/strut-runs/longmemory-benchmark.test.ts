import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const { mockStrutRun, mockDispatch, mockSettle } = vi.hoisted(() => ({
  mockStrutRun: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  mockDispatch: vi.fn(),
  mockSettle: vi.fn(async (row: unknown) => row),
}));

vi.mock("@/lib/db", () => ({ db: { strutRun: mockStrutRun } }));
vi.mock("@/services/strut-runs", () => ({ dispatchStrutRun: mockDispatch, STRUT_RUN_LOG_TAG: "STRUT_RUN" }));
vi.mock("@/services/strut-runs/openhealth", () => ({ settleFromStrut: mockSettle }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  LongMemoryRunInProgressError,
  launchLongMemoryBatch,
  launchLongMemoryRun,
  listLongMemoryRuns,
  parseLongMemoryTaskList,
  toLongMemoryRunResult,
  toLongMemoryRunWireRow,
} from "@/services/strut-runs/longmemory-benchmark";
import { parseLongMemoryRunResult } from "@/types/longmemory";

const base = {
  workspaceId: "ws-1",
  userId: "u-1",
  publicBaseUrl: "https://hive.example",
};

const row = (over: Record<string, unknown>) =>
  ({
    id: "run-1",
    workspaceId: "ws-1",
    swarmId: "sw-1",
    userId: "u-1",
    kind: "benchmark:longmemory",
    workflow: "longmemory-run",
    strutRunId: "s-1",
    status: StrutRunStatus.SUCCESS,
    input: { question_id: "q1" },
    output: null,
    error: null,
    durationMs: 1,
    conversationId: null,
    proposalId: null,
    jobId: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    settledAt: new Date("2026-11-01T00:05:00Z"),
    ...over,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockStrutRun.findFirst.mockResolvedValue(null);
  mockDispatch.mockResolvedValue({ runId: "run-1", strutRunId: "s-1", swarmId: "sw-1" });
});

describe("launchLongMemoryRun", () => {
  it("launches longmemory-run with the question id and the legal models", async () => {
    await launchLongMemoryRun({ ...base, questionId: "q1", webhookUrl: "https://x.example/hook" });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "benchmark:longmemory",
        workflow: "longmemory-run",
        purpose: "benchmark",
        input: { question_id: "q1", webhook_url: "https://x.example/hook" },
        params: { reasoning_model: "claude-opus-5", standard_model: "claude-sonnet-5", judge_model: "claude-sonnet-4-6" },
      }),
    );
  });

  it("omits webhook_url when none is given", async () => {
    await launchLongMemoryRun({ ...base, questionId: "q1" });
    expect(mockDispatch.mock.calls[0][0].input).toEqual({ question_id: "q1" });
  });

  it("refuses a second run of a question in flight", async () => {
    mockStrutRun.findFirst.mockResolvedValue({ id: "pending" });
    await expect(launchLongMemoryRun({ ...base, questionId: "q1" })).rejects.toBeInstanceOf(LongMemoryRunInProgressError);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe("launchLongMemoryBatch", () => {
  it("launches longmemory-batch with an optional limit", async () => {
    await launchLongMemoryBatch({ ...base, limit: 5 });
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ workflow: "longmemory-batch", input: { limit: 5 } }));
    await launchLongMemoryBatch({ ...base });
    expect(mockDispatch.mock.calls[1][0].input).toEqual({});
  });

  it("refuses while a batch is in flight", async () => {
    mockStrutRun.findFirst.mockResolvedValue({ id: "pending" });
    await expect(launchLongMemoryBatch({ ...base })).rejects.toBeInstanceOf(LongMemoryRunInProgressError);
  });
});

describe("run shaping", () => {
  it("maps a single run's output and never leaks other fields", () => {
    const result = toLongMemoryRunResult(
      row({
        output: {
          callback: {
            question_id: "q1",
            score: 0,
            metric: "qa_accuracy",
            officialScore: 0,
            summary: "wrong",
            questionType: "temporal-reasoning",
            abstention: false,
            judgeModel: "claude-sonnet-4-6",
            missCause: "retrieval",
            hypothesis: "Tuesday",
            answer: "SECRET-KEY",
          },
        },
      }),
    );
    expect(result).toMatchObject({ mode: "single", question_id: "q1", score: 0, hypothesis: "Tuesday", missCause: "retrieval" });
    expect(JSON.stringify(result)).not.toContain("SECRET-KEY");
  });

  it("maps a batch run", () => {
    const result = toLongMemoryRunResult(
      row({
        workflow: "longmemory-batch",
        input: { limit: 10 },
        output: {
          callback: {
            n: 10,
            accuracy: 0.6,
            byType: { a: { n: 4, accuracy: 0.5 } },
            abstentionAccuracy: 1,
            misses: [{ question_id: "q2", questionType: "a", missCause: "x", gold: "SECRET" }],
            totalCost: 1.5,
          },
        },
      }),
    );
    expect(result).toMatchObject({ mode: "batch", limit: 10, n: 10, accuracy: 0.6, abstentionAccuracy: 1, totalCost: 1.5 });
    expect(result.misses).toEqual([{ question_id: "q2", questionType: "a", missCause: "x" }]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("wire rows carry a parseable result and a report flag", () => {
    const wire = toLongMemoryRunWireRow(row({ status: StrutRunStatus.PENDING, strutRunId: "s-1" }));
    expect(wire.status).toBe("IN_PROGRESS");
    expect(parseLongMemoryRunResult(wire.result)?.question_id).toBe("q1");
  });

  it("lists runs newest first and settles each", async () => {
    mockStrutRun.findMany.mockResolvedValue([row({})]);
    mockStrutRun.count.mockResolvedValue(1);
    const out = await listLongMemoryRuns("ws-1");
    expect(out.total).toBe(1);
    expect(out.runs).toHaveLength(1);
    expect(mockSettle).toHaveBeenCalledTimes(1);
  });
});

describe("parseLongMemoryTaskList", () => {
  it("lists whatever comes back, without a fixed count", () => {
    const list = parseLongMemoryTaskList({
      tasks: [
        { question_id: "a1", questionType: "t1", answer: "SECRET" },
        { id: "b2_abs", type: "t2" },
        { nope: true },
      ],
    });
    expect(list).toEqual({
      total: 2,
      tasks: [
        { id: "a1", type: "t1", abstention: false },
        { id: "b2_abs", type: "t2", abstention: true },
      ],
    });
    expect(parseLongMemoryTaskList({})).toBeNull();
  });
});
