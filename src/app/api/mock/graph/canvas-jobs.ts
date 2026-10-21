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
import type { StrutArtifact } from "@/services/strut-runs/job-turn";
import { MOCK_STRUT_JOBS } from "./strut-artifacts";

interface MockJob {
  job: CanvasJob;
  workspaceSlug: string;
  artifacts: ArtifactRef[];
  /** What strut sent at `run.end`, before Hive's mapping. */
  strut?: StrutArtifact[];
}

const holder = globalThis as unknown as { __mockCanvasJobs?: Map<string, MockJob> };
const jobs = (): Map<string, MockJob> => (holder.__mockCanvasJobs ??= new Map());

export function resetMockCanvasJobs() {
  delete holder.__mockCanvasJobs;
}

/**
 * What `listCanvasJobs` returns for an initiative under mocks. `map` turns
 * strut's `run.end` entries into refs (`mapStrutArtifacts`, passed in so this
 * module stays free of the server's job-turn code).
 */
export function mockCanvasJobs(
  initiativeRefId: string,
  map: (entries: StrutArtifact[]) => ArtifactRef[] = () => [],
): {
  jobs: CanvasJob[];
  artifactsByRef: Record<string, ArtifactRef[]>;
} {
  const mine = [...seededJobs(initiativeRefId), ...jobs().values()]
    .filter((j) => j.job.initiativeRefId === initiativeRefId)
    .sort((a, b) => b.job.updatedAt - a.job.updatedAt);
  const artifactsByRef: Record<string, ArtifactRef[]> = {};
  for (const j of mine) {
    const refs = [...j.artifacts, ...map(j.strut ?? [])];
    if (refs.length) (artifactsByRef[j.job.refId] ??= []).push(...refs);
  }
  return { jobs: mine.map((j) => j.job), artifactsByRef };
}

const HOUR = 3_600_000;
const LOADED_AT = Date.now();

/** The mock strut jobs on this initiative's cards (`strut-artifacts.ts`), as of a few hours ago. */
function seededJobs(initiativeRefId: string): MockJob[] {
  return MOCK_STRUT_JOBS.filter((j) => j.initiativeRefId === initiativeRefId).map((j) => ({
    job: {
      jobId: j.jobId,
      runId: j.jobId,
      title: j.title,
      state: j.state,
      startedBy: { id: "mock-user", name: "Dev User" },
      refId: j.refId,
      initiativeRefId,
      updatedAt: LOADED_AT - j.hoursAgo * HOUR,
      ...(j.error ? { error: j.error } : {}),
    },
    workspaceSlug: "",
    artifacts: [],
    strut: j.artifacts,
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
