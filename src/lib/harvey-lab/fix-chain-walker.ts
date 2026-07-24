/**
 * fix-chain-walker.ts
 *
 * Shared per-hop fix-chain walker that replaces the label-whitelist-based
 * `/graph/subgraph` (APOC `apoc.path.subgraphAll`) call with unconditional,
 * capped BFS over Jarvis's `/v2/nodes/{ref_id}?expand=edges&edge_type=[...]`.
 *
 * ## Root cause this fixes
 * The old `kgGetSubgraph` / `fetchSubgraph` approach sends a `node_type`
 * whitelist to APOC, which enforces it at EVERY traversal hop. A single
 * `ProposedFix`/`EvalTriggerOutput` node with off-list label casing causes
 * APOC to prune the ENTIRE downstream subtree past it, silently corrupting
 * both the hill-climb chart and the recursion cron's attempt counts.
 *
 * ## Design
 * - No `node_type` filter at any hop — fetched by edge type only, so casing
 *   drift can never prune a subtree.
 * - Zero accept/reject / score logic in the fetch layer — all classification
 *   still happens downstream in `isAccepted`, `walkDerivedFromChain`,
 *   `resolveFixOutput`, `buildHillClimbSeries`, `computeAttemptStats`.
 * - `triggerEdgeTypes` is parameterised:
 *     chart caller  → `["HAS_BASELINE_TRIGGER"]`
 *     cron caller   → `["HAS_BASELINE_TRIGGER","HAS_TRIGGER"]`
 *
 * ## Jarvis endpoint contract
 * `GET /v2/nodes/{ref_id}?expand=edges&edge_type=<url-encoded-python-list>`
 * `edge_type` is parsed by Jarvis via `ast.literal_eval`, so the value must
 * be a URL-encoded Python-list-literal, e.g. `%5B%22HAS_BASELINE_TRIGGER%22%5D`.
 * The response shape is `{ status, nodes, edges }` where each node carries
 * `ref_id`, `node_type`, `date_added_to_graph`, `properties`.
 *
 * ## Spike finding
 * Confirmed from existing callers (triggers/route.ts) that Jarvis parses
 * `edge_type` as a Python list literal. A multi-element `edge_type` array
 * with NO `node_type` param has no confirmed precedent in existing hive
 * callers, so we fall back to one GET per edge type per hop, merging results
 * by `ref_id`. This is conservative and correct — the fallback path is always
 * used so there is no branching on runtime discovery.
 */

import type { SubgraphNode, SubgraphEdge } from "@/lib/harvey-lab/hill-climb-series";
import { logger } from "@/lib/logger";

// ── Public API ────────────────────────────────────────────────────────────────

export interface WalkFixChainResult {
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  /** true when a safety cap was hit or a mid-walk hop failed */
  partial: boolean;
  /** ref_ids of branches where a mid-walk hop failure was logged */
  failedBranches?: string[];
}

export interface WalkFixChainOpts {
  /**
   * Edge types to use for the FIRST hop from the EvalSet node.
   * - chart: `["HAS_BASELINE_TRIGGER"]`
   * - cron:  `["HAS_BASELINE_TRIGGER", "HAS_TRIGGER"]`
   */
  triggerEdgeTypes: string[];
}

// ── Safety caps ───────────────────────────────────────────────────────────────

/** Maximum BFS hops — a pure cycle guard (not a semantic depth limit). */
const HOP_DEPTH_CAP = 100;

/** Maximum combined node + edge count — mirrors `KG_SUBGRAPH_CAP` in kg-adapter.ts. */
const NODE_EDGE_CAP = 500;

/** Wall-clock budget per `walkFixChain` invocation (ms). */
const WALL_CLOCK_BUDGET_MS = 25_000;

/** Concurrency limit for parallel per-hop fetches. */
const FETCH_CONCURRENCY = 10;

// ── ref_id validation ─────────────────────────────────────────────────────────

/**
 * Basic ref_id sanity check. Jarvis ref_ids are non-empty strings without
 * control characters. We also forbid `/` and `?` to prevent path/query injection.
 */
