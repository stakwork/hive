import { describe, expect, it, vi } from "vitest";

// job-turn's server neighbours: only its mapping is used here.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/pusher", () => ({ notifyCanvasConversationUpdated: vi.fn(), notifyCanvasCardJob: vi.fn() }));
vi.mock("@/services/canvas-strut-autoturn", () => ({ invokeCanvasAgentOnJobTurn: vi.fn() }));
vi.mock("@/services/strut-orchestrator-wake", () => ({ invokeOrchestratorOnJobTurn: vi.fn() }));
vi.mock("@/services/strut-runs", () => ({ labForRow: vi.fn() }));

import { mockCanvasJobs } from "@/app/api/mock/graph/canvas-jobs";
import { MOCK_STRUT_SWARM_ID } from "@/app/api/mock/graph/strut-artifacts";
import { mapStrutArtifacts } from "@/services/strut-runs/job-turn";
import { mockInitiativeTree } from "@/app/api/mock/graph/initiative-fixture";
import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { toBoard } from "@/app/org/[githubLogin]/_components/infinite-canvas/board";
import { featureWork, prsOf, reposOf, workOf } from "@/app/org/[githubLogin]/_components/infinite-canvas/build";
import type { CanvasJob } from "@/lib/canvas/canvas-jobs";
import { initiativeStage } from "@/services/graph/workbench";

const job = (state: CanvasJob["state"], extra: Partial<CanvasJob> = {}): CanvasJob => ({
  jobId: `j-${state}`,
  title: "Implement it",
  state,
  startedBy: null,
  refId: "f",
  initiativeRefId: "i",
  updatedAt: 1,
  ...extra,
});
const pr = (number: number, state: string, failing: string[] = []): ArtifactRef => ({
  id: `pr-${number}`,
  kind: "pull_request",
  title: `PR ${number}`,
  source: {
    type: "inline",
    content: {
      url: `https://github.com/o/r/pull/${number}`,
      repo: "o/r",
      number,
      state,
      checks: failing.map((name) => ({ name, status: "failure" })),
    },
  },
});

describe("prsOf", () => {
  it("keeps the pull requests, with their state and failing checks", () => {
    const md: ArtifactRef = {
      id: "m",
      kind: "markdown",
      title: "Plan",
      source: { type: "inline", content: { text: "x" } },
    };
    expect(prsOf([md, pr(1, "open", ["unit"]), pr(2, "merged", ["unit"])]).map((p) => [p.state, p.failing])).toEqual([
      ["open", ["unit"]],
      // A merged PR's old red run doesn't block anything.
      ["merged", []],
    ]);
  });

  it("counts a pull request read from the graph, state unknown", () => {
    const g: ArtifactRef = {
      id: "g",
      kind: "pull_request",
      title: "PR",
      source: { type: "graph", swarmId: "s", key: "k" },
    };
    expect(prsOf([g])).toEqual([{ artifact: g, failing: [] }]);
  });
});

const prIn = (repo: unknown, n = 1): ArtifactRef => ({
  ...pr(n, "open"),
  source: { type: "inline", content: { url: `https://github.com/x/y/pull/${n}`, repo, number: n, state: "open" } },
});

describe("reposOf", () => {
  it("is empty with no pull requests", () => {
    expect(reposOf([])).toEqual([]);
  });

  it("lists one repo", () => {
    expect(reposOf(prsOf([pr(1, "merged")]))).toEqual(["o/r"]);
  });

  it("keeps several repos in first-seen order, closed ones too", () => {
    expect(reposOf(prsOf([prIn("a/one"), pr(2, "closed"), prIn("b/two", 3)]))).toEqual(["a/one", "o/r", "b/two"]);
  });

  it("dedupes case-insensitively, keeping the first casing", () => {
    expect(reposOf(prsOf([prIn("Acme/Web"), prIn("acme/web", 2), prIn("ACME/WEB", 3)]))).toEqual(["Acme/Web"]);
  });

  it("skips pull requests that can't be read or have no repo", () => {
    const graph: ArtifactRef = {
      id: "g",
      kind: "pull_request",
      title: "PR",
      source: { type: "graph", swarmId: "s", key: "k" },
    };
    expect(reposOf(prsOf([graph, prIn(undefined), prIn(42, 2), prIn("a/b", 3)]))).toEqual(["a/b"]);
  });
});

