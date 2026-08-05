# Graph Memory Engine: Entity–Source–Concept

Status: design, net-new. Supersedes `graph-context-engine.md`. No backward
compatibility with prior substrates or ontologies is assumed; where an idea
from the old doc survives, it survives because it earned it.

## Problem

A capable LLM already knows the domain — law, code, medicine. What it lacks
is the **corpus-specific delta**: what things are called here, how work is
organized here, what patterns and gotchas govern work here, and what similar
work looked like here before. Context-stuffing degrades with corpus size;
fine-tuning bakes a drifting corpus into static weights. The solution shape
is stable: keep knowledge in a graph, keep the model generic, retrieve
per-task, and make the graph itself get smarter over time.

Two ontology designs have now been field-tested and both failed:

- **Rich typed ontology** (`Matter`, `Clause`, `Statute`, `Filing`, …):
  brittle NER, entity-resolution burden on every type, schema arguments on
  every new document kind, and per-domain forks of everything downstream.
- **Single-type Concept graph**: maximally flexible, cheap to create from
  agent-trace analysis — and semantically mush. "Acme Corp," "Delaware
  choice-of-law gotcha," and "the indemnification clause in the 2024 MSA"
  become the same kind of thing, so the system cannot apply strict identity
  to the first, soft consolidation to the second, and immutability to the
  third. Creation over-fits to traces with no digestion process; retrieval
  misses when edges are absent because edges are the only signal.

The resolution is not a compromise but a factoring: the engine needs exactly
**three functional roles**, closed forever, with all domain semantics in
text and properties — never in schema.

## The role model

Every node carries exactly one role. Roles are engine words; no domain word
ever appears in engine code (grep-enforceable: `Clause`, `Matter`, `File`
appear only under `profiles/`).

### Entity — real-world referents

Parties, courts, statutes, jurisdictions, judges, products, people, repos.

- **Identity is strict.** Two nodes for one referent is a bug (split seed
  mass; both lose the walk). Entity resolution applies here and only here.
- **Natural hubs.** "Delaware" is legitimately high-degree; the walk damps
  edges into Entities by default (see Hub handling).
- **Mostly navigation and seeding**, rarely the payload. An Entity's value
  is that queries land on it and walks route through it.

### Source — evidence

Documents, chunks, filings, executed agreements, transcripts, tickets, PRs,
agent traces, benchmark tasks.

- **Immutable.** Sources are never merged, never rewritten, never decayed
  into nonexistence — at most `retired` (excluded from packaging, kept for
  provenance).
- **The leaves.** Outcome events touch Sources; loop A deposits weight on
  paths into Sources; the harness scores precision/recall over Sources; the
  drafting agent *reads* Sources.
- **Provenance-bearing.** Every Source records where it came from (document
  id, span, ingestion run).

### Concept — belief

Patterns, gotchas, playbooks, practice knowledge, doctrine summaries, the
`Law → practice area → …` taxonomy, firm-specific and lawyer-specific
know-how. Everything the current Concept-only graph holds lands here.

- **Fallible and revisable.** Concepts are the system's beliefs, born
  over-fit from trace analysis. That is acceptable *because* the
  consolidation loop digests them: merge near-duplicates, induce
  generalizations, decay the unsupported.
- **Provenanced to evidence.** Every Concept carries `derived_from` edges
  into the Sources that support it. A Concept whose supporting Sources are
  all retired or superseded is stale by construction — a precise, computable
  staleness signal impossible in a role-less graph.
- **Soft-hierarchical.** Concepts form overlapping layers (broad →
  specific) via `specializes` edges. No rigid tree; the flexibility of the
  Concept-only design survives intact, *inside* this role.

### Edges

Edges are free-form: `relation` is text (embedded, never a categorical
code), any topology. Every edge carries:

