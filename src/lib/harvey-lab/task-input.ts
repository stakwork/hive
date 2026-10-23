/**
 * A Harvey LAB task as `harvey-lab-run`'s input, built from the task's
 * `task.json` and `documents/` listing in stakwork/harvey-labs — the same
 * derivation the Stakwork run route makes: goal = the instructions, output =
 * the deliverable file names, documents = the folder's download URLs,
 * rubrics = the criteria as written. Server-only (reads GITHUB_TOKEN).
 */

import { HARVEY_LAB_TASKS, type HarveyTask } from "@/lib/harvey-lab-tasks";

const HARVEY_BASE = "https://raw.githubusercontent.com/stakwork/harvey-labs/main";
const GITHUB_API = "https://api.github.com/repos/stakwork/harvey-labs/contents";
const FETCH_TIMEOUT_MS = 15_000;

export interface HarveyCriterion {
  id: string;
  title: string;
  match_criteria: string;
  deliverables?: string[];
}

/** `harvey-lab-run`'s task fields (its `input:` block). */
export interface HarveyTaskInput {
  task_slug: string;
  task_title: string;
  task_goal: string;
  task_output_desc: string;
  documents_json: string[];
  rubrics_json: HarveyCriterion[];
}

interface TaskJson {
  title?: string;
  instructions?: string;
  deliverables?: Record<string, string>;
  criteria?: HarveyCriterion[];
}

/** The catalogue entry for a slug; null for anything not in hive's Harvey LAB list. */
export function findHarveyTask(slug: string): HarveyTask | null {
  for (const area of HARVEY_LAB_TASKS) {
    const task = area.tasks.find((t) => t.slug === slug);
    if (task) return task;
  }
  return null;
}

/** What the run is asked to produce: the deliverable names, else the instructions' `### Output` section. */
export function outputDescOf(taskJson: TaskJson): string {
  if (taskJson.deliverables && Object.keys(taskJson.deliverables).length > 0) {
    return Object.keys(taskJson.deliverables).join(", ");
  }
  const match = (taskJson.instructions ?? "").match(/###\s*Output[:\s]+([\s\S]+)$/i);
  return match ? match[1].trim().replace(/`/g, "") : "";
}

/**
 * The task's input, or an error saying what is missing. `task` must come
 * from `findHarveyTask` — its slug is what reaches the GitHub URLs.
 */
export async function fetchHarveyTaskInput(
  task: HarveyTask,
): Promise<{ ok: true; input: HarveyTaskInput } | { ok: false; error: string }> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  };
  const [taskRes, docsRes] = await Promise.all([
    fetch(`${HARVEY_BASE}/tasks/${task.slug}/task.json`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    fetch(`${GITHUB_API}/tasks/${task.slug}/documents`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
  ]);
  if (!taskRes.ok) return { ok: false, error: `task.json answered HTTP ${taskRes.status}` };
  const taskJson = (await taskRes.json().catch(() => null)) as TaskJson | null;
  if (!taskJson?.instructions) return { ok: false, error: "task.json has no instructions" };
  const rubrics = Array.isArray(taskJson.criteria) ? taskJson.criteria : [];
  if (rubrics.length === 0) return { ok: false, error: "task.json has no criteria" };

  // A task without a documents folder is a task without documents (404).
  let documents: string[] = [];
  if (docsRes.ok) {
    const listing = (await docsRes.json().catch(() => [])) as Array<{ type?: string; download_url?: string | null }>;
    documents = (Array.isArray(listing) ? listing : [])
      .filter((f) => f.type === "file" && typeof f.download_url === "string")
      .map((f) => f.download_url as string);
  } else if (docsRes.status !== 404) {
    return { ok: false, error: `the documents listing answered HTTP ${docsRes.status}` };
  }

  return {
    ok: true,
    input: {
      task_slug: task.slug,
      task_title: taskJson.title?.trim() || task.title,
      task_goal: taskJson.instructions,
      task_output_desc: outputDescOf(taskJson),
      documents_json: documents,
      rubrics_json: rubrics,
    },
  };
}
