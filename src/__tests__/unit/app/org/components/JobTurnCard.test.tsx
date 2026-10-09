// @vitest-environment jsdom
/**
 * Unit tests for `JobTurnCard` — a job turn's row shown collapsed — its
 * pure helpers (`jobTurnLook`, `jobTurnBody`), and the pending side: the
 * `getPendingJobTurnsFromMessages` projection and `PendingJobTurnCard`.
 */

import React from "react";
import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  JobEventRow,
  JobTurnCard,
  PendingJobTurnCard,
  getPendingJobTurnsFromMessages,
  jobTurnBody,
  jobTurnLook,
  type JobEventSource,
  type JobTurnSource,
} from "@/app/org/[githubLogin]/_components/JobTurnCard";
import type { CanvasChatMessage } from "@/app/org/[githubLogin]/_state/canvasChatStore";

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";

function source(over: Partial<JobTurnSource> = {}): JobTurnSource {
  return {
    kind: "job",
    jobId: JOB,
    strutRunId: "1790000000000",
    workflow: "job",
    status: "success",
    title: "Dark mode plan",
    ...over,
  };
}

const content = (body: string) => `**Job · ${JOB} · Dark mode plan**\n\n${body}`;

describe("jobTurnBody", () => {
  test("drops the header line the model reads the job id from, keeps the rest", () => {
    expect(jobTurnBody(content("Wrote the plan.\n\n- src/a.ts"))).toBe("Wrote the plan.\n\n- src/a.ts");
    expect(jobTurnBody("Plain text, no header.")).toBe("Plain text, no header.");
    expect(jobTurnBody(`**Job · ${JOB} · Only a header**`)).toBe("");
  });
});

describe("jobTurnLook", () => {
  test("how the turn ended", () => {
    expect(jobTurnLook({ status: "success" }).label).toBe("Done");
    expect(jobTurnLook({ status: "success", ask: "Which repo?" }).label).toBe("Needs an answer");
    expect(jobTurnLook({ status: "error" }).label).toBe("Failed");
    expect(jobTurnLook({ status: "cancelled" }).label).toBe("Stopped");
    expect(jobTurnLook({ status: "lost" }).label).toBe("Lost");
    expect(jobTurnLook({ status: "whatever" }).label).toBe("Ended");
  });
});

describe("JobTurnCard", () => {
  test("a successful turn is collapsed to its title and status; a click opens the reply without the header line", () => {
    render(<JobTurnCard message={{ content: content("Wrote the plan.\n\n- src/a.ts: 12 lines") }} source={source()} />);

    const card = screen.getByTestId("job-turn-card");
    expect(card).toHaveAttribute("data-job-id", JOB);
    expect(card).toHaveAttribute("data-expanded", "false");
    expect(screen.getByText("Dark mode plan")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByTestId("job-turn-body")).toBeNull();

    const toggle = screen.getByTestId("job-turn-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(card).toHaveAttribute("data-expanded", "true");
    expect(screen.getByTestId("markdown").textContent).toBe("Wrote the plan.\n\n- src/a.ts: 12 lines");

    fireEvent.click(toggle);
    expect(screen.queryByTestId("job-turn-body")).toBeNull();
  });

  test("the job's question stays visible while collapsed, and is the body's once opened", () => {
    render(
      <JobTurnCard
        message={{ content: content("Two candidates.\n\n**Question for you:** Which repo?") }}
        source={source({ ask: "Which repo?" })}
      />,
    );
    expect(screen.getByText("Needs an answer")).toBeInTheDocument();
    expect(screen.getByTestId("job-turn-ask").textContent).toBe("Question for you: Which repo?");

    fireEvent.click(screen.getByTestId("job-turn-toggle"));
    expect(screen.queryByTestId("job-turn-ask")).toBeNull();
    expect(screen.getByTestId("markdown").textContent).toContain("**Question for you:** Which repo?");
  });

  test("a failed turn shows its one-line reason, with nothing to open", () => {
    render(
      <JobTurnCard
        message={{ content: content("The turn did not complete: clone failed") }}
        source={source({ status: "error" })}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByTestId("job-turn-toggle")).toBeNull();
    expect(screen.getByTestId("job-turn-card")).toHaveAttribute("data-expanded", "true");
    expect(screen.getByTestId("markdown").textContent).toBe("The turn did not complete: clone failed");
  });

  test("a title-less row still has a name", () => {
    render(<JobTurnCard message={{ content: "" }} source={source({ title: undefined })} />);
    expect(screen.getByText("Job")).toBeInTheDocument();
    expect(screen.queryByTestId("job-turn-toggle")).toBeNull();
  });
});

// ── Pending turns ────────────────────────────────────────────────────────────

const JOB_2 = "7a2d1e4f-2222-4333-8444-555566667777";

type LaunchTool = "start_job" | "continue_job";

/** An assistant message whose tool call launched a job turn. */
function launch(
  id: string,
  over: {
    tool?: LaunchTool;
    jobId?: string;
    /** `null`: the call never got an output (interrupted). */
    output?: Record<string, unknown> | null;
    errorText?: string;
    input?: Record<string, unknown>;
  } = {},
): CanvasChatMessage {
  const tool = over.tool ?? "start_job";
  const jobId = over.jobId ?? JOB;
  const input =
    over.input ??
    (tool === "start_job"
      ? { workspace: "acme", title: "Dark mode plan", prompt: "Plan it" }
      : { workspace: "acme", jobId, prompt: "Revise it" });
  const output =
    over.output === undefined
      ? { status: tool === "start_job" ? "started" : "continued", jobId, title: "Dark mode plan", note: "Underway." }
      : over.output;
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: new Date(),
    toolCalls: [
      {
        id: `tc-${id}`,
        toolName: tool,
        input,
        status: over.errorText ? "output-error" : output === null ? "interrupted" : "output-available",
        ...(output === null ? {} : { output }),
        ...(over.errorText ? { errorText: over.errorText } : {}),
      },
    ],
  };
}

