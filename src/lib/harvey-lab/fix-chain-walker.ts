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
   * Both the chart and the cron pass `["HAS_BASELINE_TRIGGER", "HAS_TRIGGER"]`:
   * concept-driven recursion writes a fresh EvalTrigger via HAS_TRIGGER rather
   * than a ProposedFix, so a baseline-only first hop never loads those runs.
   */
  triggerEdgeTypes: string[];

  /**
   * Opt-in second trigger host: also fan out `HAS_TRIGGER` over the
   * EvalRequirement nodes the EvalSet owns via `HAS_REQUIREMENT`.
   *
   * Hive's own benchmark run route attaches its EvalTrigger to the
   * EvalRequirement, not to the EvalSet, so those runs are unreachable from the
   * EvalSet's own edges no matter which trigger edge types the first hop asks
   * for.
   *
   * NO production caller sets this today. The chart route shipped with it and
   * backed it out: the per-requirement fan-out is one GET per EvalRequirement
   * (~50 per EvalSet at ~3-6s each under FETCH_CONCURRENCY=10), which burned
   * the entire WALL_CLOCK_BUDGET_MS in production and aborted the in-flight
   * batch. Re-enable only behind a batched fetch (Jarvis depth=2 expand spike)
   * so the requirement host costs one call instead of N.
   */
  includeRequirementTriggers?: boolean;
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

/**
 * Sub-cap on the requirement fan-out (`includeRequirementTriggers`). An EvalSet
 * can own many EvalRequirement nodes; this bounds the extra hop independently of
 * the shared node+edge cap so it can never dominate the walk.
 */
