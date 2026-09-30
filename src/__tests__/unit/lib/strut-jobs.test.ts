/**
 * `lib/strut-jobs.ts` — what hive and the `job` strut workflow agree on:
 * the two link shapes the reader serves, the reader URL, the title on a
 * turn's input.
 */
import { describe, it, expect } from "vitest";
import { jobTitleOf, parseStrutArtifactKey, strutArtifactReaderUrl } from "@/lib/strut-jobs";

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
