/** `jobIdOfArtifact` — the job an artifact's ref rides on, read off the Job row (strut plans/job-artifact-events.md §5). */
import { describe, test, expect } from "vitest";
import { jobIdOfArtifact, type ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

const pr: ArtifactRef = { id: "pr", kind: "pull_request", title: "PR", source: { type: "inline", content: { url: "https://github.com/acme/app/pull/12", repo: "acme/app", number: 12, state: "open" } } };
const plan: ArtifactRef = { id: "plan", kind: "markdown", title: "Plan", source: { type: "inline", content: { text: "# Plan" } } };
const other: ArtifactRef = { ...pr };

describe("jobIdOfArtifact", () => {
  test("the Job row's job, by the ref object itself; nothing for a ref on any other row, or an equal-looking ref", () => {
    const messages = [
      { source: { kind: "strut", jobId: "not-a-job" }, artifacts: [plan] },
      { source: { kind: "job", jobId: "6f1c" }, artifacts: [pr] },
      { artifacts: [other] },
    ];
    expect(jobIdOfArtifact(messages, pr)).toBe("6f1c");
    expect(jobIdOfArtifact(messages, plan)).toBeUndefined();
    expect(jobIdOfArtifact(messages, other)).toBeUndefined();
    expect(jobIdOfArtifact(undefined, pr)).toBeUndefined();
  });
});