| field         | meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `relation`    | free-text relation name ("cites", "amended_by", "specializes") |
| `weight`      | numeric walk mass; default 1.0; reinforced by loop A           |
| `provenance`  | `asserted` (ingestion) \| `derived` (consolidation) \| `inferred` (densification) |
| `confidence`  | [0,1]; 1.0 for asserted; model score for inferred              |
| `status`      | `active` \| `retired`                                          |
| timestamps    | created, last-reinforced (drives decay)                        |

Provenance is load-bearing, not bookkeeping: it is what lets learned
structure be proposed without being trusted (see Densification) and what
makes every learning loop auditable and reversible.

### Role invariants (the graph contract)

1. Every node has exactly one role, a `name` (+ optional aliases), text
   content, and an embedding.
2. Entities are unique per referent (entity-resolution bar applies to
   Entities only).
3. Sources are immutable and provenance-bearing.
4. Concepts have ≥1 `derived_from` edge into Sources (enforced at creation;
   a belief with no evidence is not admitted).
5. Some path exists from the seedable layer (Entities + Concepts) to
   Sources — otherwise walks rank beliefs and never reach evidence.
6. Structural/navigation nodes (taxonomy spine: `Law`, practice areas) are
   flagged `walkable: false`.

Ingestion — parsing, chunking, NER, role classification, embedding — is out
of engine scope. The contract is the interface; the profile's pipeline is
how a domain honors it.

## Retrieval: Seed → Walk → Package

Three steps at query time. Latency budget: < 250 ms end-to-end (the
substrate below makes this comfortable, not aspirational).

### 1. Seed — build a personalization vector, not a seed list

The single biggest retrieval upgrade over the previous design, adopted from
HippoRAG 2's core finding: **do not require an edge (or an exact match) for
a node to receive walk mass.** The output of seeding is a full
personalization vector `p` over nodes:

- **Hard seeds**: exact/alias fulltext matches on the query, restricted to
  Entities + Concepts. High mass each.
- **Soft seeds**: top-m embedding neighbors of the query (again Entities +
  Concepts only — never raw Source chunks, which would collapse the walk
  into vector search), each weighted by similarity, temperature-scaled.
  This is the missing-edge bridge: a Concept semantically near the query
  gets teleport mass even if no edge connects it to anything matched.
- **Bias seeds** ("who is asking"): caller-supplied node refs — the
  attorney's active matters, the developer's recent features — at a
  reserved fraction of mass.

Default mass split: 60% hard, 25% soft, 15% bias (profile-tunable; A/B'd on
the harness). If no hard seeds exist, soft seeds absorb their mass — the
system degrades toward semantic search instead of failing.

### 2. Walk — weighted personalized PageRank, role-aware

Personalized PageRank with damping α ≈ 0.85 over the in-memory graph
(substrate below), consuming edge `weight`, with:

- **Inverse-degree normalization** (TF-IDF for edges: an edge into a node
  touched by everything carries less per-walk mass).
- **Role-aware damping**: outgoing mass *through* Entities flows normally
  (they are connectors), but Entities' own scores are discounted in ranking
  (they are rarely the payload). Profile-tunable multiplier per role.
- **Structural exclusion**: `walkable: false` nodes neither receive nor
  hold mass; the taxonomy spine organizes the ambient map, never the walk.
  This is stronger than damping and deliberate: `Law` must never win a
  walk.

Why PPR remains the backbone: embedding search finds nodes that *sound
like* the query; PPR finds nodes *structurally entangled* with the seeds —
the side-letter that modifies the clause nobody quoted. The personalization
vector fixes PPR's brittleness to missing edges; PPR fixes embedding
search's blindness to structure. Neither alone survives the harness.

### 3. Package — role buckets with epistemic labeling

Roles give packaging a universal shape (counts per profile/consumer):

- **Who's involved** — top Entities with their relations to the seeds.
- **What to know** — top Concepts, *labeled as beliefs*, each with support
  summary (n supporting Sources, freshness). The consuming agent knows it
  is reading distilled belief, not ground truth.
- **What to read** — top Sources: the evidence itself, with provenance.

Per-consumer altitude views filter buckets and counts (partner: matters +
postures; associate: clauses + exemplar filings; drafting agent: chunk text
+ citations). The profile supplies templates; the engine ranks and fills.

