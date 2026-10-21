import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const { mockEvents, mockTranscript, mockLabFor } = vi.hoisted(() => ({
  mockEvents: vi.fn(),
  mockTranscript: vi.fn(),
  mockLabFor: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { strutRun: {} } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import type { StrutRunEvent } from "@/lib/legal-cascade/strut";

const WF = "harvey-lab-run";
const T = (s: number) => new Date(Date.UTC(2026, 9, 21, 3, 0, s)).toISOString();
const LINK = `/workflows/${WF}/runs/179/transcripts/${WF}/checklist`;

const events = (ended: boolean): StrutRunEvent[] => [
  { type: "step.start", path: `${WF}/checklist`, stepType: "agent", ts: T(1), input: { prompt: "Build the checklist." } },
  { type: "step.start", path: `${WF}/checklist/001-bash`, stepType: "tool:bash", toolCallId: "c1", ts: T(2), input: { command: "ls" } },
  { type: "step.end", path: `${WF}/checklist/001-bash`, stepType: "tool:bash", toolCallId: "c1", ts: T(3), output: "a.md" },
  ...(ended
    ? [{ type: "step.end", path: `${WF}/checklist`, stepType: "agent", ts: T(4), output: { result: "Done." }, transcript: LINK }]
    : []),
];

const transcript = [
  { role: "assistant", content: [{ type: "text", text: "List the files." }, { type: "tool-call", toolCallId: "c1" }] },
];

const row = (status: StrutRunStatus = StrutRunStatus.PENDING) =>
  ({ id: "row-1", swarmId: "sw", workflow: WF, strutRunId: "179", status }) as never;

describe("strut traces for the legal cascade", () => {
  let trace: typeof import("@/services/strut-runs/legal-trace");

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("@/services/strut-runs/lab", () => ({
      fetchStrutRunEvents: mockEvents,
      fetchStrutTranscript: mockTranscript,
    }));
    trace = await import("@/services/strut-runs/legal-trace");
    trace.clearStrutTraceCache();
  });

  it("reads a live run's log once per short window", async () => {
    mockEvents.mockResolvedValue(events(false));
    const now = Date.now();
    await trace.readStrutTrace(row(), now);
    await trace.readStrutTrace(row(), now + 5_000);
    expect(mockEvents).toHaveBeenCalledTimes(1);
    await trace.readStrutTrace(row(), now + 11_000);
    expect(mockEvents).toHaveBeenCalledTimes(2);
  });

  it("lists top-level agents and answers null when strut cannot", async () => {
    mockEvents.mockResolvedValue(events(false));
    expect((await trace.strutTraceSessions(row()))!.map((s) => [s.id, s.status])).toEqual([["checklist", "running"]]);
    trace.clearStrutTraceCache();
    mockEvents.mockResolvedValue(null);
    expect(await trace.strutTraceSessions(row())).toBeNull();
  });

  it("pages a running agent's turns after the cursor, with no transcript read", async () => {
    mockEvents.mockResolvedValue(events(false));
    const page = await trace.strutTraceTurns(row(), "checklist", 2);
    expect(page).toMatchObject({ session_id: "checklist", status: "running", turn_count: 3 });
    expect(page!.turns.map((t) => t.order)).toEqual([3]);
    expect(mockTranscript).not.toHaveBeenCalled();
  });

  it("sends a finished agent whole, its reasoning read from the transcript once", async () => {
    mockEvents.mockResolvedValue(events(true));
    mockTranscript.mockResolvedValue(transcript);
    const page = await trace.strutTraceTurns(row(StrutRunStatus.SUCCESS), "checklist", 99);
    expect(page!.turns.map((t) => [t.order, t.turn_type])).toEqual([
      [0, "user_input"],
      [1, "reasoning"],
      [2, "tool_call"],
      [3, "tool_result"],
      [4, "response"],
    ]);
    expect(page!.turns[1].content).toBe("List the files.");
    // The version counter stays the log's, so the list and the page agree.
    expect(page!.turn_count).toBe(4);
    expect(mockTranscript).toHaveBeenCalledWith(expect.objectContaining({ id: "row-1" }), LINK);
    await trace.strutTraceTurns(row(StrutRunStatus.SUCCESS), "checklist", 4);
    expect(mockTranscript).toHaveBeenCalledTimes(1);
  });

  it("still sends a finished agent's turns when its transcript cannot be read", async () => {
    mockEvents.mockResolvedValue(events(true));
    mockTranscript.mockResolvedValue(null);
    const page = await trace.strutTraceTurns(row(StrutRunStatus.SUCCESS), "checklist", -1);
    expect(page!.turns.map((t) => t.turn_type)).toEqual(["user_input", "tool_call", "tool_result", "response"]);
  });

  it("knows no session the run does not have", async () => {
    mockEvents.mockResolvedValue(events(true));
    expect(await trace.strutTraceTurns(row(), "nope", -1)).toBeNull();
    expect(await trace.strutTraceSessionDetail(row(), "nope")).toBeNull();
    expect(await trace.strutTraceSessionDetail(row(), "checklist")).toMatchObject({ id: "checklist", descendants: [] });
  });
});

describe("fetchStrutTranscript", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("@/services/strut-runs/lab");
    vi.doMock("@/services/strut-runs", () => ({ labForRow: mockLabFor, STRUT_RUN_LOG_TAG: "STRUT_RUN" }));
    mockLabFor.mockResolvedValue({ labBase: "https://swarm.example/lab", swarmApiKey: "k" });
  });

  it("follows only a link under the row's own run", async () => {
    const { fetchStrutTranscript } = await import("@/services/strut-runs/lab");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(transcript), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = { id: "row-1", swarmId: "sw", workflow: WF, strutRunId: "179" };

    expect(await fetchStrutTranscript(r, LINK)).toEqual(transcript);
    expect(fetchMock).toHaveBeenCalledWith(`https://swarm.example/lab${LINK}`, expect.objectContaining({ headers: { "x-api-token": "k" } }));

    fetchMock.mockClear();
    expect(await fetchStrutTranscript(r, `/workflows/${WF}/runs/OTHER/transcripts/x`)).toBeNull();
    expect(await fetchStrutTranscript(r, `/workflows/${WF}/runs/179/transcripts/../../../secrets`)).toBeNull();
    expect(await fetchStrutTranscript({ ...r, strutRunId: null }, LINK)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
