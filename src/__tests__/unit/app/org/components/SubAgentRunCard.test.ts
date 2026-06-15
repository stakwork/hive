/**
 * Unit tests for the `SubAgentRunCard` status derivation (Phase 3 of
 * `docs/plans/canvas-agent-manages-planners.md`).
 *
 * Exercises the pure extractor + status logic end-to-end: build a
 * `CanvasChatMessage[]` transcript, run it through
 * `getSubAgentRunsFromMessages`, then assert `deriveCardStatus`
 * collapses it to the right pill. The `workflowStatus` / `hasForm`
 * signals ride on the inbound planner row's `source` marker, written
 * by the fan-out worker.
 */

import { describe, test, expect } from "vitest";
import {
  getSubAgentRunsFromMessages,
  deriveCardStatus,
  isDisplayableMessage,
} from "@/app/org/[githubLogin]/_components/SubAgentRunCard";
import {
  getSubAgentRunsFromMessages as runsFromMessages,
} from "@/app/org/[githubLogin]/_components/SubAgentRunCard";
import type { RunMessage } from "@/app/org/[githubLogin]/_components/SubAgentRunCard";
import type { CanvasChatMessage } from "@/app/org/[githubLogin]/_state/canvasChatStore";
import type { ClarifyingQuestion } from "@/types/stakwork";
import { SEND_TO_FEATURE_PLANNER_TOOL } from "@/lib/proposals/types";

const QUESTIONS: ClarifyingQuestion[] = [
  { question: "Stripe or Adyen?", type: "single_choice", options: ["Stripe", "Adyen"] },
];

const FEATURE_ID = "feat-1";

function outbound(id: string, message: string): CanvasChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: new Date(),
    toolCalls: [
      {
        id: `tc-${id}`,
        toolName: SEND_TO_FEATURE_PLANNER_TOOL,
        input: { featureId: FEATURE_ID, message },
        status: "output-available",
        output: {
          status: "sent",
          featureId: FEATURE_ID,
          featureTitle: "Auth API",
          workspaceSlug: "backend",
          workspaceName: "Backend",
        },
      },
    ],
  };
}

function inbound(
  id: string,
  content: string,
  extra: {
    workflowStatus?: string;
    hasForm?: boolean;
    formQuestions?: ClarifyingQuestion[];
    hasTasks?: boolean;
  } = {},
): CanvasChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp: new Date(),
    source: {
      kind: "planner",
      featureId: FEATURE_ID,
      plannerMessageId: id,
      ...extra,
    },
  };
}

/** A `user-answered-planner-form` row referencing the planner message `pmId`. */
function answered(id: string, pmId: string): CanvasChatMessage {
  return {
    id,
    role: "user",
    content: "Answered: Stripe",
    timestamp: new Date(),
    source: {
      kind: "user-answered-planner-form",
      featureId: FEATURE_ID,
      plannerMessageId: pmId,
    },
  };
}

function statusFor(messages: CanvasChatMessage[]) {
  const runs = getSubAgentRunsFromMessages(messages);
  expect(runs).toHaveLength(1);
  return deriveCardStatus(runs[0]);
}

describe("deriveCardStatus — outbound latest", () => {
  test("single delivered send → waiting for reply", () => {
    expect(statusFor([outbound("m1", "proceed?")])).toEqual({
      label: "Sent · waiting for reply",
      tone: "sent",
    });
  });

  test("failed send → failed", () => {
    const msg = outbound("m1", "proceed?");
    msg.toolCalls![0].status = "output-error";
    msg.toolCalls![0].output = { error: "Feature not found" };
    expect(statusFor([msg])).toEqual({ label: "Failed", tone: "failed" });
  });

  test("multiple sends with no reply → count + waiting", () => {
    const status = statusFor([
      outbound("m1", "first"),
      outbound("m2", "second"),
    ]);
    expect(status.tone).toBe("sent");
    expect(status.label).toContain("2 messages sent");
  });
});

describe("deriveCardStatus — inbound latest", () => {
  test("FORM artifact wins over everything → Waiting for you", () => {
    const status = statusFor([
      outbound("m1", "proceed?"),
      inbound("p1", "Which provider?", {
        workflowStatus: "COMPLETED",
        hasForm: true,
      }),
    ]);
    expect(status).toEqual({ label: "Waiting for you", tone: "waiting" });
  });

  test("IN_PROGRESS → Running", () => {
    expect(
      statusFor([inbound("p1", "working on it", { workflowStatus: "IN_PROGRESS" })]),
    ).toEqual({ label: "Running", tone: "running" });
  });

  test("COMPLETED → Plan ready", () => {
    expect(
      statusFor([inbound("p1", "done", { workflowStatus: "COMPLETED" })]),
    ).toEqual({ label: "Plan ready", tone: "replied" });
  });

  test("FAILED / ERROR / HALTED → Needs attention", () => {
    for (const ws of ["FAILED", "ERROR", "HALTED"]) {
      expect(
        statusFor([inbound("p1", "broke", { workflowStatus: ws })]),
      ).toEqual({ label: "Needs attention", tone: "failed" });
    }
  });

  test("no signal (legacy inbound row) → Replied", () => {
    expect(statusFor([inbound("p1", "hi")])).toEqual({
      label: "Replied",
      tone: "replied",
    });
  });
});

