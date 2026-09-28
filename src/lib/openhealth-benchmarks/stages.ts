/**
 * Strut run events → the stages of an `openhealth-run`, for a progress
 * view. Pure. Reads event paths and types only, plus one number (the
 * chart's section count) — never a step's payload.
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

export function projectOpenHealthStages(events: unknown): OpenHealthStage[] {
  const started = new Set<string>();
  const ended = new Set<string>();
  const failed = new Set<string>();
  let sectionCount: number | null = null;

  for (const event of Array.isArray(events) ? events : []) {
    if (!isRecord(event) || typeof event.path !== "string") continue;
    const segments = event.path.split("/");
    // Top-level steps only: `<workflow>/<step>`.
    if (segments.length !== 2) continue;
    const step = segments[1];
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
