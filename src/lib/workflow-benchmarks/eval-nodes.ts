/**
 * Workflow Benchmark eval graph helpers.
 *
 * Idempotently upserts an EvalSet + EvalRequirement roster for each corpus task
 * into the Jarvis knowledge graph. The graph roster is the source of truth for
 * score denominators (graph-first scoring), so the EvalSet id and requirement ids
 * must be stable and match what the rubrics reader (resolveEvalSetRefIdBySlug +
 * fetchEvalSetRubrics) expects.
 *
 * Design decisions:
 *   - EvalSet id = the namespaced task slug (e.g. "wfbench/create-openai-call").
 *     resolveEvalSetRefIdBySlug searches by attribute `id` = taskSlug, so any
 *     other id value means the roster is permanently unavailable.
 *   - One EvalRequirement per criterion (not one per task). Legal writes one
 *     requirement per task with criteria flattened into desirable_cases, yielding
 *     a denominator of 1 — silently defeating partial credit.
 *   - Requirement graph ids are namespaced: "${taskSlug}::C-001" … "::C-008".
 *     Bare "C-00N" would collide graph-wide with other tasks' requirements.
 *   - `name` holds the human-readable title — it IS the display label.
 *     Do not stuff the bare criterion id into `name`.
 *   - addNodeBulk(config, nodes, { reprocess: true }) collapses 8 node calls
 *     into one /node/bulk request. Without reprocess:true, addNode treats an
 *     "already exists" warning as success and never updates corpus edits.
 *   - Read-before-write: fetch the existing EvalSet node first and ABORT if it
 *     exists without our `corpus: "workflow-benchmarks"` marker. reprocess:true
 *     is otherwise a blind in-place overwrite of any EvalSet with that id.
 *   - Non-fatal at dispatch: log-and-continue, never block a run.
 *   - Credential hygiene: log criterion ids, counts and outcome enums only —
 *     never the jarvisConfig object, never a raw caught error from a Jarvis call.
 *
 * Orphan reconciliation (requirements removed from the corpus) is handled by the
 * bootstrap script (scripts/bootstrap-workflow-benchmark-roster.ts), not here.
 * The dispatch path stays add/update-only; it logs a warning when the graph
 * roster size ≠ corpus criteria count so an inflated denominator is visible.
 */

import {
  addNodeBulk,
  addEdge,
  searchNodesByAttributes,
  deleteNode,
} from "@/services/swarm/api/nodes";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import { logger } from "@/lib/logger";
import type { WorkflowBenchmarkTask } from "@/lib/workflow-benchmark-tasks";

const LOG_SERVICE = "workflow-benchmarks/eval-nodes";

/** Marker attribute stamped on every EvalSet we own. */
const CORPUS_MARKER = "workflow-benchmarks";

// ── Type helpers ─────────────────────────────────────────────────────────────

export interface EvalNodeRefs {
  evalSetRef: string;
  requirementRefs: string[];
}

// ── Core upsert ──────────────────────────────────────────────────────────────

/**
 * Idempotently upsert the EvalSet and all EvalRequirement nodes for a task.
 *
 * Non-fatal: returns null on any error so callers (dispatch route) can log
 * and continue without aborting the run.
 *
 * @param config - Jarvis connection config for the workspace.
 * @param task   - The benchmark task from the corpus.
 * @returns Refs on success, null on failure.
 */