describe("getSubAgentRunsFromMessages — Phase 4 pending FORM", () => {
  test("inbound FORM with questions → pendingForm set + Waiting for you", () => {
    const messages = [
      inbound("p1", "Which provider?", { hasForm: true, formQuestions: QUESTIONS }),
    ];
    const runs = runsFromMessages(messages);
    expect(runs).toHaveLength(1);
    expect(runs[0].pendingForm).toEqual({
      plannerMessageId: "p1",
      questions: QUESTIONS,
    });
    expect(deriveCardStatus(runs[0])).toEqual({
      label: "Waiting for you",
      tone: "waiting",
    });
  });

  test("answered FORM → pendingForm cleared + answer entry rendered", () => {
    const messages = [
      inbound("p1", "Which provider?", { hasForm: true, formQuestions: QUESTIONS }),
      answered("a1", "p1"),
    ];
    const runs = runsFromMessages(messages);
    expect(runs[0].pendingForm).toBeUndefined();
    // The answer shows as an outbound form-answer entry in the thread.
    const last = runs[0].messages[runs[0].messages.length - 1];
    expect(last.formAnswer).toBe(true);
    expect(last.direction).toBe("out");
    // Pill no longer says "Waiting for you".
    expect(deriveCardStatus(runs[0]).label).toBe("Answered · waiting for planner");
  });

  test("inbound without formQuestions → no pendingForm", () => {
    const runs = runsFromMessages([
      inbound("p1", "just a status", { workflowStatus: "IN_PROGRESS" }),
    ]);
    expect(runs[0].pendingForm).toBeUndefined();
  });
});

describe("getSubAgentRunsFromMessages — Start Tasks gating", () => {
  test("inbound TASKS artifact → hasGeneratedTasks true (sticky)", () => {
    const runs = runsFromMessages([
      inbound("p1", "Here are the tasks", {
        workflowStatus: "COMPLETED",
        hasTasks: true,
      }),
      inbound("p2", "follow-up status"),
    ]);
    expect(runs[0].hasGeneratedTasks).toBe(true);
  });

  test("no TASKS artifact → hasGeneratedTasks false", () => {
    const runs = runsFromMessages([
      inbound("p1", "architecture done", { workflowStatus: "COMPLETED" }),
    ]);
    expect(runs[0].hasGeneratedTasks).toBe(false);
  });
});

describe("isDisplayableMessage — thread filter", () => {
  function makeMessage(overrides: Partial<RunMessage>): RunMessage {
    return {
      messageId: "m1",
      messageIndex: 0,
      direction: "in",
      text: "",
      status: "sent",
      ...overrides,
    };
  }

  test("outbound entry always passes filter", () => {
    expect(isDisplayableMessage(makeMessage({ direction: "out", text: "" }))).toBe(true);
  });

  test("inbound with prose text passes filter", () => {
    expect(isDisplayableMessage(makeMessage({ direction: "in", text: "Here is an update" }))).toBe(true);
  });

  test("inbound with hasForm passes filter", () => {
    expect(isDisplayableMessage(makeMessage({ direction: "in", text: "", hasForm: true }))).toBe(true);
  });

  test("inbound with hasTasks passes filter", () => {
    expect(isDisplayableMessage(makeMessage({ direction: "in", text: "", hasTasks: true }))).toBe(true);
  });

  test("inbound with workflowStatus COMPLETED passes filter", () => {
    expect(isDisplayableMessage(makeMessage({ direction: "in", text: "", workflowStatus: "COMPLETED" }))).toBe(true);
  });

  test("inbound with no text, no form, no tasks, non-COMPLETED status is excluded", () => {
    expect(isDisplayableMessage(makeMessage({
      direction: "in",
      text: "",
      hasForm: false,
      hasTasks: false,
      workflowStatus: "IN_PROGRESS",
    }))).toBe(false);
  });

  test("inbound with no text, no form, no tasks, and undefined workflowStatus is excluded", () => {
    expect(isDisplayableMessage(makeMessage({
      direction: "in",
      text: "",
    }))).toBe(false);
  });

  test("inbound with whitespace-only text is excluded", () => {
    expect(isDisplayableMessage(makeMessage({
      direction: "in",
      text: "   ",
      workflowStatus: "IN_PROGRESS",
    }))).toBe(false);
  });

  test("thread filters out noisy fallback entries from run.messages", () => {
    const runs = runsFromMessages([
      outbound("m1", "Please generate the plan"),
      inbound("p1", "", { workflowStatus: "IN_PROGRESS" }), // noisy — no text, not COMPLETED
      inbound("p2", "", { workflowStatus: "COMPLETED" }),   // kept — COMPLETED
    ]);
    const displayMessages = runs[0].messages.filter(isDisplayableMessage);
    // outbound + COMPLETED inbound kept; IN_PROGRESS empty inbound dropped
    expect(displayMessages).toHaveLength(2);
    expect(displayMessages[0].direction).toBe("out");
    expect(displayMessages[1].workflowStatus).toBe("COMPLETED");
  });
});
