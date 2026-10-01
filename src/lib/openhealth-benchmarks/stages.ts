/**
 * Strut run events → the stages of an `openhealth-run`, for a progress
 * view. Pure. Reads event paths and types only, plus one number (the
 * chart's section count) — never a step's payload. The run may be the
 * whole log or one subflow of it (`under`).
 */

import type { OpenHealthStage, OpenHealthStageStatus } from "@/types/openhealth";

/** The workflow's top-level steps that mark each stage, in order. */
const STAGES: Array<{ key: string; label: string; steps: string[] }> = [
  { key: "task", label: "Load chart", steps: ["task"] },
  { key: "ingest", label: "Ingest sections", steps: ["ingest"] },
  { key: "plan", label: "Plan", steps: ["seed_checklist", "write_checklist"] },
  { key: "produce", label: "Produce problem list", steps: ["produce"] },
  { key: "score", label: "Score", steps: ["scored"] },
  { key: "result", label: "Result", steps: ["result"] },
];

const INGEST_SECTION_RE = /^ingest#\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The step a path names, when it sits directly under `under` (a path
 * prefix) or, without one, directly under the run: `<workflow>/<step>`.
 */
function stepUnder(path: string, under: string | undefined): string | null {
  if (under === undefined) {
    const segments = path.split("/");
    return segments.length === 2 ? segments[1] : null;
  }
  if (!path.startsWith(`${under}/`)) return null;
  const rest = path.slice(under.length + 1);
  return rest.includes("/") ? null : rest;
}

/**
 * `under` names the run inside a larger workflow — an `openhealth-run`
 * subflow at `openhealth-improve-loop/loop#2/run` — whose stages are wanted.
 */
export function projectOpenHealthStages(events: unknown, opts: { under?: string } = {}): OpenHealthStage[] {
  const started = new Set<string>();
  const ended = new Set<string>();
  const failed = new Set<string>();
  let sectionCount: number | null = null;

  for (const event of Array.isArray(events) ? events : []) {
    if (!isRecord(event) || typeof event.path !== "string") continue;
    const step = stepUnder(event.path, opts.under);
    if (step === null) continue;
    if (event.type === "step.start") started.add(step);
    else if (event.type === "step.end" || event.type === "step.replayed") {
      ended.add(step);
      if (step === "task" && isRecord(event.output) && typeof event.output.sectionCount === "number") {
        sectionCount = event.output.sectionCount;
      }
    } else if (event.type === "step.error") failed.add(step);
  }

  return STAGES.map(({ key, label, steps }): OpenHealthStage => {
    let status: OpenHealthStageStatus = "pending";
    if (steps.some((s) => failed.has(s))) status = "failed";
    else if (steps.every((s) => ended.has(s))) status = "done";
    else if (steps.some((s) => started.has(s) || ended.has(s))) status = "running";
    if (key !== "ingest") return { key, label, status };
    const sections = [...started].filter((s) => INGEST_SECTION_RE.test(s));
    return {
      key,
      label,
      status,
      done: [...ended].filter((s) => INGEST_SECTION_RE.test(s)).length,
      total: sectionCount ?? sections.length,
    };
  });
}