### Two tiers (unchanged in spirit from the prior design)

- **Ambient map** (~1–2k tokens, regenerated nightly, cached): ranked
  hierarchical digest of the taxonomy spine + top Entities/Concepts by
  persisted global centrality + recency, hard token budget. An index of
  *names*, never content — it teaches the model the corpus's vocabulary,
  which directly improves seeding.
- **Retrieved tier**: Seed→Walk→Package **once at task creation**, cached
  on the task — consolidation-style read-in, not per-message retrieval.
  Removes walk latency from the hot path entirely.

## Learning: four loops

Ordered by leverage, not by glamour. Every loop mutates only with
provenance and decays what it cannot re-justify. The graph is the memory;
every model is disposable and rebuildable from graph + logs.

### Loop A — outcome counting (edge reinforcement)

On each outcome event (profile-declared; see Supervision), increment
`weight` along edges on the task → artifact → touched-Sources paths and on
`derived_from` edges of Concepts that were retrieved *and* whose Sources
were touched. Exponential recency decay (half-life profile-tuned,
default ~90 days) applied at read time. A pattern seen twice stays noise;
seen fifty times, it dominates the walk. Zero training infrastructure.

### Loop B — usage logging (the label factory)

One table, from the first query the engine ever serves:
`graph_queries(query_text, personalization_vector_summary, returned_refs,
consumer, task_ref, actor_ref, profile_id, ts)`. Joined against later
outcome events, it yields for free: precision@k time series, ranking
labels (retrieved∧touched = positive; retrieved∧untouched = hard
negative), recall-ceiling measurements (touched∧never-retrieved), and
merge candidates (co-retrieved, never co-used).

### Loop C — consolidation (the creation fix)

Nightly. This is what makes creation stop over-fitting: trace-born Concepts
are episodic memory — specific, redundant, acceptable — and consolidation
is the digestion into semantic memory. Three passes, strictly per-role:

- **Merge (Concepts only).** Candidate pairs by embedding similarity ∧
  shared-neighbor Jaccard ∧ loop-B co-retrieved-never-co-used counts. An
  LLM adjudicates and writes the merged text; the merged node takes the
  union of edges (provenance `derived`), originals become tombstones
  redirecting to it. The LLM writes *content*, never labels — supervision
  stays outcome-only.
- **Abstract (Concepts only).** Cluster specific Concepts (community
  detection on the Concept subgraph ∩ embedding clusters). For clusters
  supported across ≥ k distinct matters/Sources, induce a parent Concept
  (LLM-written generalization), `derived_from` → union of supporting
  Sources, children linked via `specializes` and *kept*. Recurring
  trace-level patterns are thereby lifted into the retrievable mid-layer —
  the layer that makes seeds land well.
- **Resolve (Entities only).** Blocking by name/alias trigram + embedding;
  strict adjudication; hard merge. Opposite discipline from Concept
  merging, which is exactly why roles exist.
- **Prune (Concepts only).** Retirement score from retrieval count,
  outcome count, and support freshness (all `derived_from` Sources retired
  ⇒ stale). Retired ≠ deleted: excluded from walks, kept for provenance.

Sources are never touched by consolidation. Every mutation is logged and
reversible; the harness runs before/after each nightly pass and a
regression beyond threshold auto-halts consolidation and alerts.

### Loop D — densification (the retrieval-edge fix, graph-side)

Nightly link prediction proposes edges the ingestion missed. Two stages,
the second gated on the first plateauing:

1. **Heuristic ensemble (ships first).** Candidates: unconnected
   high-embedding-similarity pairs among Entities/Concepts + pairs
   co-retrieved with high walk scores. Features: cosine similarity,
   Adamic–Adar, common-neighbor count, pairwise PPR affinity, role-pair,
   degree percentiles. Model: gradient-boosted trees, pairwise objective;
   positives = asserted/outcome-reinforced edges (temporal split),
   hard negatives = high-similarity never-co-used pairs. Trains in
   seconds; fully interpretable.
