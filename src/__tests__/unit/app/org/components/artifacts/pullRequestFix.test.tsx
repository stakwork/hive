/**
 * The pull-request panel's Fix (strut plans/job-artifact-events.md §5):
 * shown only on a job's pull request with a failing check that is still
 * open; a click sends the event — the head commit and the failing checks,
 * each with its link — to the job's events route and says so; a job
 * mid-turn says to try again. `fixEventOf` is the pure half.
 */

import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PullRequestPanel, fixEventOf } from "@/app/org/[githubLogin]/_components/artifacts/viewers/pullRequest";
import type { ArtifactContents, ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({ useChatOrgLogin: () => "acme-org" }));

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const artifact: ArtifactRef = { id: "pr", kind: "pull_request", title: "Dark mode", source: { type: "inline", content: {} } };

function content(over: Partial<ArtifactContents["pull_request"]> = {}): ArtifactContents["pull_request"] {
  return {
    url: "https://github.com/acme/app/pull/12",
    repo: "acme/app",
    number: 12,
    state: "open",
    headSha: "a1b2c3d",
    checks: [
      { name: "build", status: "success" },
      { name: "lint", status: "failure", url: "https://github.com/acme/app/actions/runs/1" },
      { name: "e2e", status: "failure" },
    ],
    ...over,
  };
}

const mockFetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fixEventOf", () => {
  test("the head commit and the failing checks, each with its link; null while nothing failed", () => {
    expect(fixEventOf(content())).toEqual({
      url: "https://github.com/acme/app/pull/12",
      what: "checks failed",
      details: ["head: a1b2c3d", "- lint — https://github.com/acme/app/actions/runs/1", "- e2e"],
    });
    expect(fixEventOf(content({ headSha: undefined }))?.details).toEqual(["- lint — https://github.com/acme/app/actions/runs/1", "- e2e"]);
    expect(fixEventOf(content({ checks: [{ name: "build", status: "success" }, { name: "x", status: "pending" }] }))).toBeNull();
    expect(fixEventOf(content({ checks: undefined }))).toBeNull();
  });
});

describe("PullRequestPanel — Fix", () => {
  test("only on a job's pull request with a failing check, while it is open", () => {
    const { rerender } = render(<PullRequestPanel artifact={artifact} content={content()} jobId={JOB} />);
    expect(screen.getByTestId("pr-fix")).toHaveTextContent("Fix");
    // A check's own page is linked.
    expect(screen.getByRole("link", { name: "lint" })).toHaveAttribute("href", "https://github.com/acme/app/actions/runs/1");

    rerender(<PullRequestPanel artifact={artifact} content={content()} />);
    expect(screen.queryByTestId("pr-fix")).toBeNull();
    rerender(<PullRequestPanel artifact={artifact} content={content({ state: "merged" })} jobId={JOB} />);
    expect(screen.queryByTestId("pr-fix")).toBeNull();
    rerender(<PullRequestPanel artifact={artifact} content={content({ checks: [{ name: "build", status: "success" }] })} jobId={JOB} />);
    expect(screen.queryByTestId("pr-fix")).toBeNull();
  });

  test("a click posts the event to the job's events route and says it was sent", async () => {
    mockFetch.mockResolvedValue(json(202, { runId: "row-2" }));
    render(<PullRequestPanel artifact={artifact} content={content()} jobId={JOB} />);
    fireEvent.click(screen.getByTestId("pr-fix"));
    await waitFor(() => expect(screen.getByTestId("pr-fix-sent")).toHaveTextContent("Sent to the job"));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`/api/orgs/acme-org/strut/jobs/${JOB}/events`);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(init.body)).toEqual({
      url: "https://github.com/acme/app/pull/12",
      what: "checks failed",
      details: ["head: a1b2c3d", "- lint — https://github.com/acme/app/actions/runs/1", "- e2e"],
    });
  });

  test("a job mid-turn says to try again; a refusal says why; both keep the button", async () => {
    mockFetch.mockResolvedValueOnce(json(409, { error: "busy", busy: true }));
    render(<PullRequestPanel artifact={artifact} content={content()} jobId={JOB} />);
    fireEvent.click(screen.getByTestId("pr-fix"));
    await waitFor(() => expect(screen.getByText(/try again in a minute/)).toBeInTheDocument());
    expect(screen.getByTestId("pr-fix")).toHaveTextContent("Fix");

    mockFetch.mockResolvedValueOnce(json(403, { error: "Only the person who started a job can continue it" }));
    fireEvent.click(screen.getByTestId("pr-fix"));
    await waitFor(() => expect(screen.getByText(/Could not send: Only the person/)).toBeInTheDocument());
    expect(screen.getByTestId("pr-fix")).toHaveTextContent("Fix");
  });
});
