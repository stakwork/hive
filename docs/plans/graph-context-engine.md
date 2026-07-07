# Graph Context Engine: Generalized Seed → Walk → Package

Status: design. Generalizes `org-context-retrieval.md`, which becomes the
**code domain profile** of this engine. Nothing in that plan is discarded;
it is re-founded as one instantiation among many.

## Problem, generalized

A capable LLM already knows the *domain* — software, law, medicine, support
operations. What it lacks is the **corpus-specific delta**: what things are
called *here* (the lexicon), how things are organized *here* (the placement
prior), and how similar work was done *here* before (exemplars). Stuffing
descriptions into context degrades as the corpus grows. Training a model to
"understand the org" bakes today's corpus into weights that drift.

The general solution: keep the knowledge in a graph, keep the model generic,
and build a small **domain-blind retrieval engine** that looks things up —
and gets better by counting outcomes, not by training.

The engine must not know what a `File`, a `Clause`, or a `Patient` is. Every
domain-specific fact lives in a **domain profile** (config), and every
structural requirement lives in a **graph contract** (what the domain's
ingestion pipeline must produce). If the engine's source code mentions a
domain node type, that's a bug.

## Architecture: the engine

Three steps at query time, two loops in the background. All of them operate
on opaque node/edge types supplied by the profile.

```
user utterance / new task
        │
   [1] SEED — match text → graph nodes
        │     exact/alias match on names (fulltext index)
        │     + embedding search (vector index), hybrid-ranked
        │     restricted to profile.seedTypes
        │     + optional caller-supplied bias seeds at reduced
        │       teleport mass (see "who is asking", below)
        │     → 2–5 seed nodes
        │
   [2] WALK — personalized PageRank from seeds
        │     POST /v2/graph/algorithm {algorithm_name: "page_rank",
        │       sourceNodes: [...], relationshipWeightProperty: "weight"}
        │     persist=false → stream mode, read-only, local computation
        │     → scored neighborhood (indifferent to total graph size)
        │
   [3] PACKAGE — bucket + format for the consuming agent
        │     profile.packageBuckets: {type → count} per bucket
        │     profile.altitudeViews: which buckets each consumer sees
        │     profile.template: prose rendering
        ▼
   context block handed to the consuming agent

   [loop A] OUTCOME COUNTING — on each outcome event (profile.outcomeEvent),
            increment `weight` on the edges along task → artifact → leaves;
            recency decay so the walk prefers recently-reinforced paths.
   [loop B] USAGE LOGGING — every query logged (query text, seeds, returned
            refs, consumer, task id); joined later against outcome events to
            yield precision@k, ranking labels, and merge candidates.
```

No trained model in v1. Learning happens in the graph (edge weights), and
anything learned later (re-ranker) is rebuildable from graph + logs in
minutes.

### Why PPR and not embeddings alone

Embedding search finds nodes that *sound like* the query. PPR finds nodes
*structurally entangled* with the seeds — the config file two repos away, the
side-letter that modifies the clause nobody quoted, the prior authorization
that explains the denial. It is local (computed outward from the seeds),
weightable (outcome counters bias the walk), and type-blind — which is what
makes this engine generalizable at all.

### Seed mass: query seeds + bias seeds ("who is asking")

Retrieval that ignores the requester recalls like an org-wide search
engine; a human recalls from *their* corner of the corpus first. The engine
stays domain-blind by modeling identity as nothing but teleport mass: the
caller may pass extra `biasSeeds` (any node refs), and the engine splits
PPR teleport mass between query seeds (default ~80%) and bias seeds
(~20%). What a bias seed *means* is the profile's business — the code
domain resolves the requester to their Contributor node or
recently-touched features; legal, to the attorney's active matters;
support, to the agent's product area. Because PPR blends multiple seeds
natively, this costs nothing at walk time.

Loop B logs the actor ref with every query, so the identity lift is
measurable per domain on the harness: precision@10 on that actor's
held-out tasks, with vs. without bias seeds. If it doesn't win, a profile
turns it off — never an engine change.

### The ambient tier: a corpus map, not a corpus dump

Per-query retrieval alone leaves the agent amnesiac between queries — it
never develops the standing "mental map of the org" a human carries. The
full design is therefore two tiers, matching human memory:

