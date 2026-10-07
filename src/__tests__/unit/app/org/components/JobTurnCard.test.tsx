// @vitest-environment jsdom
/**
 * Unit tests for `JobTurnCard` — a job turn's row shown collapsed — and its
 * pure helpers (`jobTurnLook`, `jobTurnBody`).
 */

import React from "react";
import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  JobTurnCard,
  jobTurnBody,
  jobTurnLook,
  type JobTurnSource,
} from "@/app/org/[githubLogin]/_components/JobTurnCard";

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
