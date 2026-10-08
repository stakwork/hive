/**
 * `lib/strut-jobs.ts` — what hive and the `job` strut workflow agree on:
 * the two link shapes the reader serves, the reader URL, the title on a
 * turn's input.
 */
import { describe, it, expect } from "vitest";
import {
  checksFailedEvent,
  checksRunning,
  describeArtifactEvent,
  formatArtifactEvent,
  jobTitleOf,
  parseArtifactEvent,
  parseGithubPullRequestUrl,
  parseStrutArtifactKey,
  strutArtifactReaderUrl,
} from "@/lib/strut-jobs";

describe("parseStrutArtifactKey", () => {
  it("names the job or the run a strut link belongs to", () => {
    expect(parseStrutArtifactKey("/jobs/6f1c/files/plan.md")).toEqual({ job: "6f1c", path: "plan.md" });
    expect(parseStrutArtifactKey("/jobs/a.b_c-d/files/notes/topic.md")).toEqual({ job: "a.b_c-d", path: "notes/topic.md" });
    expect(parseStrutArtifactKey("/artifacts/1790000000000/shots/turn-7.png")).toEqual({ runId: "1790000000000", path: "shots/turn-7.png" });
  });

  it("refuses anything else on the swarm", () => {
    for (const key of [
      "/secrets",
      "/workflows/job/runs/1/events",
      "/jobs/6f1c/plan.md",
      "/jobs/6f1c/files",
      "/jobs/6f1c/files/",
      "/jobs//files/plan.md",
      "/jobs/6f1c/files/../../secrets.json",
      "/artifacts/1/../2/x",
      "/artifacts/1/./x",
      "/jobs/6f1c/files/plan.md?key=1",
      "/jobs/6f1c/files/plan.md#x",
      "/jobs/6f1c/files/a\\b",
      "jobs/6f1c/files/plan.md",
      "https://swarm.test/lab/jobs/6f1c/files/plan.md",
      "",
      42,
      null,
      `/jobs/6f1c/files/${"x".repeat(1100)}`,
    ]) {
      expect(parseStrutArtifactKey(key), String(key)).toBeNull();
    }
  });
});

describe("strutArtifactReaderUrl", () => {
  it("is on hive's own origin, with the org, the swarm and the key", () => {
    expect(strutArtifactReaderUrl("acme org", "swarm-1", "/jobs/6f1c/files/plan.md")).toBe(
      "/api/orgs/acme%20org/strut/artifacts?swarmId=swarm-1&key=%2Fjobs%2F6f1c%2Ffiles%2Fplan.md",
    );
  });
});

describe("jobTitleOf", () => {
  it("reads the title off a turn's input, else Job", () => {
    expect(jobTitleOf({ input: { prompt: "p", title: "Dark mode plan" } })).toBe("Dark mode plan");
    expect(jobTitleOf({ input: { prompt: "p", title: "  " } })).toBe("Job");
    expect(jobTitleOf({ input: { prompt: "p" } })).toBe("Job");
    expect(jobTitleOf({ input: null })).toBe("Job");
  });
});

describe("artifact events — the one line every source emits and every reader parses", () => {
  const merged = { kind: "pull_request", url: "https://github.com/acme/app/pull/12", what: "merged" };

  it("formats the line, the details below, one per line", () => {
    expect(formatArtifactEvent(merged)).toBe("[artifact-event] pull_request https://github.com/acme/app/pull/12 merged");
    expect(
      formatArtifactEvent({ ...merged, what: " checks  failed " }, ["head: a1b2c3d", "- lint — https://github.com/acme/app/actions/runs/1", " "]),
    ).toBe(
      "[artifact-event] pull_request https://github.com/acme/app/pull/12 checks failed\nhead: a1b2c3d\n- lint — https://github.com/acme/app/actions/runs/1",
    );
  });

  it("parses the first line and nothing else; a person's prompt is null", () => {
    expect(parseArtifactEvent(formatArtifactEvent(merged, ["head: abc"]))).toEqual(merged);
    expect(parseArtifactEvent("[artifact-event] page https://docs.test/x comment added by bo")).toEqual({
      kind: "page",
      url: "https://docs.test/x",
      what: "comment added by bo",
    });
    for (const text of ["Write a plan", "[artifact-event] pull_request", "", null, 3, "x\n[artifact-event] a b c"]) {
      expect(parseArtifactEvent(text), String(text)).toBeNull();
    }
  });

  it("describes a pull request by repository and number, anything else by its words", () => {
    expect(describeArtifactEvent(merged)).toBe("pull request acme/app#12 merged");
    expect(describeArtifactEvent({ kind: "deploy_preview", url: "https://p.test/x", what: "failed" })).toBe("deploy preview https://p.test/x failed");
  });
});

describe("parseGithubPullRequestUrl", () => {
  it("names the owner, the repository and the number of a pull request on github.com; anything else is null", () => {
    expect(parseGithubPullRequestUrl("https://github.com/acme/app/pull/12")).toEqual({ owner: "acme", name: "app", number: 12 });
    expect(parseGithubPullRequestUrl("https://github.com/Acme/App/pull/12/files")).toEqual({ owner: "Acme", name: "App", number: 12 });
    for (const url of ["https://github.com/acme/app", "https://github.com/acme/app/issues/12", "https://gitlab.com/acme/app/-/merge_requests/1", "/pull/12", ""]) {
      expect(parseGithubPullRequestUrl(url), url).toBeNull();
    }
  });
});

describe("checks failed — the event the card's Fix and the automatic first fix both send", () => {
  const checks = [
    { name: "build", status: "success" as const },
    { name: "lint", status: "failure" as const, url: "https://github.com/acme/app/actions/runs/1" },
    { name: "e2e", status: "failure" as const },
  ];

  it("the checks are running until none is pending", () => {
    expect(checksRunning(checks)).toBe(false);
    expect(checksRunning([...checks, { name: "deploy", status: "pending" }])).toBe(true);
    expect(checksRunning([])).toBe(false);
    expect(checksRunning(undefined)).toBe(false);
  });

  it("the head commit and each failing check with its link; null while nothing has failed", () => {
    expect(checksFailedEvent({ url: "https://github.com/acme/app/pull/12", headSha: "a1b2c3d", checks })).toEqual({
      url: "https://github.com/acme/app/pull/12",
      what: "checks failed",
      details: ["head: a1b2c3d", "- lint — https://github.com/acme/app/actions/runs/1", "- e2e"],
    });
    expect(checksFailedEvent({ url: "https://github.com/acme/app/pull/12", checks })?.details).toEqual(["- lint — https://github.com/acme/app/actions/runs/1", "- e2e"]);
    expect(checksFailedEvent({ url: "https://github.com/acme/app/pull/12", checks: [checks[0], { name: "x", status: "pending" }] })).toBeNull();
    expect(checksFailedEvent({ url: "https://github.com/acme/app/pull/12" })).toBeNull();
  });
});
