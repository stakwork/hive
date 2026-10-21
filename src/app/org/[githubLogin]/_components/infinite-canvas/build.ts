/**
 * Where a plan's build is, read from its strut jobs. A feature is built by
 * the jobs started on it (`useCanvasJobs`), and its pull requests are the
 * `pull_request` artifacts those jobs returned — one job or many, across any
 * number of repos. A milestone rolls up its features and an initiative its
 * milestones. Jobs are read for the initiative you're in, so only its cards
 * get a state. Pure: no React.
 */

import { type ArtifactRef, parseArtifactContent, type PullRequestState } from "../../_state/canvasChatArtifacts";
import type { CanvasJob } from "@/lib/canvas/canvas-jobs";
import { type Board, byId, kids, plural, type WorkState } from "./board";

/** A pull request a feature's jobs returned. State and failing checks only when the artifact carries them. */
export interface BuildPr {
  artifact: ArtifactRef;
  state?: PullRequestState;
  /** Names of the checks failing on its head commit. */
  failing: string[];
}

export interface Work {
  state: WorkState;
  /** One line under the name: why it's blocked, else how far it is. */
  line: string;
}

/** The pull requests among a card's artifacts. */
export function prsOf(artifacts: readonly ArtifactRef[] | undefined): BuildPr[] {
  return (artifacts ?? [])
    .filter((a) => a.kind === "pull_request")
    .map((artifact) => {
      const pr =
        artifact.source.type === "inline" ? parseArtifactContent("pull_request", artifact.source.content) : null;
      return {
        artifact,
        ...(pr ? { state: pr.state } : {}),
        failing: (pr?.state === "open" || pr?.state === "draft" ? (pr.checks ?? []) : [])
          .filter((c) => c.status === "failure")
          .map((c) => c.name),
      };
    });
}

/**
 * A feature from its jobs (newest first) and their pull requests. Blocked
 * when its newest job failed or a pull request's CI fails, saying which; not
 * started with no jobs; done once every pull request that wasn't closed is
 * merged and no job is running; else in progress.
 */
export function featureWork(jobs: readonly CanvasJob[], prs: readonly BuildPr[]): Work {
  const failed = jobs[0]?.state === "failed" ? jobs[0] : undefined;
  if (failed) return { state: "blocked", line: `${failed.title} failed${failed.error ? `: ${failed.error}` : ""}` };
  const red = prs.find((p) => p.failing.length);
  if (red) return { state: "blocked", line: `CI failing on ${red.artifact.title}: ${red.failing.join(", ")}` };
  if (!jobs.length && !prs.length) return { state: "not-started", line: "Not built yet" };
  const live = prs.filter((p) => p.state !== "closed");
  const merged = live.filter((p) => p.state === "merged").length;
  const running = jobs.filter((j) => j.state === "running").length;
  const line = live.length
    ? `${merged} of ${plural(live.length, "pull request")} merged`
    : running
      ? `${plural(running, "job")} running`
      : "No pull requests yet";
  return { state: live.length && merged === live.length && !running ? "done" : "in-progress", line };
}

/** A milestone or initiative from its parts: all done is done; any moving or done, in progress; else blocked if one is. */
function rollUp(parts: WorkState[]): WorkState {
  if (!parts.length) return "not-started";
  if (parts.every((x) => x === "done")) return "done";
  if (parts.some((x) => x === "in-progress" || x === "done")) return "in-progress";
  return parts.some((x) => x === "blocked") ? "blocked" : "not-started";
}

/** The work state of every feature, milestone and the initiative itself, under one initiative. */
export function workOf(
  b: Board,
  initiativeId: string,
  jobsByRef: Record<string, CanvasJob[]>,
  artifactsByRef: Record<string, ArtifactRef[]>,
): Map<string, Work> {
  const out = new Map<string, Work>();
  if (byId(b, initiativeId)?.type !== "initiative") return out;
  const milestones = kids(b, initiativeId, "milestone").map((m) => {
    const features = kids(b, m.id, "feature").map((f) => {
      const w = featureWork(jobsByRef[f.id] ?? [], prsOf(artifactsByRef[f.id]));
      out.set(f.id, w);
      return w.state;
    });
    const state = rollUp(features);
    out.set(m.id, { state, line: plural(features.length, "feature") });
    return state;
  });
  out.set(initiativeId, { state: rollUp(milestones), line: plural(milestones.length, "milestone") });
  return out;
}
