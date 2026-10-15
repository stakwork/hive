/**
 * The artifact panel's index: what waits on the reader first, then one
 * section per job under its title, then what Jamie made itself — each
 * newest first, sections ordered by their newest artifact.
 */
import { describe, expect, test } from "vitest";
import { groupIndex } from "@/app/org/[githubLogin]/_components/artifacts/ArtifactPanel";
import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

const inline = (content: Record<string, unknown>) => ({ type: "inline" as const, content });
const doc = (id: string): ArtifactRef => ({ id, kind: "markdown", title: id, source: inline({ text: "#" }) });
const pr = (id: string, state: string, number: number): ArtifactRef => ({
  id,
  kind: "pull_request",
  title: id,
  source: inline({ url: `https://github.com/a/b/pull/${number}`, repo: "a/b", number, state }),
});

describe("groupIndex", () => {
  test("waiting first, then by job, then Jamie's own", () => {
    const openPr = pr("open-pr", "open", 1);
    const mergedPr = pr("merged-pr", "merged", 2);
    const jobs = new Map([
      ["pull_request:a/b#1", { jobId: "j1", title: "Backfill" }],
      ["pull_request:a/b#2", { jobId: "j1", title: "Backfill" }],
      ["id:log", { jobId: "j2", title: "Migration" }],
    ]);
    const groups = groupIndex([doc("log"), mergedPr, openPr, doc("research")], jobs);
    expect(groups.map((g) => [g.label, g.artifacts.map((a) => a.id)])).toEqual([
      ["Waiting on you", ["open-pr"]],
      ["Migration", ["log"]],
      ["Backfill", ["merged-pr"]],
      ["From Jamie", ["research"]],
    ]);
  });

  test("no empty sections", () => {
    expect(groupIndex([doc("a")], new Map()).map((g) => g.label)).toEqual(["From Jamie"]);
  });
});
