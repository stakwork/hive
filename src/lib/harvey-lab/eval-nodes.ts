/**
 * Harvey LAB eval graph helpers.
 *
 * Fetches rubric criteria from the Harvey LAB task.json and upserts
 * EvalSet + EvalRequirement nodes into the Jarvis eval graph.
 * All operations are non-fatal — callers must never let failures here
 * block a benchmark run.
 */
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import type { JarvisConnectionConfig } from "@/types/jarvis";

interface HarveyTaskCriterion {
  id: string;
  title: string;
  match_criteria: string;
  deliverables: string[];
}

/**
 * Fetches rubric criteria strings from the Harvey LAB task.json for a given
 * task slug.  Returns an empty array on any error — non-fatal.
 */
export async function fetchHarveyTaskCriteria(taskSlug: string): Promise<string[]> {
  const baseUrl = process.env.HARVEY_LAB_TASKS_BASE_URL;
  if (!baseUrl) {
    console.error("[harvey-lab/eval-nodes] HARVEY_LAB_TASKS_BASE_URL is not set — skipping criteria fetch");
    return [];
  }

  const url = `${baseUrl.replace(/\/$/, "")}/tasks/${taskSlug}/task.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[harvey-lab/eval-nodes] Failed to fetch task.json for ${taskSlug}: HTTP ${response.status}`);
      return [];
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      console.error(`[harvey-lab/eval-nodes] Failed to parse task.json JSON for ${taskSlug}`);
      return [];
    }

    const criteria = (json as Record<string, unknown>)?.criteria;
    if (!Array.isArray(criteria)) {
      console.error(`[harvey-lab/eval-nodes] task.json for ${taskSlug} missing or malformed "criteria" field`);
      return [];
    }

    return (criteria as HarveyTaskCriterion[])
      .map((c) => c?.match_criteria)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  } catch (err) {
    console.error(`[harvey-lab/eval-nodes] Unexpected error fetching criteria for ${taskSlug}:`, err);
    return [];
  }
}

/**
 * Idempotently upserts the shared Harvey LAB EvalSet and a per-task
 * EvalRequirement node, then wires HAS_REQUIREMENT.
 * Returns refs on success, null on any failure (non-fatal).
 */
export async function ensureHarveyLabEvalNodes(
  jarvisConfig: JarvisConnectionConfig,
  taskSlug: string,
  taskTitle: string,
  rubricCriteria: string[],
): Promise<{ evalSetRef: string; requirementRef: string } | null> {
  try {
    // 1. Upsert shared EvalSet
    const evalSetResult = await addNode(jarvisConfig, {
      node_type: "EvalSet",
      node_data: {
        id: "harvey-lab",
        name: "Harvey LAB",
        description: "Harvey LAB benchmark evaluation set",
      },
    });

    if (!evalSetResult.success || !evalSetResult.ref_id) {
      console.error("[harvey-lab/eval-nodes] Failed to upsert EvalSet:", evalSetResult.error);
      return null;
    }
    const evalSetRef = evalSetResult.ref_id;

    // 2. Upsert per-task EvalRequirement
    const reqResult = await addNode(jarvisConfig, {
      node_type: "EvalRequirement",
      node_data: {
        id: taskSlug,
        name: taskTitle,
        desirable_cases: rubricCriteria,
        undesirable_cases: [],
      },
    });

    if (!reqResult.success || !reqResult.ref_id) {
      console.error("[harvey-lab/eval-nodes] Failed to upsert EvalRequirement:", reqResult.error);
      return null;
    }
    const requirementRef = reqResult.ref_id;

    // 3. EvalSet -[HAS_REQUIREMENT]-> EvalRequirement
    await addEdge(jarvisConfig, {
      edge: { edge_type: "HAS_REQUIREMENT" },
      source: { ref_id: evalSetRef },
      target: { ref_id: requirementRef },
    });

    return { evalSetRef, requirementRef };
  } catch (err) {
    console.error("[harvey-lab/eval-nodes] Unexpected error upserting eval nodes:", err);
    return null;
  }
}
