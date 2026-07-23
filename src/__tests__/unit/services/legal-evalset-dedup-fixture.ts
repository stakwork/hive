/**
 * Isolated dedup fixture for EvalSet deduplication tests.
 *
 * Contains two nodes sharing the same `props.id` — one labeled `EvalSet`
 * (holding the real disabled state) and one labeled `Evalset` (defaulting
 * `recursion: true`) — with matching `props.id` values set explicitly.
 *
 * IMPORTANT: This fixture must NOT be added to the shared `buildRecursionNodes()`
 * array in `src/app/api/mock/jarvis/graph/recursion-fixture.ts` because that
 * array is consumed by hill-climb tests whose `buildHillClimbSeries` locates
 * the EvalSet root via `nodes.find(n => isNodeType(n, "EvalSet"))`, and
 * inserting a duplicate-labeled node there would silently break unrelated
 * hill-climb assertions.
 *
 * Note: The existing duplicate-casing node in `buildRecursionNodes()` identifies
 * via `task_slug`, not `props.id`. This fixture uses matching `props.id` values,
 * since that is the exact field `mapNodeToEntry`'s id derivation and the dedup
 * grouping key both rely on.
 */

/** The shared task-level `props.id` for both nodes — the dedup key. */
export const DEDUP_FIXTURE_TASK_ID = "antitrust/dedup-test-task";

/**
 * The canonical node: labeled `EvalSet` (canonical casing), recursion = false.
 * This is the "real" node whose state should win after deduplication.
 */
export const DEDUP_REAL_NODE = {
  ref_id: "ref-evalset-canonical-001",
  node_type: "EvalSet",
  properties: {
    id: DEDUP_FIXTURE_TASK_ID,
    name: "Antitrust Dedup Test Task",
    recursion: false, // real state: disabled
  },
};

/**
 * The phantom node: labeled `Evalset` (legacy lowercase-s casing).
 * Has the same `props.id` as the real node but defaults `recursion: true`.
 * Without dedup, this phantom entry would make the task appear "stuck on Disable".
 */
export const DEDUP_PHANTOM_NODE = {
  ref_id: "ref-evalset-phantom-legacy-002",
  node_type: "Evalset",
  properties: {
    id: DEDUP_FIXTURE_TASK_ID, // same id — will be grouped by dedupeEvalSetNodes
    name: "Antitrust Dedup Test Task",
    recursion: true, // phantom default — must NOT win
  },
};

/**
 * Both nodes together: the raw Jarvis response containing a real + phantom pair.
 * Feed this to dedupeEvalSetNodes (or listRecursionEvalSets/listAllEvalSets)
 * and assert the result collapses to one entry with `recursion: false`.
 */
export const DEDUP_FIXTURE_NODES = [DEDUP_REAL_NODE, DEDUP_PHANTOM_NODE];

/**
 * A second, unrelated EvalSet node with a distinct task id.
 * Used in multi-node tests to confirm dedup is id-scoped (doesn't collapse
 * unrelated entries).
 */
export const DEDUP_UNRELATED_NODE = {
  ref_id: "ref-evalset-unrelated-003",
  node_type: "EvalSet",
  properties: {
    id: "corporate/unrelated-task",
    name: "Corporate Unrelated Task",
    recursion: true,
  },
};

/**
 * Three nodes: real + phantom (same id) + unrelated (different id).
 * After dedup: exactly 2 entries.
 */
export const DEDUP_FIXTURE_NODES_WITH_UNRELATED = [
  DEDUP_REAL_NODE,
  DEDUP_PHANTOM_NODE,
  DEDUP_UNRELATED_NODE,
];