2. **Schema-free GNN (NBFNet/ULTRA-style), gated.** Node text embeddings
   as features, relation names as text embeddings — no per-type
   parameters, so new relation kinds or a new domain need no retraining
   schema. Ships per-domain only when it beats the heuristic ensemble on
   that domain's harness.

**Predicted edges are proposals, never authority**: materialized with
`provenance: inferred`, `weight = confidence × base` (low), and an
aggressive decay half-life. Loop A confirms the useful ones (outcome
reinforcement outruns decay) and starves the rest. This is the immune
system against the closed-loop failure mode — retrieval following
predicted edges → logs reflecting them → retraining reinforcing them —
which is the single biggest risk in "the graph reorganizes itself
nightly." Inferred edges that loop A never confirms die on their own.

### Re-ranker (later, gated)

Re-scores the walk's top-200 before packaging. Features are computable
from the contract alone (PPR score, embedding similarity, hop distance,
loop-A counts, degree percentile, role and relation names as text
embeddings, same-container flag via profile predicate). LambdaMART or a
2-layer MLP; retrained nightly from scratch; per-domain checkpoints;
ships per-domain only when it beats the incumbent walk on that domain's
harness. Cold-start bar: no training below a few thousand loop-B triples.

## Supervision and outcome events

Both available signals are used, for different jobs:

- **Benchmark suites** (task → expected context/answer pairs): the
  *harness* labels. Fixed, replayable, immune to feedback loops — the
  regression gate for every loop and every model. Split temporally where
  timestamps exist; never random.
- **Real usage traces** (drafts shipped, citations used, attorney
  accept/reject, concept-quoted-into-work-product): the *outcome events*
  for loops A and B. Legal's native event (filed brief / executed
  agreement → documents it cites) is sparse and lagged, so the profile
  declares proxy events to densify: citations in shipped drafts,
  explicit accept/reject of retrieved context, retrieved-Source actually
  opened/quoted during the task.

| Outcome signal quality      | What the deployment gets                          |
| --------------------------- | ------------------------------------------------- |
| Dense + machine-readable    | Full design: all four loops + gated models        |
| Sparse/lagged + proxies     | Full design, slower convergence                   |
| Benchmarks only             | Retrieval + consolidation + harness; loop A idles |
| None                        | Static Seed→Walk→Package (still most of the value) |

A domain without outcome events has not broken the engine — it has opted
out of the reinforcement half. State this per deployment; no silent cliffs.

## Substrate (greenfield decision)

**Postgres as the durable store; an in-process graph service holding the
walkable graph in memory (CSR adjacency); pgvector for embeddings;
Postgres fulltext for lexical seeding.** No dedicated graph database.

Why this beats the alternatives for *this* workload:

- **Scale envelope.** This graph is distilled knowledge, not raw corpus:
  even a large deployment is ~10⁵–10⁶ nodes, ~10⁶–10⁷ edges. As CSR
  arrays that is tens to hundreds of MB. Power-iteration PPR (~20
  iterations × edges) runs in ~10–100 ms in-process — inside the 250 ms
  budget with no projection-caching machinery, which was the standing
  latency blocker in the previous jarvis/GDS design.
- **Arbitrary personalization vectors are the point.** The seed step's
  core upgrade — similarity-weighted soft mass over many nodes — needs
  per-node teleport weights. Off-the-shelf GDS-style `sourceNodes` gives
  uniform mass over a node list; bending it to weighted vectors was
  already a PR-sized gap last time. In-process PPR makes the
  personalization vector a first-class input for ~100 lines of code.
- **The learning loops are batch SQL + in-process compute.** Loop A is
  `UPDATE … SET weight`, loop B is an insert + join, loops C/D are
  nightly jobs reading Postgres and writing proposals back. One database,
  one backup story, transactional mutations with provenance — no
  dual-write consistency problem between a graph DB and a relational log
  store.