- **Ambient tier** (always in context, ~1–2k tokens, regenerated nightly,
  cached): a *ranked, hierarchical* digest of the lexicon layer —
  container → lexicon names, ranked by persisted global centrality
  (e.g. the `algo_page_rank` node property a cron already writes) plus
  recency, hard-capped at a token budget. This is an **index, not
  knowledge**: it tells the model what exists *here* so its paraphrases
  use the corpus's own vocabulary — which directly improves seeding.
- **Retrieved tier** (per job-to-be-done): Seed → Walk → Package as
  above. Assemble it **once at task creation and cache it on the task**
  — consolidation, like a human reading in when picking up a job, not
  before every sentence. This also removes walk latency from the
  per-message hot path.

The existing practice of dumping every lexicon name across all workspaces
into the org-level agent is the right instinct (the mental map) with the
wrong implementation (flat, unranked, unbudgeted — degrades as the corpus
grows). The map generalizes cleanly: code = workspace → repo → top
features/concepts; legal = practice area → matter → key parties/statutes;
support = product → components. The profile supplies the hierarchy and the
budget; the engine ranks and renders.

## The graph contract

The engine demands nothing about *what* the nodes are, but is strict about
*how* they are indexed and connected. Any domain deployment must supply a
graph where:

1. **Nodes are named and indexed.** Every seedable node has a `name` (and
   optionally `aliases`) in the fulltext index, and an embedding in the
   vector index. Seeding quality is bounded by this — a lexicon entry the
   index can't find does not exist.
2. **Edges are typed and weightable.** Any edge types, any topology. Each
   edge carries an optional numeric `weight` the walk consumes via
   `relationshipWeightProperty`. Absent weights default to 1.
3. **Entity resolution is good enough that seeds land on one node.** Two
   nodes for the same real-world entity ("Acme Corp" twice) split the seed
   mass and both lose the walk. This is an ingestion-quality bar, not an
   engine feature — the engine cannot repair a graph that lies about
   identity.
4. **Leaves are reachable from seeds.** There must be *some* path from the
   seedable layer (lexicon) to the deliverable layer (leaves) — otherwise
   the walk ranks the lexicon and never reaches evidence. Path length and
   edge names don't matter; reachability does.
5. **An outcome event exists** (or the deployment accepts degraded mode —
   see below).

Ingestion — parsing, chunking, entity/relation extraction, embedding — is
explicitly out of scope for the engine. Deterministic extraction (ASTs, git)
meets the contract easily; noisy extraction (NER over legal documents) meets
it only after an entity-resolution pass. The contract is the interface; how
a domain honors it is its own pipeline's problem.

## The outcome event: the real generality test

Everything adaptive in this design — edge weights (loop A), labels (loop B),
and the eval harness — hangs on one domain-native fact: **an unambiguous,
machine-readable event that links a task to the exact leaves it actually
used.** In the code domain this is the merged PR: free, frequent, and
adversary-proof ("labels that can't argue back").

A domain profile must declare its outcome event as:

```
(task node) ──outcome artifact──> (set of leaf nodes actually touched/used)
```

The strength of a domain's outcome event determines how much of this design
it gets:

| Outcome event quality        | What you get                                    |
| ---------------------------- | ----------------------------------------------- |
| Dense + machine-readable     | Full design: weighted walk, harness, re-ranker  |
| Sparse or lagged             | Full design, slow convergence; add proxy events |
| Human-labeled only           | Retrieval + logging; weights grow at labor cost |
| None                         | Static Seed→PPR→Package (still most of the value); no learning loop, no harness |

State this degradation honestly per deployment. A domain without an outcome
event has not broken the engine — it has opted out of the learning half.

## The domain profile

Everything the engine is *not allowed* to know, in one config object:

```ts
interface DomainProfile {
  // Which node types the lexicon lives in — where seeds may land.
  seedTypes: string[];

  // Output shape: named buckets, each a set of node types and a count.
  packageBuckets: Array<{
    label: string;          // "Relevant files" / "Key clauses"
    types: string[];
    count: number;
  }>;

  // Per-consumer filtering: which buckets each consumer sees, at what count.
  altitudeViews: Record<ConsumerId, BucketFilter>;

  // Prose rendering of the package for the consuming agent.
  template: (pkg: Package) => string;

  // The domain's "merged PR": how to detect an outcome and enumerate the
  // leaves it touched. Drives loop A, loop B joins, and the eval harness.
  outcomeEvent: {
    detect: OutcomeDetector;              // e.g. edge type + status predicate
    touchedLeaves: (artifact) => NodeRef[];
  };

  // Node-status predicate for dropping dead/deprecated entries at package
  // time (statuses are domain words; the predicate keeps them out of engine).
  isRetired?: (node) => boolean;

  // Hub damping (see below). Default: inverse-degree normalization on.
  hubDamping?: { inverseDegree: boolean; dampingFactor?: number };

  // Ambient corpus map (see above): the always-in-context ranked digest.
  // hierarchy lists node types outermost-container → lexicon; the engine
  // ranks entries by persisted global centrality + recency and cuts at
  // the token budget. Optional — a domain without a stable lexicon layer
  // simply has no ambient tier.
  corpusMap?: { hierarchy: string[]; budgetTokens: number };

  // Resolve the requesting actor to bias-seed nodes ("who is asking").
  // The engine never learns what an actor is — it only receives seeds
  // and a teleport-mass split.
  actorSeeds?: (actor: ActorRef) => NodeRef[];
}
```

