/**
 * Unit tests for the orchestrator wake (`services/strut-orchestrator-wake.ts`)
 * — hive waking strut's orchestrator on a job it started.
 *
 * Themes:
 *   - the prompt: the job's reply inline (capped), the question, the cards,
 *     the three choices with the silent marker in place of a tool; the
 *     event variant that never continues;
 *   - the launch: as the conversation's owner, in its org, on the same
 *     conversation, with the wake id for the marker;
 *   - busy is retried a bounded number of times with the given waits, then
 *     dropped; an error is not retried; nothing throws;
 *   - the gate: the wake runs through `runGatedAutoTurn` with the launch
 *     marker as its idempotency mark, job rows as its loop count, and the
 *     owner's opt-in waived;
 *   - the medium: a tribe's conversation (its `TribeThread`) launches with
 *     `tribe` (the name, no asker), a call's (a `call_request` row) with
 *     `call`, a web conversation with neither; a tribe read that fails
 *     launches without the line.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGate, mockLaunch, mockTribeThread, mockModel } = vi.hoisted(() => ({
  mockGate: vi.fn(),
  mockLaunch: vi.fn(),
  mockTribeThread: vi.fn(),
  mockModel: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { tribeThread: { findUnique: mockTribeThread } } }));
vi.mock("@/lib/ai/resolve-model", () => ({ loadUserChatAgentModel: mockModel }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/canvas-strut-autoturn", () => ({ runGatedAutoTurn: mockGate }));
vi.mock("@/services/strut-orchestrator", () => ({ launchOrchestratorTurn: mockLaunch }));

import {
  MAX_WAKE_TEXT_CHARS,
  ORCHESTRATOR_WAKE_RETRY_DELAYS_MS,
  buildOrchestratorJobWakeText,
  invokeOrchestratorOnJobTurn,
  type OrchestratorJobWakeArgs,
} from "@/services/strut-orchestrator-wake";
import { countTrailingJobRows } from "@/lib/strut-orchestrator";

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";

const args = (over: Partial<OrchestratorJobWakeArgs> = {}): OrchestratorJobWakeArgs => ({
  conversationId: "conv-1",
  wakeId: "job-row-1",
  workspaceSlug: "acme",
  jobId: JOB,
  title: "Dark mode plan",
  outcome: "success",
  text: "Wrote the plan to plan.md.",
  artifacts: [{ title: "Plan", kind: "markdown", label: "plan" }],
  publicBaseUrl: "https://hive.example.com",
  startedByOrchestrator: true,
  ...over,
});

const conversation = { userId: "user-1", orgId: "org-1", workspaceSlug: "home", settings: {}, messages: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockTribeThread.mockResolvedValue(null); // a web conversation
  mockModel.mockResolvedValue(undefined); // no pick: the template's default
  // The gate lets the turn through with the conversation as found.
  mockGate.mockImplementation(async (_gate, run) => run(conversation));
  mockLaunch.mockResolvedValue({ status: "started", runId: "orch-row-2", strutRunId: "1790000000002" });
});

describe("buildOrchestratorJobWakeText", () => {
  it("names the job as the orchestrator's own, inlines its reply, question and cards, and offers the three choices", () => {
    const text = buildOrchestratorJobWakeText(args({ ask: "Which repo?" }));
    expect(text).toContain(`job \`${JOB}\` ("Dark mode plan") on workspace \`acme\``);
    expect(text).toContain("which you started with job/start");
    expect(text).toContain("STOPPED FOR A DECISION");
    expect(text).toContain("<<<job reply\nWrote the plan to plan.md.\n>>>");
    expect(text).toContain("Its question for the user: Which repo?");
    expect(text).toContain("Plan (plan)");
    expect(text).toContain("COLLAPSED");
    expect(text).toContain("**Summarize**");
    expect(text).toContain(`call job/continue with job \`${JOB}\``);
    expect(text).toContain("reply with exactly `[silent]` and nothing else");
    expect(text).toContain("job/get");
  });

  it("the summary is a posture, not a checklist: what is new, the job's caveats left out, no next step offered", () => {
    const text = buildOrchestratorJobWakeText(args());
    expect(text).toContain("Its reply to you, verbatim:");
    expect(text).toContain("its note to YOU, not a draft of your message — never shorten it line by line");
    expect(text).toContain("Say what is NEW against what you already told the person");
    expect(text).toContain("a line when the result confirms it, what it adds when it adds");
    expect(text).toContain("the detail is in the cards");
    expect(text).toContain("Leave out how the job worked");
    expect(text).toContain("offering no next step");
    expect(text).not.toContain("one short paragraph");
    expect(text).not.toContain("the question it asked if it asked one, and the next step.");
  });

  it("read in a tribe or on a call, the prompt says the entry is not shown there and the cards go to the person; the event wake the same", () => {
    const tribe = buildOrchestratorJobWakeText(args(), "tribe");
    expect(tribe).toContain("a Sphinx tribe — the job's entry is NOT shown: your reply is all the person reads");
    expect(tribe).toContain("What it produced goes to the person as cards they can open: Plan (plan).");
    expect(tribe).not.toContain("COLLAPSED");
    expect(tribe).not.toContain("attached to that entry");
    const call = buildOrchestratorJobWakeText(args(), "call");
    expect(call).toContain("a voice call — the job's entry is NOT shown: your reply is read out");
    expect(call).not.toContain("COLLAPSED");
    const event = buildOrchestratorJobWakeText(
      args({ event: { kind: "pull_request", url: "https://github.com/acme/app/pull/7", what: "merged" } }),
      "tribe",
    );
    expect(event).toContain("a Sphinx tribe — the job's entry is NOT shown");
    expect(event).not.toContain("COLLAPSED");
  });

  it("a job hive started (a card, an older conversation) is not called the orchestrator's own", () => {
    const text = buildOrchestratorJobWakeText(args({ startedByOrchestrator: false }));
    expect(text).toContain("which was started from this conversation");
    expect(text).not.toContain("which you started");
    expect(text).toContain(`call job/continue with job \`${JOB}\``);
  });

  it("says how the turn ended; an empty reply and no cards are said so; the reply is capped", () => {
    expect(buildOrchestratorJobWakeText(args({ outcome: "error", text: "boom" }))).toContain("has failed");
    expect(buildOrchestratorJobWakeText(args({ outcome: "cancelled" }))).toContain("stopped by the user");
    expect(buildOrchestratorJobWakeText(args({ outcome: "lost" }))).toContain("been lost");
    const bare = buildOrchestratorJobWakeText(args({ text: "  ", artifacts: [] }));
    expect(bare).toContain("Nothing is attached to it.");
    expect(bare).toContain("<<<job reply\n(no reply text)\n>>>");
    const long = buildOrchestratorJobWakeText(args({ text: "x".repeat(MAX_WAKE_TEXT_CHARS + 100) }));
    expect(long).toContain("x".repeat(MAX_WAKE_TEXT_CHARS) + "…");
    expect(long).not.toContain("x".repeat(MAX_WAKE_TEXT_CHARS + 1));
  });

  it("an event's turn: one line or silence, never continue", () => {
    const text = buildOrchestratorJobWakeText(
      args({ event: { kind: "pull_request", url: "https://github.com/acme/app/pull/7", what: "merged" } }),
    );
    expect(text).toContain("started by neither you nor the user");
    expect(text).toContain("https://github.com/acme/app/pull/7");
    expect(text).toContain("**Tell the user**");
    expect(text).toContain("Never call job/continue from here");
    expect(text).not.toContain("**Summarize**");
    expect(text).toContain("<<<job reply\nWrote the plan to plan.md.\n>>>");
  });
});

describe("invokeOrchestratorOnJobTurn", () => {
  it("runs behind the gate — the launch marker as its mark, job rows as its loop count — and launches as the owner on the conversation", async () => {
    await invokeOrchestratorOnJobTurn(args());

    expect(mockGate).toHaveBeenCalledTimes(1);
    const gate = mockGate.mock.calls[0][0];
    expect(gate).toMatchObject({
      tag: "orchestrator-job-wake",
      conversationId: "conv-1",
      wakeId: "job-row-1",
      about: { jobId: JOB, outcome: "success" },
    });
    expect(gate).not.toHaveProperty("ownerOptIn");
    expect(gate.trailingLaunches).toBe(countTrailingJobRows);
    expect(
      gate.alreadyHandled([
        { id: "a", role: "assistant", source: { kind: "orchestrator_launch", runId: "r", wakeId: "job-row-1" } },
      ]),
    ).toBe(true);
    expect(
      gate.alreadyHandled([
        { id: "a", role: "assistant", source: { kind: "orchestrator_launch", runId: "r", wakeId: "job-row-0" } },
      ]),
    ).toBe(false);
    expect(
      gate.alreadyHandled([{ id: "a", role: "assistant", source: { kind: "orchestrator_launch", runId: "r" } }]),
    ).toBe(false);
    expect(gate.alreadyHandled([{ id: "job-row-1", role: "assistant", source: { kind: "job" } }])).toBe(false);

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenCalledWith({
      userId: "user-1",
      orgId: "org-1",
      conversationId: "conv-1",
      message: expect.stringContaining(`job \`${JOB}\``),
      publicBaseUrl: "https://hive.example.com",
      wakeId: "job-row-1",
    });
  });

  it("a gate that says no launches nothing", async () => {
    mockGate.mockResolvedValue(undefined);
    await invokeOrchestratorOnJobTurn(args());
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("a wake on a tribe's conversation launches with the tribe — its name off the link, no asker — so the summary is written for the room", async () => {
    mockTribeThread.mockResolvedValue({ link: { name: "Builders" } });
    await invokeOrchestratorOnJobTurn(args());
    expect(mockTribeThread).toHaveBeenCalledWith({
      where: { conversationId: "conv-1" },
      select: { link: { select: { name: true } } },
    });
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ wakeId: "job-row-1", tribe: { name: "Builders" } }),
    );
    expect(mockLaunch.mock.calls[0][0]).not.toHaveProperty("call");
    // The prompt is written for the room too: nothing of the entry is shown there.
    expect(mockLaunch.mock.calls[0][0].message).toContain("a Sphinx tribe — the job's entry is NOT shown");
    expect(mockLaunch.mock.calls[0][0].message).not.toContain("COLLAPSED");
  });

  it("a wake on a call's conversation (a call_request row) launches with `call`, and reads no tribe", async () => {
    mockGate.mockImplementation(async (_gate, run) =>
      run({
        ...conversation,
        messages: [
          {
            id: "u1",
            role: "user",
            content: "Alice: what are we on?",
            source: { kind: "call_request", speaker: "Alice", via: "voice" },
          },
        ],
      }),
    );
    await invokeOrchestratorOnJobTurn(args());
    expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({ wakeId: "job-row-1", call: true }));
    expect(mockLaunch.mock.calls[0][0]).not.toHaveProperty("tribe");
    expect(mockTribeThread).not.toHaveBeenCalled();
    expect(mockLaunch.mock.calls[0][0].message).toContain("a voice call — the job's entry is NOT shown");
  });

  it("the wake runs on the conversation owner's model, as the person's turns do; a failed read launches on the template's default", async () => {
    mockModel.mockResolvedValue("anthropic/claude-opus-5-5");
    await invokeOrchestratorOnJobTurn(args());
    expect(mockModel).toHaveBeenCalledWith("user-1");
    expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({ wakeId: "job-row-1", model: "anthropic/claude-opus-5-5" }));

    vi.clearAllMocks();
    mockGate.mockImplementation(async (_gate, run) => run(conversation));
    mockLaunch.mockResolvedValue({ status: "started", runId: "orch-row-3", strutRunId: "1790000000003" });
    mockTribeThread.mockResolvedValue(null);
    mockModel.mockRejectedValue(new Error("db down"));
    await invokeOrchestratorOnJobTurn(args());
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch.mock.calls[0][0]).not.toHaveProperty("model");
  });

  it("a tribe read that fails launches the wake without the line, never drops it", async () => {
    mockTribeThread.mockRejectedValue(new Error("db down"));
    await invokeOrchestratorOnJobTurn(args());
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch.mock.calls[0][0]).not.toHaveProperty("tribe");
    expect(mockLaunch.mock.calls[0][0]).not.toHaveProperty("call");
    expect(mockLaunch.mock.calls[0][0].message).toContain("COLLAPSED");
  });

  it("busy is retried after each wait, then launched; the waits are the configured ones", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    mockLaunch
      .mockResolvedValueOnce({ status: "busy", note: "Still working" })
      .mockResolvedValueOnce({ status: "busy", note: "Still working" })
      .mockResolvedValueOnce({ status: "started", runId: "orch-row-2", strutRunId: "s" });
    await invokeOrchestratorOnJobTurn(args(), { sleep, retryDelaysMs: [5, 7] });
    expect(mockLaunch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5, 7]);
    expect(ORCHESTRATOR_WAKE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThan(45_000);
  });

  it("a session that stays busy is dropped after the last wait, quietly; an error is never retried", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ status: "busy", note: "Still working" });
    await expect(invokeOrchestratorOnJobTurn(args(), { sleep, retryDelaysMs: [1, 1] })).resolves.toBeUndefined();
    expect(mockLaunch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    mockLaunch.mockReset();
    sleep.mockClear();
    mockLaunch.mockResolvedValue({ status: "error", error: "no orchestrator workflow" });
    await invokeOrchestratorOnJobTurn(args(), { sleep, retryDelaysMs: [1, 1] });
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a launch that throws reaches the gate (which logs it), not the caller", async () => {
    mockGate.mockImplementation(async (_gate, run) => {
      await expect(run(conversation)).rejects.toThrow("down");
    });
    mockLaunch.mockRejectedValue(new Error("down"));
    await expect(invokeOrchestratorOnJobTurn(args(), { retryDelaysMs: [] })).resolves.toBeUndefined();
  });
});