function isValidRefId(id: unknown): id is string {
  if (typeof id !== "string" || id.trim().length === 0) return false;
  // Forbid characters that could manipulate the URL path or query string
  if (/[/?#\x00-\x1f]/.test(id)) return false;
  return true;
}

// ── Jarvis fetch helpers ──────────────────────────────────────────────────────

/**
 * Encode a list of edge-type strings as a Python list literal and then
 * percent-encode the whole thing for use as a URL query param value.
 * e.g. ["HAS_BASELINE_TRIGGER"] → %5B%22HAS_BASELINE_TRIGGER%22%5D
 */
function encodePythonListParam(arr: string[]): string {
  const literal = `[${arr.map((s) => `"${s}"`).join(",")}]`;
  return encodeURIComponent(literal);
}

interface JarvisExpandResponse {
  nodes?: Array<{
    ref_id: string;
    node_type?: string;
    date_added_to_graph?: string | number;
    properties?: Record<string, unknown>;
  }>;
  edges?: Array<{
    source: string;
    target: string;
    ref_id?: string;
    edge_type: string;
  }>;
}

/**
 * Fetch a single ref_id with one edge_type filter from Jarvis.
 * Returns `null` on any HTTP / network error (caller treats as partial failure).
 * Never throws.
 */
async function fetchNodeEdges(
  baseUrl: string,
  swarmApiKey: string,
  refId: string,
  edgeType: string,
  signal: AbortSignal,
): Promise<JarvisExpandResponse | null> {
  const url =
    `${baseUrl}/v2/nodes/${encodeURIComponent(refId)}` +
    `?expand=edges&edge_type=${encodePythonListParam([edgeType])}`;
  try {
    const res = await fetch(url, {
      headers: { "x-api-token": swarmApiKey },
      signal,
    });
    if (!res.ok) {
      logger.warn(
        `[legal/fix-chain-walker] Jarvis returned ${res.status} for ref_id=${refId} edge_type=${edgeType}`,
        "legal",
        { refId, edgeType, status: res.status },
      );
      return null;
    }
    return (await res.json()) as JarvisExpandResponse;
  } catch (err) {
    // AbortError is expected when budget expires — don't log it as a failure
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (!isAbort) {
      logger.warn(
        `[legal/fix-chain-walker] fetch error for ref_id=${refId} edge_type=${edgeType}`,
        "legal",
        { refId, edgeType, reason: err instanceof Error ? err.message : String(err) },
      );
    }
    return null;
  }
}

/**
 * Fetch `refId` across MULTIPLE edge types (one GET per type) and merge
 * their node/edge results by `ref_id`.
 *
 * Returns `{ ok: false }` if ALL edge-type fetches failed for this ref_id.
 * If SOME succeed, partial data is returned with `ok: true` — the caller is
 * responsible for tracking partial state.
 */
async function fetchNodeForEdgeTypes(
  baseUrl: string,
  swarmApiKey: string,
  refId: string,
  edgeTypes: string[],
  signal: AbortSignal,
): Promise<{ ok: boolean; nodes: SubgraphNode[]; edges: SubgraphEdge[] }> {
  const results = await Promise.all(
    edgeTypes.map((et) => fetchNodeEdges(baseUrl, swarmApiKey, refId, et, signal)),
  );

  const nodeMap = new Map<string, SubgraphNode>();
  const edgeMap = new Map<string, SubgraphEdge>();
  let anyOk = false;

  for (const data of results) {
    if (!data) continue;
    anyOk = true;
    for (const n of data.nodes ?? []) {
      if (!isValidRefId(n.ref_id)) continue;
      if (!nodeMap.has(n.ref_id)) {
        nodeMap.set(n.ref_id, {
          ref_id: n.ref_id,
          node_type: n.node_type,
          date_added_to_graph: n.date_added_to_graph,
          properties: n.properties,
        });
      }
    }
    for (const e of data.edges ?? []) {
      if (!e.source || !e.target || !e.edge_type) continue;
      const key = `${e.source}|${e.target}|${e.edge_type}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          source: e.source,
          target: e.target,
          edge_type: e.edge_type,
        });
      }
    }
  }

  return {
    ok: anyOk,
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
  };
}

// ── Batched concurrent fetch helper ──────────────────────────────────────────

/**
 * Run `tasks` with bounded concurrency of `limit`.
 * Returns results in the same order as `tasks`.
 */
async function batchedAll<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Main walker ───────────────────────────────────────────────────────────────

/**
 * Walk the EvalSet → EvalTrigger → ProposedFix fix-chain via unconditional,
 * capped BFS, fetching via Jarvis `/v2/nodes/{ref_id}?expand=edges&edge_type=[...]`
 * with NO `node_type` filter at any hop.
 *
 * Output is a drop-in replacement for the old `kgGetSubgraph`/`fetchSubgraph`
 * result — `buildHillClimbSeries` and `computeAttemptStats` consume it unchanged.
 */
export async function walkFixChain(
  jarvisUrl: string,
  swarmApiKey: string,
  evalSetRefId: string,
  opts: WalkFixChainOpts,
): Promise<WalkFixChainResult> {
  if (!isValidRefId(evalSetRefId)) {
    logger.warn(
      "[legal/fix-chain-walker] Invalid evalSetRefId — aborting walk",
      "legal",
      { evalSetRefId },
    );
    return { nodes: [], edges: [], partial: true, failedBranches: [String(evalSetRefId)] };
  }

  const base = jarvisUrl.replace(/\/$/, "");
  const startMs = Date.now();
  const controller = new AbortController();
  const budgetTimer = setTimeout(() => controller.abort(), WALL_CLOCK_BUDGET_MS);

  // Accumulated graph (deduplicated)
  const nodeMap = new Map<string, SubgraphNode>();
  const edgeMap = new Map<string, SubgraphEdge>(); // key: source|target|edge_type
  const failedBranches: string[] = [];

  let partial = false;
  let hopDepth = 0;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function addNode(n: SubgraphNode) {
    if (!nodeMap.has(n.ref_id)) nodeMap.set(n.ref_id, n);
  }

  function addEdge(e: SubgraphEdge) {
    const key = `${e.source}|${e.target}|${e.edge_type}`;
    if (!edgeMap.has(key)) edgeMap.set(key, e);
  }

  function totalCount() {
    return nodeMap.size + edgeMap.size;
  }

  function isBudgetExhausted() {
    return Date.now() - startMs >= WALL_CLOCK_BUDGET_MS;
  }

  function isNodeEdgeCapped() {
    return totalCount() >= NODE_EDGE_CAP;
  }

  logger.info(
    "[legal/fix-chain-walker] Starting walk",
    "legal",
    {
      evalSetRefId,
      triggerEdgeTypes: opts.triggerEdgeTypes,
      caps: { hopDepth: HOP_DEPTH_CAP, nodeEdge: NODE_EDGE_CAP, wallClockMs: WALL_CLOCK_BUDGET_MS },
    },
  );

  // ── Step 1: EvalSet → EvalTrigger(s) via triggerEdgeTypes ──────────────────

  // Inject a stub EvalSet node so downstream locateBaselineTriggerRoot can find it
  addNode({ ref_id: evalSetRefId, node_type: "EvalSet", properties: {} });

  const step1 = await fetchNodeForEdgeTypes(
    base, swarmApiKey, evalSetRefId, opts.triggerEdgeTypes, controller.signal,
  );

  if (!step1.ok) {
    logger.warn(
      "[legal/fix-chain-walker] Failed to fetch EvalSet trigger edges — returning empty partial",
      "legal",
      { evalSetRefId, triggerEdgeTypes: opts.triggerEdgeTypes },
    );
    clearTimeout(budgetTimer);
    return { nodes: [], edges: [], partial: true, failedBranches: [evalSetRefId] };
  }

  for (const n of step1.nodes) addNode(n);
  for (const e of step1.edges) addEdge(e);

  // Collect EvalTrigger ref_ids from the edges returned
  const triggerRefIds = step1.edges
    .filter((e) => e.source === evalSetRefId && opts.triggerEdgeTypes.includes(e.edge_type))
    .map((e) => e.target)
    .filter(isValidRefId);

  logger.info(
    "[legal/fix-chain-walker] EvalSet hop complete",
    "legal",
    { evalSetRefId, triggerEdgeTypes: opts.triggerEdgeTypes, triggerCount: triggerRefIds.length },
  );

  if (triggerRefIds.length === 0) {
    clearTimeout(budgetTimer);
    return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()], partial: false };
  }

  // ── Step 2: EvalTrigger(s) → root ProposedFix + baseline EvalTriggerOutput ──

  hopDepth = 1;
  const step2EdgeTypes = ["HAS_PROPOSED_FIX", "HAS_OUTPUT"];

  const step2Tasks = triggerRefIds.map((triggerId) => async () => {
    if (isBudgetExhausted() || isNodeEdgeCapped()) return;
    const data = await fetchNodeForEdgeTypes(
      base, swarmApiKey, triggerId, step2EdgeTypes, controller.signal,
    );
    if (!data.ok) {
      logger.warn(
        "[legal/fix-chain-walker] Failed to fetch EvalTrigger edges",
        "legal",
        { triggerId },
      );
      failedBranches.push(triggerId);
      partial = true;
      return;
    }
    for (const n of data.nodes) addNode(n);
    for (const e of data.edges) addEdge(e);

    logger.info(
      "[legal/fix-chain-walker] EvalTrigger hop complete",
      "legal",
      {
        triggerId,
        edgeTypes: step2EdgeTypes,
        nodeCount: data.nodes.length,
        edgeCount: data.edges.length,
      },
    );
  });

  await batchedAll(step2Tasks, FETCH_CONCURRENCY);

  // ── Step 3: BFS over ProposedFix nodes via DERIVED_FROM + PRODUCED_BY ──────

  // Seed BFS queue with root ProposedFix ref_ids
  // (these are targets of HAS_PROPOSED_FIX edges from any EvalTrigger)
  const rootFixEdgeTypes = new Set(["HAS_PROPOSED_FIX"]);
  const triggerSet = new Set(triggerRefIds);

  let bfsQueue: string[] = [...edgeMap.values()]
    .filter((e) => triggerSet.has(e.source) && rootFixEdgeTypes.has(e.edge_type))
    .map((e) => e.target)
    .filter(isValidRefId);

  const visitedFixes = new Set<string>();
  const fixEdgeTypes = ["DERIVED_FROM", "PRODUCED_BY"];

  logger.info(
    "[legal/fix-chain-walker] Starting ProposedFix BFS",
    "legal",
    { rootFixCount: bfsQueue.length, fixEdgeTypes },
  );

  // Cap check before entering BFS — step 2 may already have pushed past the cap
  if (isNodeEdgeCapped()) {
    logger.warn(
      "[legal/fix-chain-walker] Node+edge cap already reached after trigger hop — skipping BFS",
      "legal",
      { total: totalCount(), cap: NODE_EDGE_CAP },
    );
    partial = true;
  }

  while (bfsQueue.length > 0 && !isNodeEdgeCapped() && !isBudgetExhausted()) {
    hopDepth++;

    if (hopDepth > HOP_DEPTH_CAP) {
      logger.warn(
        "[legal/fix-chain-walker] Hop-depth cap reached — stopping BFS",
        "legal",
        { hopDepth, cap: HOP_DEPTH_CAP, remainingQueue: bfsQueue.length },
      );
      partial = true;
      break;
    }

    // Dedup: only fetch ref_ids we haven't visited yet
    const currentBatch = bfsQueue.filter((id) => !visitedFixes.has(id));
    bfsQueue = [];

    for (const id of currentBatch) visitedFixes.add(id);

    if (currentBatch.length === 0) break;

    // Fetch each fix node in the batch with bounded concurrency
    const fetchTasks = currentBatch.map((fixRefId) => async () => {
      if (isBudgetExhausted() || isNodeEdgeCapped()) return { fixRefId, nodes: [], edges: [] as SubgraphEdge[] };

      const data = await fetchNodeForEdgeTypes(
        base, swarmApiKey, fixRefId, fixEdgeTypes, controller.signal,
      );

      if (!data.ok) {
        logger.warn(
          "[legal/fix-chain-walker] Mid-walk hop failure",
          "legal",
          { fixRefId, hopDepth, reason: "all edge-type fetches failed" },
        );
        failedBranches.push(fixRefId);
        partial = true;
        return { fixRefId, nodes: [] as SubgraphNode[], edges: [] as SubgraphEdge[] };
      }

      // Log per-hop detail including eval_status/status for the fix node
      const fixNode = data.nodes.find((n) => n.ref_id === fixRefId);
      const evalStatus = fixNode?.properties?.eval_status;
      const legacyStatus = fixNode?.properties?.status;
      const statusResolved = evalStatus != null ? `eval_status=${evalStatus}` : `status=${legacyStatus ?? "absent"}`;

      const siblingCount = data.edges.filter(
        (e) => e.source === fixRefId && e.edge_type === "DERIVED_FROM",
      ).length;

      logger.info(
        "[legal/fix-chain-walker] ProposedFix hop complete",
        "legal",
        {
          fixRefId,
          hopDepth,
          statusResolved,
          siblingCount,
          edgeTypes: fixEdgeTypes,
          nodeCount: data.nodes.length,
          edgeCount: data.edges.length,
        },
      );

      return { fixRefId, nodes: data.nodes, edges: data.edges };
    });

    const batchResults = await batchedAll(fetchTasks, FETCH_CONCURRENCY);

    for (const { nodes, edges } of batchResults) {
      for (const n of nodes) addNode(n);
      for (const e of edges) addEdge(e);
    }

    // Enqueue next-hop fix children (nodes reached via DERIVED_FROM edges from
    // THIS batch's nodes that are not yet visited)
    for (const { fixRefId, edges } of batchResults) {
      if (!fixRefId) continue;
      // Children via DERIVED_FROM: edges where TARGET is fixRefId (child --DERIVED_FROM--> parent)
      const children = edges.filter(
        (e) => e.target === fixRefId && e.edge_type === "DERIVED_FROM",
      ).map((e) => e.source).filter(isValidRefId);

      // Also: children FROM fixRefId via DERIVED_FROM (in case Jarvis returns forward edges)
      const childrenForward = edges.filter(
        (e) => e.source === fixRefId && e.edge_type === "DERIVED_FROM",
      ).map((e) => e.target).filter(isValidRefId);

      for (const c of [...children, ...childrenForward]) {
        if (!visitedFixes.has(c)) bfsQueue.push(c);
      }
    }

    if (isNodeEdgeCapped()) {
      logger.warn(
        "[legal/fix-chain-walker] Node+edge cap reached — stopping BFS",
        "legal",
        { total: totalCount(), cap: NODE_EDGE_CAP, hopDepth },
      );
      partial = true;
      break;
    }

    if (isBudgetExhausted()) {
      logger.warn(
        "[legal/fix-chain-walker] Wall-clock budget exhausted — stopping BFS",
        "legal",
        { elapsedMs: Date.now() - startMs, budget: WALL_CLOCK_BUDGET_MS, hopDepth },
      );
      partial = true;
      break;
    }
  }

  clearTimeout(budgetTimer);

  const finalNodes = [...nodeMap.values()];
  const finalEdges = [...edgeMap.values()];

  logger.info(
    "[legal/fix-chain-walker] Walk complete",
    "legal",
    {
      evalSetRefId,
      triggerEdgeTypes: opts.triggerEdgeTypes,
      nodeCount: finalNodes.length,
      edgeCount: finalEdges.length,
      hopDepth,
      partial,
      failedBranchCount: failedBranches.length,
      elapsedMs: Date.now() - startMs,
    },
  );

  return {
    nodes: finalNodes,
    edges: finalEdges,
    partial,
    ...(failedBranches.length > 0 ? { failedBranches } : {}),
  };
}