The engine ships as `src/services/graph-context/` (engine, domain-blind) plus
`src/services/graph-context/profiles/` (one file per domain). The existing
org-context plan becomes `profiles/code.ts` verbatim.

## Hub damping: a first-class knob, not an afterthought

Every real graph has hubs; some domains have super-hubs — landmark cases,
mega-parties, boilerplate clauses, `utils.ts`. Two problems compound:

- PPR mass pools at high-degree nodes regardless of relevance.
- Loop A only *reinforces*; it never penalizes commonness. A node touched by
  every outcome accumulates weight toward every query — weighted PPR will
  happily return "Delaware" for anything.

The engine therefore applies, by default:

- **Inverse-degree edge normalization** at walk time (a TF-IDF for edges:
  an edge into a node touched by everything carries less per-walk mass).
- Profile-tunable `dampingFactor` for domains with heavy-tailed degree
  distributions.

Zero-code starting point: jarvis already exposes `article_rank`, the
degree-dampened PageRank variant — run it as the damped baseline before
building custom normalization, and let the harness say whether more is
needed.

The code domain barely needs this; the legal domain is unusable without it.
That is exactly why it belongs in the engine with a profile knob, not in a
profile.

## Instantiations

Three worked examples, to demonstrate the profile is a plane and not a line
through one point.

### Code (the existing plan, re-founded)

- **Graph:** stakgraph AST + Hive mirror. Deterministic ingestion.
- **Seeds:** `HiveFeature`, `Concept`.
- **Leaves:** `File`, `Function`.
- **Buckets:** ~10 files, ~3 concepts, ~3 exemplar PRs (task titles via
  `RESULTED_IN`).
- **Outcome event:** PR merged → `MODIFIES` edges enumerate touched files.
  Dense, free, machine-readable — the best outcome event of the three.
- **Altitude views:** Jamie (features + summaries), planner (features +
  repos + entry points + exemplar PRs), Goose (paths, functions, concepts).

### Legal