- **Considered and rejected**: Neo4j+GDS (operational weight, licensing,
  uniform-mass personalization, projection latency); Memgraph (better
  latency, still a second stateful system for a graph that fits in RAM);
  embedded graph DBs (ecosystem risk, and we need Postgres anyway for
  logs/outcomes). If the graph ever outgrows RAM, the walk service swaps
  to forward-push PPR with sub-linear locality before any database
  migration is warranted.

Core tables (spec-level):

```sql
nodes(id, role,            -- 'entity' | 'source' | 'concept'
      name, aliases text[], body text, props jsonb,
      walkable bool default true, status, abstraction_level int,
      embedding vector, tsv tsvector,
      created_at, updated_at)

edges(id, src, dst, relation text,
      weight real default 1.0, confidence real default 1.0,
      provenance,            -- 'asserted' | 'derived' | 'inferred'
      status, created_at, last_reinforced_at)

graph_queries(id, query_text, seeds jsonb, returned jsonb,
              consumer, task_ref, actor_ref, profile_id, ts)

outcome_events(id, task_ref, artifact_ref, touched_source_ids bigint[],
               event_kind, profile_id, ts)
```

The graph service loads active, walkable nodes/edges into CSR at boot,
applies incremental updates on a short interval, and exposes:
`seed(query, actor) → p-vector`, `walk(p) → scored nodes`,
`package(scored, consumer) → context block`, plus batch entry points for
the nightly loops. Engine code lives in its own service module with
`profiles/` beside it; the grep rule (no domain words in engine) is CI.

## Domain profile interface

Everything the engine must not know, in one object. Note what changed from
the old design: type lists became role-scoped predicates and classifiers.

```ts
interface DomainProfile {
  // Ingestion-side: classify an ingested item into a role + node fields.
  // (Runs in the profile's pipeline, not the engine; declared here so the
  // contract is visible in one place.)
  classify: (item: IngestedItem) => { role: Role; name: string; body: string; props: object };

  // Which nodes are structural spine (walkable=false), e.g. taxonomy roots.
  isStructural: (node) => boolean;

  // Packaging: per-consumer bucket counts + prose templates.
  altitudeViews: Record<ConsumerId, { entities: number; concepts: number; sources: number }>;
  template: (pkg: Package, consumer: ConsumerId) => string;

  // Outcome detection: the domain's "merged PR" + declared proxy events.
  outcomeEvents: Array<{
    detect: (event) => boolean;
    touchedSources: (artifact) => NodeRef[];
    kind: string;   // primary vs proxy, for weighting in loop A
    weight: number;
  }>;

  // "Who is asking": resolve an actor to bias-seed refs.
  actorSeeds?: (actor: ActorRef) => NodeRef[];

  // Ambient map: hierarchy (structural spine order) + token budget.
  corpusMap?: { budgetTokens: number };

  // Knobs, all harness-gated: seed mass split, role damping multipliers,
  // decay half-lives, consolidation thresholds.
  tuning?: Partial<EngineTuning>;
}
```

## First profile: legal