export async function ensureWorkflowBenchmarkEvalNodes(
  config: JarvisConnectionConfig,
  task: WorkflowBenchmarkTask,
): Promise<EvalNodeRefs | null> {
  const { slug: taskSlug, title: taskTitle, criteria } = task;

  try {
    // ── Step 1: Read-before-write guard ────────────────────────────────────
    // Fetch any existing node whose `id` attribute equals the task slug.
    // If one exists and lacks our corpus marker, abort to prevent blindly
    // overwriting a foreign EvalSet.
    const existingSearch = await searchNodesByAttributes(config, {
      nodeTypes: ["EvalSet", "Evalset"],
      filters: [{ attribute: "id", value: taskSlug, comparator: "=" }],
      includeProperties: true,
    });

    if (existingSearch.ok && existingSearch.nodes.length > 0) {
      for (const node of existingSearch.nodes) {
        const corpus = node.properties?.corpus;
        if (corpus !== CORPUS_MARKER) {
          logger.warn(
            `[${LOG_SERVICE}] Aborting upsert: existing EvalSet id=${taskSlug} has corpus=${String(corpus)} not "${CORPUS_MARKER}" — refusing blind overwrite`,
            LOG_SERVICE,
            { taskSlug, existingCorpus: corpus },
          );
          return null;
        }
      }
    }

    // ── Step 2: Upsert EvalSet ──────────────────────────────────────────────
    const evalSetBulk = await addNodeBulk(
      config,
      [
        {
          node_type: "EvalSet",
          node_data: {
            id: taskSlug,
            name: taskTitle,
            description: `Workflow Editor benchmark task: ${taskTitle}`,
            corpus: CORPUS_MARKER,
          },
        },
      ],
      { reprocess: true },
    );

    if (!evalSetBulk.success) {
      logger.warn(
        `[${LOG_SERVICE}] Failed to upsert EvalSet taskSlug=${taskSlug} errors=${evalSetBulk.errors.join("; ")}`,
        LOG_SERVICE,
        { taskSlug, criteriaCount: criteria.length },
      );
      return null;
    }

    // Resolve the EvalSet ref_id by searching for the node we just upserted.
    const evalSetSearch = await searchNodesByAttributes(config, {
      nodeTypes: ["EvalSet", "Evalset"],
      filters: [{ attribute: "id", value: taskSlug, comparator: "=" }],
      includeProperties: false,
    });

    if (!evalSetSearch.ok || evalSetSearch.nodes.length === 0) {
      logger.warn(
        `[${LOG_SERVICE}] Could not resolve EvalSet ref_id after upsert taskSlug=${taskSlug}`,
        LOG_SERVICE,
        { taskSlug },
      );
      return null;
    }

    // Deterministic tie-break: prefer "EvalSet" label; then lowest ref_id.
    const evalSetNode =
      evalSetSearch.nodes.find((n) => n.node_type === "EvalSet") ??
      evalSetSearch.nodes.sort((a, b) => a.ref_id.localeCompare(b.ref_id))[0];
    const evalSetRef = evalSetNode.ref_id;

    // ── Step 3: Upsert one EvalRequirement per criterion ───────────────────
    const requirementNodes = criteria.map((criterion) => ({
      node_type: "EvalRequirement",
      node_data: {
        // Namespaced so graph ids never collide with other tasks' requirements.
        // The rubrics route strips the "${taskSlug}::" prefix on the way out so
        // the wire id is bare "C-001" and criterionStatus joins correctly.
        id: `${taskSlug}::${criterion.id}`,
        // name = human display label. Never stuff the bare criterion id here.
        name: criterion.title,
        desirable_cases: [criterion.match_criteria],
        undesirable_cases: [],
        corpus: CORPUS_MARKER,
      },
    }));

    const reqBulk = await addNodeBulk(config, requirementNodes, { reprocess: true });

    if (!reqBulk.success) {
      logger.warn(
        `[${LOG_SERVICE}] Failed to upsert EvalRequirements taskSlug=${taskSlug} errors=${reqBulk.errors.join("; ")}`,
        LOG_SERVICE,
        { taskSlug, criteriaCount: criteria.length },
      );
      return null;
    }

    logger.info(
      `[${LOG_SERVICE}] Upserted EvalSet + ${criteria.length} EvalRequirements taskSlug=${taskSlug}`,
      LOG_SERVICE,
      {
        taskSlug,
        evalSetRef,
        criteriaIds: criteria.map((c) => c.id),
        outcome: "reprocess-update",
      },
    );

    // ── Step 4: Resolve requirement ref_ids and wire edges ─────────────────
    const reqSearch = await searchNodesByAttributes(config, {
      nodeTypes: ["EvalRequirement", "Evalrequirement"],
      filters: [{ attribute: "corpus", value: CORPUS_MARKER, comparator: "=" }],
      includeProperties: true,
    });

    const requirementRefs: string[] = [];

    if (reqSearch.ok) {
      for (const criterion of criteria) {
        const namespacedId = `${taskSlug}::${criterion.id}`;
        const reqNode = reqSearch.nodes.find(
          (n) => String(n.properties?.id ?? "") === namespacedId,
        );
        if (!reqNode) {
          logger.warn(
            `[${LOG_SERVICE}] Could not find EvalRequirement node for ${namespacedId} after upsert`,
            LOG_SERVICE,
            { taskSlug, criterionId: criterion.id },
          );
          continue;
        }
        requirementRefs.push(reqNode.ref_id);

        // Wire HAS_REQUIREMENT edge (idempotent on the graph side).
        await addEdge(config, {
          edge: { edge_type: "HAS_REQUIREMENT" },
          source: { ref_id: evalSetRef },
          target: { ref_id: reqNode.ref_id },
        });
      }
    }

    logger.info(
      `[${LOG_SERVICE}] Wired ${requirementRefs.length} HAS_REQUIREMENT edges taskSlug=${taskSlug}`,
      LOG_SERVICE,
      { taskSlug, evalSetRef, requirementCount: requirementRefs.length },
    );

    return { evalSetRef, requirementRefs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Credential hygiene: never log the jarvisConfig or a raw caught error object.
    logger.warn(
      `[${LOG_SERVICE}] Unexpected error upserting eval nodes taskSlug=${taskSlug}: ${message}`,
      LOG_SERVICE,
      { taskSlug, errorMessage: message },
    );
    return null;
  }
}

// ── Bootstrap helpers (used by the bootstrap script, not dispatch) ────────────

/**
 * List the EvalRequirement ref_ids currently hanging off an EvalSet in the graph.
 * Used by the bootstrap script to identify and delete orphaned requirements
 * (criteria removed from the corpus but still present in the graph).
 *
 * Returns an empty array on any error (non-fatal).
 */
export async function listEvalSetRequirementRefs(
  config: JarvisConnectionConfig,
  evalSetRefId: string,
): Promise<Array<{ ref_id: string; id: string }>> {
  try {
    const edgeType = encodeURIComponent("['HAS_REQUIREMENT']");
    const url = `${config.jarvisUrl}/v2/nodes/${encodeURIComponent(evalSetRefId)}?expand=edges&edge_type=${edgeType}&depth=1`;
    const res = await fetch(url, { headers: { "x-api-token": config.apiKey } });
    if (!res.ok) return [];

    const data = (await res.json()) as { nodes?: Array<{ ref_id: string; node_type?: string; properties?: Record<string, unknown> }> };
    return (data?.nodes ?? [])
      .filter(
        (n) =>
          n.ref_id !== evalSetRefId &&
          String(n.node_type ?? "").toLowerCase() === "evalrequirement",
      )
      .map((n) => ({
        ref_id: n.ref_id,
        id: String(n.properties?.id ?? ""),
      }));
  } catch {
    return [];
  }
}

/**
 * Delete an orphaned EvalRequirement node. Used by the bootstrap script.
 * Non-fatal — logs but does not throw.
 *
 * Note: The HAS_REQUIREMENT edge is managed by the graph side; we delete the
 * node directly and the edge is cleaned up automatically.
 */
export async function deleteOrphanedRequirement(
  config: JarvisConnectionConfig,
  requirementRefId: string,
  namespacedId: string,
): Promise<void> {
  try {
    await deleteNode(config, requirementRefId);
    logger.info(
      `[${LOG_SERVICE}] Deleted orphaned EvalRequirement id=${namespacedId}`,
      LOG_SERVICE,
      { requirementRefId, namespacedId },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[${LOG_SERVICE}] Failed to delete orphaned requirement id=${namespacedId}: ${message}`,
      LOG_SERVICE,
      { requirementRefId, namespacedId, errorMessage: message },
    );
  }
}

/**
 * Read a single node by ref_id via the Jarvis expand endpoint.
 * Used by bootstrap to verify the EvalSet was written correctly.
 * Returns null on any error.
 */
export async function readEvalSetNode(
  config: JarvisConnectionConfig,
  refId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const url = `${config.jarvisUrl}/v2/nodes/${encodeURIComponent(refId)}?limit=1`;
    const res = await fetch(url, { headers: { "x-api-token": config.apiKey } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