/** The job row a settled turn appends. */
function row(id: string, over: Partial<JobTurnSource> = {}): CanvasChatMessage {
  return { id, role: "assistant", content: content("Wrote the plan."), timestamp: new Date(), source: source(over) };
}

const EVENT_LINE = "[artifact-event] pull_request https://github.com/acme/app/pull/12 merged";

/** The origin row of a turn hive started for an event (`source.kind: "job_event"`). */
function eventRow(id: string, over: Partial<JobEventSource> & { content?: string } = {}): CanvasChatMessage {
  const { content: text, ...src } = over;
  return {
    id,
    role: "assistant",
    content: text ?? EVENT_LINE,
    timestamp: new Date(),
    source: { kind: "job_event", jobId: JOB, title: "Dark mode plan", runId: "row-2", ...src },
  };
}

describe("getPendingJobTurnsFromMessages", () => {
  test("a launch strut accepted is a pending turn, anchored on the launching message", () => {
    expect(getPendingJobTurnsFromMessages([launch("m1")])).toEqual([
      { jobId: JOB, title: "Dark mode plan", anchorMessageId: "m1" },
    ]);
  });

  test("the job's row settles it, whatever the row says", () => {
    expect(getPendingJobTurnsFromMessages([launch("m1"), row("job-1")])).toEqual([]);
    expect(getPendingJobTurnsFromMessages([launch("m1"), row("job-1", { status: "error" })])).toEqual([]);
    expect(getPendingJobTurnsFromMessages([launch("m1"), row("job-1", { status: "cancelled" })])).toEqual([]);
  });

  test("a continue_job after the row is the next pending turn, titled from its output or the job's earlier row", () => {
    expect(
      getPendingJobTurnsFromMessages([launch("m1"), row("job-1"), launch("m2", { tool: "continue_job" })]),
    ).toEqual([{ jobId: JOB, title: "Dark mode plan", anchorMessageId: "m2" }]);

    // The output carries no title: the row's stands in.
    expect(
      getPendingJobTurnsFromMessages([
        launch("m1"),
        row("job-1"),
        launch("m2", { tool: "continue_job", output: { status: "continued", jobId: JOB } }),
      ]),
    ).toEqual([{ jobId: JOB, title: "Dark mode plan", anchorMessageId: "m2" }]);

    // Nothing carries a title: the card falls back to its own name.
    expect(
      getPendingJobTurnsFromMessages([
        launch("m1", { tool: "continue_job", output: { status: "continued", jobId: JOB } }),
      ]),
    ).toEqual([{ jobId: JOB, title: "", anchorMessageId: "m1" }]);
  });

  test("a refused launch, a failed call, an unfinished call, or one with no job id draws nothing", () => {
    expect(getPendingJobTurnsFromMessages([launch("m1", { output: { status: "busy", jobId: JOB } })])).toEqual([]);
    expect(getPendingJobTurnsFromMessages([launch("m1", { output: { status: "error", error: "no strut" } })])).toEqual(
      [],
    );
    expect(getPendingJobTurnsFromMessages([launch("m1", { errorText: "boom" })])).toEqual([]);
    expect(getPendingJobTurnsFromMessages([launch("m1", { output: null })])).toEqual([]);
    expect(getPendingJobTurnsFromMessages([launch("m1", { output: { status: "started" } })])).toEqual([]);
  });

  test("jobs are independent, and a row with no launch settles nothing", () => {
    const messages = [
      row("job-0"),
      launch("m1"),
      launch("m2", { jobId: JOB_2, output: { status: "started", jobId: JOB_2, title: "Landing page" } }),
      row("job-1"),
    ];
    expect(getPendingJobTurnsFromMessages(messages)).toEqual([
      { jobId: JOB_2, title: "Landing page", anchorMessageId: "m2" },
    ]);
  });

  test("other tool calls and plain messages are ignored", () => {
    const other: CanvasChatMessage = {
      id: "m0",
      role: "assistant",
      content: "Underway.",
      timestamp: new Date(),
      toolCalls: [
        {
          id: "tc-0",
          toolName: "dispatch_strut",
          status: "output-available",
          output: { status: "dispatched", chatId: "c1" },
        },
      ],
    };
    const user: CanvasChatMessage = { id: "u1", role: "user", content: "Plan dark mode", timestamp: new Date() };
    expect(getPendingJobTurnsFromMessages([user, other])).toEqual([]);
  });
});

