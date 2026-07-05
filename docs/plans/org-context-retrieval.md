# Org-Context Retrieval: Seed → PPR → Package

Status: design, ready to implement. Substrate verified against prod (swarm38) 2026-07-04.

## Problem

Agents do accurate work in the wrong place. Given "add CSV export to the billing
rollup," research and codegen are fine — but the agent doesn't reliably know
*which* feature the user means (org jargon), *where* that feature lives
(repos/dirs/files), or *how similar work was done before* (exemplar PRs). Today
this is addressed by stuffing concept/repo descriptions into context, which
degrades as the corpus grows (hundreds of concepts, dozens of repos, redundant
and dead entries).

The insight from comparing GNN embeddings vs. LLM-with-context: the LLM already
knows software; what it lacks is the **org-specific delta** — the lexicon (what
things are called here) and the placement prior (what goes where). Don't train a
model to understand the org. Build small components that **look things up** for
a model that already understands software, and make them learn from every merged
PR.

## Architecture: three steps at query time

```
user utterance / new task
        │
   [1] SEED — match text → graph nodes
        │     alias/exact match on names (nameIndex fulltext)
        │     + embedding search (vector index)
        │     → 2-5 seed nodes (HiveFeature, Concept)
        │
   [2] WALK — personalized PageRank from seeds
        │     jarvis POST /v2/graph/algorithm {algorithm_name: "page_rank",
        │       sourceNodes: [...], relationshipWeightProperty: "weight"}
        │     persist=false → stream mode, read-only, local computation
        │     → scored neighborhood
        │
   [3] PACKAGE — filter + format for the consuming agent
        │     top ~10 Files, ~3 Concepts, ~3 similar past Tasks/PRs
        │     altitude-filtered per consumer (see below)
        ▼
   context block handed to Jamie / planner / Goose
```

No trained model anywhere in v1. Learning happens **in the graph** (edge
weights from outcome counting, below), not in model weights. A learned
re-ranker is a later, optional upgrade that must beat this baseline to ship.

### Why PPR and not embeddings alone

Embedding search finds nodes that *sound like* the query. PPR finds nodes
*structurally entangled* with the seeds — the config file two repos away, the
test that always breaks, the migration nobody mentions in prose. It's local
(computed from the seeds outward, indifferent to total graph size), weightable
(outcome counters bias the walk), and already deployed in jarvis.

### The pathway it walks (verified in prod)

```
HiveInitiative -HAS_MILESTONE-> HiveMilestone
HiveInitiative -HAS_RESEARCH->  HiveResearch
HiveFeature    -HAS_TASK->      HiveTask
HiveFeature/Task -HAS_MESSAGE-> HiveChatMessage
HiveTask       -RESULTED_IN->   PullRequest      ← backfilled 2026-07-04 (~1k+ edges)
PullRequest    -TOUCHES->       Concept
PullRequest    -MODIFIES->      File
Concept        -MODIFIES->      File
File           -CONTAINS->      Function/Tests, CALLS, HANDLER, ... (stakgraph AST)
```

All stakgraph nodes carry the `Data_Bank` label and `namespace: "default"`, so
the bulk-edge and read paths cross the Hive/codegraph boundary.

### Known graph gaps (fill opportunistically, none block v1)

- `AgentSession → HiveTask` — traces are islands; without this, "how it was
  done" (gotchas, process) can't be retrieved. Emit one edge when a session
  starts with a task id. Highest-value missing edge.
- `HiveDecision` / `HiveNote` — canvas islands (0 edges). Link to the
  feature/task they annotate in the canvas mirror.
- `HiveResearch` — write-only (only initiatives point at it).
- Some swarms are missing a whole leg (e.g. stakwork workspace: 0 linked, 345
  pending — no usable task-mirror or PR ingestion). Per-swarm health check
  belongs in the mirror cron's output.

## Implementation

### Step 1 — `getOrgContext(query, workspace)` service

New service in hive (`src/services/org-context/`), callable from the task
creation flow and as an MCP tool for the agents.

1. **Seed.** `GET /graph/search?search=<q>&stakgraph=true` (fulltext) plus the
   vector index via the same endpoint's hybrid mode. Take top 2–5 among
   node types `HiveFeature`, `Concept`. An exact alias/name hit outranks any
   embedding score.
2. **Walk.** `POST /v2/graph/algorithm` `{algorithm_name: "page_rank",
   sourceNodes: [<seed ref_ids>], limit: 200}` (persist=false → stream).
3. **Package.** Filter by node type; drop `status: deprecated/dead` when that
   field lands (see gitree CONSOLIDATION.md); format:

```
This appears to concern: <Feature name> — <one-line description>
Relevant files: <top files with paths>
Related concept docs: <concept names + ids>
Similar past work: PR #<n> "<title>" (task: "<task title>") — touched <files>
```

Exemplar PRs come from the ranked PullRequest nodes; their task titles via
`RESULTED_IN`. The exemplar is often the highest-value element: an agent shown
a near-identical past change in the right place rarely works in the wrong one.

**Altitude views** (same corpus, filtered per consumer):
- Jamie (org-level chat): Features/Initiatives + one-line summaries.
- Planner: Features + repos + entry-point files + exemplar PRs.
- Goose/task agents: file paths, functions, concept docs (clues).

### Step 2 — Outcome counters (learning by counting)

Every merged PR reinforces the pathways that produced it. Nightly (or in the
pr-link cron, which already touches these nodes):

- On `RESULTED_IN` creation, and on PR merge status: increment a `weight`
  property on the edges along `Task→PR→File` and bump
  `Feature→(derived)→File` support counts.
- Recency decay at read time (or periodic decay pass): the walk should prefer
  recently-reinforced paths. PPR consumes this via
  `relationshipWeightProperty: "weight"`.

A pattern seen twice stays noise; seen fifty times, it dominates the walk.
This is the "learns on the job" loop with zero training infrastructure.

### Step 3 — Usage logging (label capture, cheap, start immediately)

New table `org_context_queries`: query text, seed ref_ids, returned ref_ids,
consuming agent, task id. When the task later has `RESULTED_IN` PRs, join to
compute *retrieved-vs-actually-touched*. This yields, for free:

- precision@k time series (is retrieval getting better?)
- ranking labels for the future re-ranker
- merge candidates for the concept corpus (always co-retrieved, never co-used)

### Step 4 — Evaluation harness (we already have the dataset)

The RESULTED_IN backfill created ~1,000+ labeled examples: **task description →
files actually touched** (via task→PR→MODIFIES→File). Temporal split (train
on old, test on new — never random):

- For each held-out task: run Seed→Walk with the task title/description,
  measure whether the PR's files appear in the top-k. Report precision@10 /
  recall@10.
- **Baselines to beat:** (a) BGE embedding similarity only, no walk;
  (b) unweighted PPR; (c) weighted PPR. Each upgrade must beat the previous
  on this harness or it doesn't ship.

This harness is buildable *today* and is the single most important piece —
it converts every future retrieval idea from an argument into a measurement.

### Step 5 — Learned re-ranker (only after Steps 3–4 accumulate data)

Small model over path/candidate features — seed-to-candidate PPR score,
embedding similarity, recency, outcome counts, node type, same-repo flag.
Gradient-boosted trees or a 2-layer MLP: trains in minutes, retrainable
nightly, disposable. Labels from Step 3 logs + Step 4 harness.

Later options, strictly gated on beating the incumbent on the Step 4 harness:
- **Fine-tuned embedding retriever** (BGE-class, ~30–100M params) on
  (utterance → touched-location) pairs — fixes jargon grounding ("Falcon" ↔
  `services/ingest`) better than any generic embedding.
- **Schema-free GNN** (NBFNet/ULTRA-style relation-structure models) as the
  walk upgrade. Explicitly NOT a per-type heterogeneous GNN: open-vocabulary
  node/edge types as text embeddings, so new node kinds (Decisions, Learnings,
  sandbox gotchas) need no schema or retraining. Only if weighted-PPR+re-ranker
  plateaus below target.

## What this deliberately avoids

- **No LLM-judged step labeling** for supervision — merge status, task
  completion, and retrieved-vs-used are the only labels; they can't argue back.
- **No always-in-context concept dumps** — retrieval-first; corpus size stops
  mattering. (Concept lifecycle/dedup work is tracked separately in
  stakgraph `mcp/src/gitree/CONSOLIDATION.md`.)
- **No parametric model as the memory.** The graph is the memory; models only
  re-rank what the graph retrieves. Anything learned is rebuildable from the
  graph + logs in minutes, so nothing drifts unrecoverably.

## Order of work

1. Step 4 eval harness (uses existing data; sets the bar)
2. Step 1 service + MCP tool, measured against the harness
3. Step 3 usage logging (ship with Step 1)
4. Step 2 outcome weights (first measurable ranking upgrade)
5. `AgentSession → HiveTask` edge + Decision/Note linking (grows the pathway)
6. Step 5 re-ranker, when logs justify it

## Success metrics

- precision@10 / recall@10 on the Step 4 harness, reported per phase
- wrong-place rate proxy: tasks whose PR files ⊄ retrieved file set
- seed hit rate: % of queries where an alias/name match found the right
  Feature/Concept directly (lexicon health)
- retrieval latency budget: < 1s end-to-end (seed + walk + package)