const REQUIREMENT_FANOUT_CAP = 50;

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

  // When requirement-hosted triggers are requested, HAS_REQUIREMENT rides along
  // on the same hop (one extra GET) rather than costing a separate round-trip.
  const step1EdgeTypes = opts.includeRequirementTriggers
    ? [...opts.triggerEdgeTypes, "HAS_REQUIREMENT"]
    : opts.triggerEdgeTypes;

  const step1 = await fetchNodeForEdgeTypes(
    base, swarmApiKey, evalSetRefId, step1EdgeTypes, controller.signal,
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

  // Collect EvalTrigger ref_ids from the edges returned, keeping the baseline
  // branch separate. Everything downstream is ordered baseline-first: the walk
  // shares ONE node+edge cap and ONE wall-clock budget across all branches, so
  // without this ordering an EvalSet with many re-runs — exactly what this
  // feature targets — could exhaust the budget on new branches and truncate the
  // baseline ProposedFix chain, shortening the existing hill-climb line.
  // Baseline-first makes truncation degrade the new feature, never the old one.
  const evalSetTriggerEdges = step1.edges.filter(
    (e) => e.source === evalSetRefId && opts.triggerEdgeTypes.includes(e.edge_type),
  );

  const baselineTriggerRefIds = [
    ...new Set(
      evalSetTriggerEdges
        .filter((e) => e.edge_type === "HAS_BASELINE_TRIGGER")
        .map((e) => e.target)
        .filter(isValidRefId),
    ),
  ];
  const baselineTriggerSet = new Set(baselineTriggerRefIds);

  const otherEvalSetTriggerRefIds = [
    ...new Set(
      evalSetTriggerEdges
        .filter((e) => e.edge_type !== "HAS_BASELINE_TRIGGER")
        .map((e) => e.target)
        .filter(isValidRefId),
    ),
  ].filter((id) => !baselineTriggerSet.has(id));

  logger.info(
    "[legal/fix-chain-walker] EvalSet hop complete",
    "legal",
    {
      evalSetRefId,
      triggerEdgeTypes: opts.triggerEdgeTypes,
      includeRequirementTriggers: opts.includeRequirementTriggers === true,
      baselineTriggerCount: baselineTriggerRefIds.length,
      otherTriggerCount: otherEvalSetTriggerRefIds.length,
    },
  );

  // ── Shared hop helpers (used baseline-first, then for later branches) ──────

  const step2EdgeTypes = ["HAS_PROPOSED_FIX", "HAS_OUTPUT"];
  const fixEdgeTypes = ["DERIVED_FROM", "PRODUCED_BY"];
  const visitedTriggers = new Set<string>();
  const visitedFixes = new Set<string>();

  /** Fetch HAS_PROPOSED_FIX + HAS_OUTPUT for a batch of EvalTrigger ref_ids. */
  async function fetchTriggerHop(triggerIds: string[]) {
    const fresh = triggerIds.filter((id) => !visitedTriggers.has(id));
    for (const id of fresh) visitedTriggers.add(id);
    if (fresh.length === 0) return;

    const tasks = fresh.map((triggerId) => async () => {
      if (isBudgetExhausted() || isNodeEdgeCapped()) {
        partial = true;
        return;
      }
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

    await batchedAll(tasks, FETCH_CONCURRENCY);

    // A hop that lands past the cap means later branches get skipped — report it
    // rather than letting a truncated walk look complete.
    if (isNodeEdgeCapped()) {
      logger.warn(
        "[legal/fix-chain-walker] Node+edge cap reached during trigger hop — later branches will be skipped",
        "legal",
        { total: totalCount(), cap: NODE_EDGE_CAP },
      );
      partial = true;
    }
  }

  /** Root ProposedFix ref_ids hanging off the given triggers (unvisited only). */
  function rootFixesFor(triggerIds: string[]): string[] {
    const scope = new Set(triggerIds);
    return [...edgeMap.values()]
      .filter((e) => scope.has(e.source) && e.edge_type === "HAS_PROPOSED_FIX")
      .map((e) => e.target)
      .filter(isValidRefId)
      .filter((id) => !visitedFixes.has(id));
  }

  /** BFS over ProposedFix nodes via DERIVED_FROM + PRODUCED_BY, to completion. */
  async function walkFixes(seedIds: string[]) {
    let bfsQueue = [...seedIds];
    if (bfsQueue.length === 0) return;

    logger.info(
      "[legal/fix-chain-walker] Starting ProposedFix BFS",
      "legal",
      { rootFixCount: bfsQueue.length, fixEdgeTypes },
    );

    // Cap check before entering BFS — the trigger hop may already have pushed
    // past the cap.
    if (isNodeEdgeCapped()) {
      logger.warn(
        "[legal/fix-chain-walker] Node+edge cap already reached after trigger hop — skipping BFS",
        "legal",
        { total: totalCount(), cap: NODE_EDGE_CAP },
      );
      partial = true;
      return;
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
        if (isBudgetExhausted() || isNodeEdgeCapped()) {
          partial = true;
          return { fixRefId, nodes: [] as SubgraphNode[], edges: [] as SubgraphEdge[] };
        }

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
  }

  // ── Step 2a + 3a: baseline branch, fetched and walked to completion first ──

  hopDepth = 1;
  await fetchTriggerHop(baselineTriggerRefIds);
  await walkFixes(rootFixesFor(baselineTriggerRefIds));

  // ── Step 2b: non-baseline triggers hanging directly off the EvalSet ───────

  await fetchTriggerHop(otherEvalSetTriggerRefIds);

  // ── Step 2c: requirement-hosted triggers (opt-in) ─────────────────────────

  const requirementTriggerRefIds: string[] = [];

  if (opts.includeRequirementTriggers) {
    const requirementRefIds = [
      ...new Set(
        step1.edges
          .filter((e) => e.source === evalSetRefId && e.edge_type === "HAS_REQUIREMENT")
          .map((e) => e.target)
          .filter(isValidRefId),
      ),
    ];

    const cappedRequirementRefIds = requirementRefIds.slice(0, REQUIREMENT_FANOUT_CAP);
    if (cappedRequirementRefIds.length < requirementRefIds.length) {
      logger.warn(
        "[legal/fix-chain-walker] Requirement fan-out cap reached — some requirement-hosted triggers not walked",
        "legal",
        {
          evalSetRefId,
          requirementCount: requirementRefIds.length,
          cap: REQUIREMENT_FANOUT_CAP,
        },
      );
      partial = true;
    }

    const requirementTasks = cappedRequirementRefIds.map((requirementId) => async () => {
      if (isBudgetExhausted() || isNodeEdgeCapped()) {
        partial = true;
        return;
      }
      const data = await fetchNodeForEdgeTypes(
        base, swarmApiKey, requirementId, ["HAS_TRIGGER"], controller.signal,
      );
      if (!data.ok) {
        logger.warn(
          "[legal/fix-chain-walker] Failed to fetch EvalRequirement trigger edges",
          "legal",
          { requirementId },
        );
        failedBranches.push(requirementId);
        partial = true;
        return;
      }
      for (const n of data.nodes) addNode(n);
      for (const e of data.edges) addEdge(e);

      for (const e of data.edges) {
        if (e.source !== requirementId || e.edge_type !== "HAS_TRIGGER") continue;
        if (!isValidRefId(e.target)) continue;
        if (baselineTriggerSet.has(e.target)) continue;
        requirementTriggerRefIds.push(e.target);
      }
    });

    await batchedAll(requirementTasks, FETCH_CONCURRENCY);

    if (isNodeEdgeCapped()) {
      logger.warn(
        "[legal/fix-chain-walker] Node+edge cap reached during requirement fan-out",
        "legal",
        { total: totalCount(), cap: NODE_EDGE_CAP },
      );
      partial = true;
    }

    logger.info(
      "[legal/fix-chain-walker] Requirement fan-out complete",
      "legal",
      {
        evalSetRefId,
        requirementCount: cappedRequirementRefIds.length,
        requirementTriggerCount: new Set(requirementTriggerRefIds).size,
      },
    );

    await fetchTriggerHop([...new Set(requirementTriggerRefIds)]);
  }

  // ── Step 3b: remaining ProposedFix branches ───────────────────────────────
  // `visitedFixes` is shared with the baseline walk, so nothing is re-fetched.
  //
  // NOTE: this can legitimately GROW the fix-driven series relative to a
  // baseline-only walk. `walkDerivedFromChain` builds its children map from
  // every DERIVED_FROM edge with no trigger scoping, so a fix hanging off a
  // non-baseline trigger that derives from a node in the baseline chain now
  // re-enters that chain. Such a fix genuinely does derive from the baseline
  // chain, so including it is correct — but it is a change in rendered output,
  // pinned by test rather than asserted away.
  await walkFixes(
    rootFixesFor([...otherEvalSetTriggerRefIds, ...new Set(requirementTriggerRefIds)]),
  );

  clearTimeout(budgetTimer);

  const finalNodes = [...nodeMap.values()];
  const finalEdges = [...edgeMap.values()];

  logger.info(
    "[legal/fix-chain-walker] Walk complete",
    "legal",
    {
      evalSetRefId,
      triggerEdgeTypes: opts.triggerEdgeTypes,
      includeRequirementTriggers: opts.includeRequirementTriggers === true,
      triggerCount: visitedTriggers.size,
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
