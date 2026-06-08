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
} from "@/app/org/[githubLogin]/_components/SubAgentRunCard";
import type { CanvasChatMessage } from "@/app/org/[githubLogin]/_state/canvasChatStore";
import { SEND_TO_FEATURE_PLANNER_TOOL } from "@/lib/proposals/types";

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
  extra: { workflowStatus?: string; hasForm?: boolean } = {},
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