describe("featureWork", () => {
  it("is not started with no jobs", () => {
    expect(featureWork([], [])).toEqual({ state: "not-started", line: "Not built yet", repos: [] });
  });

  it("is in progress while a job runs or a pull request is open or in draft", () => {
    expect(featureWork([job("running")], [])).toEqual({ state: "in-progress", line: "1 job running", repos: [] });
    expect(featureWork([job("done")], prsOf([pr(1, "merged"), pr(2, "draft")]))).toEqual({
      state: "in-progress",
      line: "1 of 2 pull requests merged",
      repos: ["o/r"],
    });
    expect(featureWork([job("running")], prsOf([pr(1, "merged")])).state).toBe("in-progress");
  });

  it("is done once every pull request is merged (closed ones don't count) and no job runs", () => {
    expect(featureWork([job("done")], prsOf([pr(1, "merged"), pr(2, "merged"), pr(3, "closed")]))).toEqual({
      state: "done",
      line: "2 of 2 pull requests merged",
      repos: ["o/r"],
    });
  });

  it("is blocked by a failed newest job or failing CI, saying why", () => {
    expect(featureWork([job("failed", { error: "Pod out of disk" })], [])).toEqual({
      state: "blocked",
      line: "Implement it failed: Pod out of disk",
      repos: [],
    });
    expect(featureWork([job("done")], prsOf([pr(4, "open", ["unit", "e2e"])]))).toEqual({
      state: "blocked",
      line: "CI failing on PR 4: unit, e2e",
      repos: ["o/r"],
    });
    // A retry after a failure clears it.
    expect(featureWork([job("running", { jobId: "b" }), job("failed")], []).state).toBe("in-progress");
  });
});

describe("workOf", () => {
  it("reads the fixture's features from their jobs and rolls them up", () => {
    const ONB = "mock-initiative-onboarding";
    const t = mockInitiativeTree(ONB);
    const board = toBoard(
      [
        {
          summary: {
            ref_id: ONB,
            name: "Onboarding",
            status: null,
            created_at: null,
            updated_at: 1,
            created_by: null,
            created_by_kind: null,
            assignee_id: null,
          },
          ws: "ws",
          tree: { ...t, stage: initiativeStage(t.nodes), truncated: false },
        },
      ],
      {},
    );
    const { jobs, artifactsByRef } = mockCanvasJobs(ONB, (e) => mapStrutArtifacts(e, MOCK_STRUT_SWARM_ID).refs);
    const jobsByRef: Record<string, CanvasJob[]> = {};
    for (const j of jobs) (jobsByRef[j.refId] ??= []).push(j);
    const work = workOf(board, ONB, jobsByRef, artifactsByRef);
    expect(work.get("mock-f-gh")).toEqual(
      expect.objectContaining({ state: "done", line: "3 of 3 pull requests merged" }),
    );
    expect(work.get("mock-f-gh")?.repos.length).toBeGreaterThan(0);
    expect(work.get("mock-f-name")?.repos).toEqual([]);
    const ms = work.get("mock-m-signup")!;
    for (const f of ["mock-f-gh", "mock-f-repo"]) {
      for (const r of work.get(f)!.repos) expect(ms.repos).toContain(r);
    }
    expect(work.get("mock-f-repo")?.state).toBe("in-progress");
    expect(work.get("mock-f-name")?.state).toBe("not-started");
    expect(work.get("mock-f-link")?.state).toBe("blocked");
    expect(work.get("mock-m-signup")?.state).toBe("in-progress");
    expect(work.get(ONB)?.state).toBe("in-progress");
    expect(workOf(board, "mock-f-gh", jobsByRef, artifactsByRef).size).toBe(0);
  });
});