describe("PendingJobTurnCard", () => {
  test("the title and a running pill, nothing to open", () => {
    render(<PendingJobTurnCard turn={{ jobId: JOB, title: "Dark mode plan", anchorMessageId: "m1" }} />);
    const card = screen.getByTestId("job-turn-pending-card");
    expect(card).toHaveAttribute("data-job-id", JOB);
    expect(screen.getByText("Dark mode plan")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.queryByTestId("job-turn-toggle")).toBeNull();
    expect(screen.queryByTestId("job-turn-body")).toBeNull();
    expect(screen.queryByTestId("job-turn-card")).toBeNull();
  });

  test("a title-less turn still has a name", () => {
    render(<PendingJobTurnCard turn={{ jobId: JOB, title: "", anchorMessageId: "m1" }} />);
    expect(screen.getByText("Job")).toBeInTheDocument();
  });
});

describe("getPendingJobTurnsFromMessages — turns an event started", () => {
  test("an event row is a launch anchored on itself, settled by the job row that follows", () => {
    expect(getPendingJobTurnsFromMessages([launch("m1"), row("job-1"), eventRow("e1")])).toEqual([
      { jobId: JOB, title: "Dark mode plan", anchorMessageId: "e1" },
    ]);
    expect(getPendingJobTurnsFromMessages([launch("m1"), row("job-1"), eventRow("e1"), row("job-2")])).toEqual([]);
  });

  test("a job row that landed before its origin was written settles it too — the row is named", () => {
    // The job row's id is `job-<StrutRun.id>`; the event row names that run.
    expect(getPendingJobTurnsFromMessages([row("job-row-2"), eventRow("e1", { runId: "row-2" })])).toEqual([]);
    expect(getPendingJobTurnsFromMessages([row("job-row-9"), eventRow("e1", { runId: "row-2" })])).toEqual([
      { jobId: JOB, title: "Dark mode plan", anchorMessageId: "e1" },
    ]);
  });

  test("a title-less event row takes the job's last title", () => {
    expect(getPendingJobTurnsFromMessages([launch("m1"), row("job-1"), eventRow("e1", { title: undefined })])).toEqual([
      { jobId: JOB, title: "Dark mode plan", anchorMessageId: "e1" },
    ]);
  });
});

describe("JobEventRow", () => {
  test("the job's title and the event, linked to the artifact", () => {
    const m = eventRow("e1");
    render(<JobEventRow message={m} source={m.source as JobEventSource} />);
    const rowEl = screen.getByTestId("job-event-row");
    expect(rowEl).toHaveAttribute("data-job-id", JOB);
    expect(rowEl.textContent).toBe("Dark mode plan · pull request acme/app#12 merged");
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://github.com/acme/app/pull/12");
  });

  test("a message that is not an event line shows its first line, unlinked; a title-less row still has a name", () => {
    const m = eventRow("e1", { content: "something else\nmore", title: undefined });
    render(<JobEventRow message={m} source={m.source as JobEventSource} />);
    expect(screen.getByTestId("job-event-row").textContent).toBe("Job · something else");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
