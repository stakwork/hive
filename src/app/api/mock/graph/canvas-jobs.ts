/**
 * Mock mode (`USE_MOCKS`): the fake strut jobs of `initiative-fixture.ts`
 * as jobs on canvas cards, so the canvas shows markers locally the way it
 * does for real ones — the same org-channel nudge (`notifyCanvasCardJob`)
 * while a job runs and when it settles, and the same read
 * (`listCanvasJobs` answers from here). In memory on `globalThis`, like the
 * fixture's store.
 */

import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import type { CanvasJob, CanvasJobState } from "@/lib/canvas/canvas-jobs";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyCanvasCardJob } from "@/lib/pusher";
import { mockBuildJobs } from "./initiative-fixture";

interface MockJob {
  job: CanvasJob;
  workspaceSlug: string;
  artifacts: ArtifactRef[];
}

const holder = globalThis as unknown as { __mockCanvasJobs?: Map<string, MockJob> };
const jobs = (): Map<string, MockJob> => (holder.__mockCanvasJobs ??= new Map());

export function resetMockCanvasJobs() {
  delete holder.__mockCanvasJobs;
}

/** What `listCanvasJobs` returns for an initiative under mocks. */
export function mockCanvasJobs(initiativeRefId: string): {
  jobs: CanvasJob[];
  artifactsByRef: Record<string, ArtifactRef[]>;
} {
  const mine = [...seededJobs(initiativeRefId), ...jobs().values()]
    .filter((j) => j.job.initiativeRefId === initiativeRefId)
    .sort((a, b) => b.job.updatedAt - a.job.updatedAt);
  const artifactsByRef: Record<string, ArtifactRef[]> = {};
  for (const j of mine) if (j.artifacts.length) (artifactsByRef[j.job.refId] ??= []).push(...j.artifacts);
  return { jobs: mine.map((j) => j.job), artifactsByRef };
}

const HOUR = 3_600_000;
const SEEDED_AT = Date.now() - 3 * HOUR;

/** The fixture's build jobs as canvas jobs, each with the pull requests it returned, as of a few hours ago. */
function seededJobs(initiativeRefId: string): MockJob[] {
  return mockBuildJobs(initiativeRefId).map(({ refId, job }, i) => ({
    job: {
      jobId: `mock-build-${refId}-${i}`,
      runId: `mock-build-${refId}-${i}`,
      title: job.title,
      state: job.state,
      startedBy: { id: "mock-user", name: "Dev User" },
      refId,
      initiativeRefId,
      updatedAt: SEEDED_AT - i * HOUR,
      ...(job.error ? { error: job.error } : {}),
    },
    workspaceSlug: "",
    artifacts: job.prs.map(([repo, number, title, state, failing]) => ({
      id: `pr-${repo}-${number}`,
      kind: "pull_request",
      title,
      source: {
        type: "inline",
        content: {
          url: `https://github.com/${repo}/pull/${number}`,
          repo,
          number,
          state,
          ...(failing?.length
            ? { checks: [...failing.map((name) => ({ name, status: "failure" })), { name: "lint", status: "success" }] }
            : {}),
        },
      },
    })),
  }));
}

async function orgLoginOf(workspaceSlug: string): Promise<string | null> {
  try {
    const ws = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { sourceControlOrg: { select: { githubLogin: true } } },
    });
    return ws?.sourceControlOrg?.githubLogin ?? null;
  } catch (err) {
    logger.warn("Mock canvas job: no org for the workspace", "MOCK_CANVAS_JOBS", {
      workspaceSlug,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface MockCanvasJobHandle {
  /** The job wrote something (a card): a live update. */
  step: (kind?: string) => void;
  /** The job settled, with what it delivered. */
  done: (artifacts?: ArtifactRef[]) => void;
}

/**
 * A fake job on a card: recorded for the read, nudged to the org channel
 * now, on every step and when it settles.
 */
export function startMockCanvasJob(args: {
  title: string;
  workspaceSlug: string;
  initiativeRefId: string;
  refId: string;
}): MockCanvasJobHandle {
  const jobId = `mock-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const entry: MockJob = {
    job: {
      jobId,
      runId: jobId,
      title: args.title,
      state: "running",
      startedBy: null,
      refId: args.refId,
      initiativeRefId: args.initiativeRefId,
      updatedAt: Date.now(),
    },
    workspaceSlug: args.workspaceSlug,
    artifacts: [],
  };
  jobs().set(jobId, entry);
  const login = orgLoginOf(args.workspaceSlug);

  const nudge = (state: CanvasJobState, kind?: string) => {
    entry.job = { ...entry.job, state, updatedAt: Date.now(), ...(kind ? { latest: { kind } } : {}) };
    void login.then((githubLogin) => {
      if (!githubLogin) return;
      notifyCanvasCardJob(githubLogin, {
        jobId,
        runId: jobId,
        state,
        refId: args.refId,
        initiativeRefId: args.initiativeRefId,
        workspaceSlug: args.workspaceSlug,
        at: entry.job.updatedAt,
        ...(kind ? { latest: { kind } } : {}),
      });
    });
  };
  nudge("running");
  return {
    step: (kind = "graph") => nudge("running", kind),
    done: (artifacts = []) => {
      entry.artifacts = artifacts;
      nudge("done");
    },
  };
}

/** A pull request a fake build job returned, open with CI passing. */
export function mockPullRequestArtifact(repo: string, number: number, title: string): ArtifactRef {
  return {
    id: `pr-${repo}-${number}`,
    kind: "pull_request",
    title,
    source: {
      type: "inline",
      content: { url: `https://github.com/${repo}/pull/${number}`, repo, number, state: "open", checks: [] },
    },
  };
}

/** A markdown artifact, as a job's chat row would carry it. */
export function mockMarkdownArtifact(id: string, title: string, text: string): ArtifactRef {
  return { id, kind: "markdown", title, source: { type: "inline", content: { text } } };
}