- **Ingestion** (profile's pipeline): documents → chunked **Sources**
  (immutable, spans recorded); NER + resolution pass → **Entities**
  (parties, courts, statutes, judges, jurisdictions); agent-trace analysis
  → **Concepts** (patterns, gotchas, playbooks) each with `derived_from`
  into the trace/documents that produced them. The existing Concept graph
  migrates via a batch LLM role-classification pass — the three roles are
  natural categories, and a node that resists classification is usually
  two nodes.
- **Structural spine**: `Law` → practice areas → doctrine areas;
  `walkable: false` throughout; renders the ambient map.
- **Outcome events**: primary — filed brief / executed agreement →
  cited/incorporated Sources. Proxies (declared, lower weight) —
  citations in shipped drafts, attorney accept/reject of retrieved
  context, Source opened/quoted during task.
- **Altitude views**: partner (matters + one-line postures), associate
  (key clauses + exemplar filings), drafting agent (chunk text +
  citations + governing Concepts with support counts).
- **Known strains, stated**: NER noise makes the Entity-resolution bar
  the hard part of ingestion; super-hubs (landmark cases, mega-parties)
  make role damping + structural exclusion mandatory, not optional.

## Evaluation harness

Domain-parametric; runs from day one because benchmark labels already
exist (no waiting for loop B to accumulate).

- **Labels**: benchmark suites (fixed regression set) + trace outcomes
  (growing set; temporal split, train old / test new, never random).
- **Metrics**: precision@10 / recall@10 over Sources; seed hit rate
  (% queries where a hard seed found the right node — lexicon health);
  hub escape rate (% packages with a top-percentile-degree node in top-k;
  should fall as damping tunes); belief-staleness rate (% packaged
  Concepts with no fresh support); end-to-end latency.
- **Baseline ladder — each rung must beat the previous to ship, in every
  deployed domain:**
  (a) embedding similarity only →
  (b) unweighted PPR, hard seeds only →
  (c) + soft-seed personalization vector →
  (d) + loop-A weights + role damping →
  (e) + densified edges →
  (f) + re-ranker / GNN.
  A change that helps one domain and hurts another is a profile change,
  never an engine change.
- **Loop gate**: nightly consolidation/densification runs the benchmark
  suite before/after; regression beyond threshold auto-halts the loop.

## Order of work

1. **Substrate**: Postgres schema, in-process graph service (CSR load +
   incremental refresh), weighted PPR with arbitrary personalization
   vectors, hybrid seeding (fulltext + pgvector). Latency test at target
   scale with synthetic graph.
2. **Harness first**: implement against benchmark suites; measure
   baselines (a) and (b) before anything adaptive exists. Sets the bar.
3. **Migration + ingestion**: role-classification pass over the existing
   Concept graph; legal ingestion adapters honoring the contract
   (Entity resolution, Source immutability, Concept `derived_from`).
4. **Retrieval v1**: soft-seed personalization + role-aware walk +
   packaged buckets + ambient map. Loop B logging ships in the same
   change (the label factory must not lag the first query). Measure rung
   (c).
5. **Loop A**: outcome events (primary + proxies) → edge reinforcement +
   decay. Measure rung (d); A/B bias seeds in the same phase.
6. **Loop C**: consolidation, staged — merge, then prune, then
   abstraction — each stage individually harness-gated with auto-halt.
7. **Loop D stage 1**: heuristic densifier with inferred-edge provenance
   + decay. Measure rung (e).
8. **Gated models**: re-ranker when loop-B triples justify it; GNN
   densifier when the heuristic plateaus. Per-domain rollout decisions,
   never an engine flag day.
9. **Second profile** (code or support) against a real corpus — the
   proof the engine is domain-blind. Budget for it to flush hidden
   couplings.

## Principles (deliberate exclusions)

- **The graph is the memory; models are disposable.** Everything learned
  is rebuildable from graph + logs in minutes. No knowledge accumulates
  in weights.
- **LLMs write content, never labels.** Consolidation uses an LLM to
  write merged/abstracted text; supervision comes only from outcomes and
  benchmarks — signals that can't argue back.
- **Learned structure is proposed, never trusted.** Provenance + low
  initial weight + decay; loop A promotes, silence demotes.
- **Beliefs are labeled as beliefs.** Packages never present a Concept
  as evidence; Sources are the evidence.
- **No domain words in engine code.** CI-enforced grep.
- **No always-in-context dumps.** The ambient map is ranked, budgeted,
  and an index of names.
- **No pretense that ingestion is solved.** The contract is stated; a
  domain that can't meet a bar gets the documented degraded tier, not a
  silent quality cliff.

## Success metrics

- precision@10 / recall@10 over Sources, per domain, per baseline rung
- seed hit rate; hub escape rate; belief-staleness rate (defined above)
- consolidation health: Concept count growth vs. retrieval coverage
  (a graph that only grows is not being digested)
- inferred-edge survival rate: % of loop-D edges reinforced by loop A
  within one half-life (low survival ⇒ densifier is hallucinating)
- retrieval latency: < 250 ms end-to-end at target scale