- **Graph (ingestion pipeline, domain's own problem):** documents parsed and
  chunked; NER + relation extraction; entity resolution pass. Node types:
  `Matter`, `Document`, `Chunk`/`Clause`, `Person`, `Org`, `Court`,
  `Statute`, `Filing`. Edges: `INVOLVES`, `REPRESENTS`, `CITES`, `CONTAINS`,
  `AMENDED_BY`, `RESULTED_IN`.
- **Seeds:** `Matter`, `Party` (Person/Org), `Statute`, `Concept`.
- **Leaves:** `Chunk`/`Clause`, `Document`.
- **Buckets:** ~10 chunks/clauses, ~3 entities with roles, ~3 similar past
  matters with their filings as exemplars.
- **Outcome event:** filed brief/executed agreement → documents and clauses
  it cites/incorporates. Sparser and laggier than PR merges — expect slow
  weight convergence; documents-cited-in-shipped-drafts is a reasonable
  proxy event to densify it. Attorney relevance marks work but cost labor.
- **Altitude views:** partner (matters + one-line postures), associate
  (clauses + exemplar filings), drafting agent (chunk text + citations).
- **Where it strains (say so):** noisy extraction → the entity-resolution
  bar in the graph contract is the hard part; super-hubs → hub damping
  mandatory.

### Support / ops (sketch)

- **Seeds:** `Product`, `Component`, `Customer`, `Concept`.
- **Leaves:** `KBArticle`, `RunbookStep`, past `Ticket` resolutions.
- **Outcome event:** ticket resolved → articles/runbooks actually linked in
  the resolution. Dense and machine-readable — nearly as good as merges.

## Learning loops (engine-side, profile-driven)

### Loop A — outcome counting

On each `profile.outcomeEvent`, increment `weight` along the edges from the
task through the artifact to its touched leaves; bump derived
lexicon→leaf support counts. Recency decay at read time or via a periodic
decay pass. A pattern seen twice stays noise; seen fifty times, it dominates
the walk. Zero training infrastructure.

### Loop B — usage logging

One table, `graph_context_queries`: query text, seed refs, returned refs,
consumer, task id, profile id. Joined against later outcome events it
yields, for free: precision@k time series, ranking labels for the future
re-ranker, and merge candidates for the lexicon (always co-retrieved, never
co-used). Ship with the first query the engine ever serves.

## Evaluation harness (generalized)

The harness is domain-parametric: for any profile with an outcome event, the
corpus of past `(task text → leaves actually touched)` pairs is the labeled
dataset. Temporal split — train on old, test on new, never random.

- For each held-out task: run Seed→Walk with the task text; measure whether
  the outcome's leaves appear in top-k. Report precision@10 / recall@10.
- **Baselines to beat, per domain:** (a) embedding similarity only, no walk;
  (b) unweighted PPR; (c) weighted PPR. Each upgrade must beat the previous
  on this harness or it doesn't ship — in *every* deployed domain, not just
  the one it was tuned on. A change that helps code and hurts legal is a
  profile change, not an engine change.

The code domain already has ~1,000+ labeled pairs (the `RESULTED_IN`
backfill), so the harness is buildable today and sets the bar before any
second domain lands.

## Re-ranker training (first learned component, gated on the harness)

The re-ranker re-scores the walk's top-N candidates before packaging. It is
the first place a trained model enters the system, so it is also the first
place domain coupling can sneak back in — the guardrails below exist for
that reason.

### Labels (from loop B joins, zero annotation)

Join `graph_context_queries` against later outcome events to produce
`(query, candidate, touched?)` triples:

- **Positives:** candidate retrieved ∧ in the outcome's touched leaves.
- **Negatives:** candidate retrieved ∧ not touched. These are *hard*
  negatives by construction — the walk already thought they were good —
  which is what makes the model better than the walk instead of a copy
  of it.
- **Missed positives** (touched but never retrieved) can't be ranking
  labels, but log them: they measure recall ceiling and feed the embedding
  retriever fine-tune later.
- Supplement with harness pairs for tasks that predate logging (the code
  domain starts with ~1,000+).

Cold-start bar: don't train below a few thousand triples in a domain; below
that, weighted PPR stays the incumbent.

### Features (domain-blind by construction)

Every feature is computable from the graph contract alone — no profile may
inject a domain-specific feature, otherwise per-domain models silently fork
into per-domain systems:

- seed→candidate PPR score (the incumbent's opinion)
- query↔candidate embedding similarity
- hop distance from nearest seed; max/sum edge weight along best path
- candidate outcome count and recency (loop A state)
- candidate degree percentile (hubness — lets the model learn its own
  damping)
- node type and incoming edge types **as text embeddings**, not categorical
  codes — new types in any domain need no feature-schema change
- same-container flag, where "container" is a profile-provided predicate
  (same repo / same matter / same product)

### Training and serving

- Gradient-boosted trees with a pairwise ranking objective (LambdaMART) or a
  2-layer MLP; trains in minutes on one machine.
- **Temporal split always** — train on old queries, validate on new. Random
  splits leak lexicon drift and overstate wins.
- Retrain nightly from scratch: graph + logs → model. The model is
  disposable; nothing accumulates in weights that isn't rebuildable.
- **Per-domain checkpoints by default.** Label balance and degree
  distributions differ too much across domains to share weights. A shared
  cross-domain model is a *later* experiment that the text-embedded type
  features deliberately keep possible — it must beat every per-domain
  incumbent on that domain's harness to replace it.
- Serving: re-rank the walk's top-200 before packaging; well inside the
  < 1s budget.

### Gate

Ships per domain only if it beats weighted PPR on that domain's harness at
precision@10 / recall@10. If it wins on code and loses on legal, code gets
it and legal keeps PPR — model rollout is a per-profile decision, never an
engine flag day.

## Later upgrades (strictly gated on the harness)

- **Fine-tuned embedding retriever** on (utterance → touched-leaf) pairs —
  fixes jargon grounding better than any generic embedding. Per-domain
  checkpoints; the engine just swaps the vector index.
- **Schema-free GNN** (NBFNet/ULTRA-style) as the walk upgrade. Explicitly
  NOT a per-type heterogeneous GNN: node/edge types enter as text
  embeddings, so a new domain — or new node kinds within one — needs no
  schema and no retraining. This is the only walk upgrade compatible with
  the engine's domain-blindness, which is why it was chosen in the original
  plan and survives generalization unchanged.

## What this deliberately avoids

- **No domain types in engine code.** Grep-enforceable: `HiveFeature`,
  `Clause`, `File` appear only under `profiles/`.
- **No LLM-judged labels.** Outcome events and retrieved-vs-used are the
  only supervision; they can't argue back.
- **No always-in-context corpus dumps.** Retrieval-first; corpus size stops
  mattering in any domain. The ambient corpus map is not an exception: it
  is ranked, budgeted, and an index of *names* — never content.
- **No parametric model as the memory.** The graph is the memory; models
  only re-rank what the graph retrieves. Everything learned is rebuildable
  from graph + logs in minutes.
- **No pretense that ingestion is solved.** The engine states its contract;
  a domain that can't meet the entity-resolution or outcome-event bar gets
  the degraded tier, documented, not a silent quality cliff.

## Engine substrate: verified jarvis gaps (2026-07-07)

Read against jarvis-backend source. All of these are domain-blind engine
work — GDS plumbing that any ontology needs — and all require jarvis PRs
before the WALK step is real:

1. **`sourceNodes` is not resolved — personalized PPR is non-functional
   today.** The schema accepts ref_id strings
   (`input_schema_helper.py:278-303`) but `call_PageRankStreamV2`
   (`graph_algorithms_helper.py:157-248`) passes them raw to GDS, which
   expects internal numeric node ids. Fix: resolve refs the way
   pathfinding already does (`_resolve_ref_id_to_node_id`,
   `graph_algorithms_helper_v2.py:161-170`).
2. **`relationshipWeightProperty` is silently ignored.** The Cypher
   projections return only `id(n), id(m)` — no relationship properties
   enter the in-memory graph, so weighted PPR (loop A's consumer) is a
   no-op. Fix: project a generic numeric `weight` relationship property
   (absent → 1), and add `weight` as an optional attribute on all schema
   edges (today only type-specific numerics like `MODIFIES.importance`
   exist).
3. **Latency.** Every algorithm call builds and drops a fresh GDS Cypher
   projection (caching deliberately disabled). The < 1s budget needs a
   scoped or cached projection — or the degraded walk below.

Already-working substrate the engine gets for free: hybrid seeding
(fulltext + vector with RRF fusion, `node_service_v2.py`) is done;
`article_rank` provides default hub damping; a cron already persists
global `algo_page_rank`, which ranks the ambient map **and** enables a
degraded walk — 1-hop `expand=true` neighborhood ∩ global rank ∩ query
embedding similarity — usable as baseline (b′) on the harness and as the
fallback wherever per-query PPR misses the latency budget.

## Order of work

1. Eval harness, domain-parametric, run first against the code profile's
   existing labeled pairs (sets the bar). Baselines (a) and the degraded
   walk need no jarvis changes — measure them immediately.
2. Jarvis substrate PRs: `sourceNodes` resolution, weight projection +
   generic `weight` edge attribute, projection latency. Each lands with a
   harness measurement.
3. Engine + `profiles/code.ts` — port of the org-context plan, measured
   against the harness. MCP tool exposure. Ambient corpus map replaces
   the flat all-names dump.
4. Loop B usage logging, including actor refs (ship with 3).
5. Loop A outcome weights + hub damping defaults (first measurable ranking
   upgrade; verify damping doesn't regress code-domain metrics). Bias
   seeds ("who is asking") A/B'd on the harness in the same phase.
6. Second profile (legal or support) against a real corpus — the proof the
   engine is actually domain-blind. Expect this to flush hidden couplings;
   budget for it.
7. Re-ranker, when loop B logs justify it.

## Success metrics

- precision@10 / recall@10 on the harness, per domain, per phase
- wrong-place rate proxy: tasks whose outcome leaves ⊄ retrieved set
- seed hit rate: % of queries where an alias/name match found the right
  lexicon node directly (lexicon health, per domain)
- hub escape rate: % of packages where a top-k slot is occupied by a node in
  the graph's top-percentile degree (should fall as damping/weights tune)
- retrieval latency budget: < 1s end-to-end (seed + walk + package), any
  domain
