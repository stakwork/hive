# Graph Memory Engine: Entity–Source–Concept

Status: design, net-new. Supersedes `graph-context-engine.md`. No backward
compatibility with prior substrates or ontologies is assumed.

## Design stance: code for invariants, agents for judgment

Every component here sits in one of two piles:

- **Compounds as models improve**: the graph itself (roles, provenance,
  edges), the store, outcome-event capture, usage logs, the eval harness.
  This is data and ground truth. A better model makes these *more*
  valuable, because it can do more with the same memory.
- **Compensates for model weakness**: trained re-rankers, learned edge
  predictors, packaging templates that guess what a consumer needs. These
  depreciate with every model generation — some are already obsolete.

The engine therefore keeps a deliberately small code surface: **code for
invariants, math, and measurement; agents for judgment.** Every judgment
seam is a tool boundary (CLI/tool verbs over the graph), so the system
upgrades for free when the model does. Nothing judgment-shaped is baked
into pipelines or trained weights.

Four subsystems total:

1. **Store + walk** (code): the role-typed graph, hybrid seeding, and a
   personalized-PageRank walk. Millisecond math — never make a model
   traverse a graph token by token.
2. **Counting + logging** (code): outcome reinforcement on edges and a
   query log. Mechanical, adversary-proof supervision.
3. **Librarian** (agent): nightly consolidation — merge, abstract, retire —
   through the same tools, inside hard coded guardrails.
4. **Harness** (code): fixed benchmark labels + trace outcomes; gates every
   change and every nightly mutation.

## Problem

A capable LLM already knows the domain — law, code, medicine. What it
lacks is the **corpus-specific delta**: what things are called here, how
work is organized here, what patterns and gotchas govern work here, and
what similar work looked like here before. Context-stuffing degrades with
corpus size; fine-tuning bakes a drifting corpus into static weights. Keep
knowledge in a graph, keep the model generic, retrieve per-task, and let
the graph get smarter over time.

Two ontology designs have been field-tested and both failed:

- **Rich typed ontology** (`Matter`, `Clause`, `Statute`, …): brittle NER,
  entity-resolution burden on every type, schema churn on every new
  document kind.
- **Single-type Concept graph**: maximally flexible — and semantically
  mush. "Acme Corp," "Delaware choice-of-law gotcha," and "the
  indemnification clause in the 2024 MSA" become the same kind of thing,
  so the system cannot apply strict identity to the first, soft
  consolidation to the second, and immutability to the third. Creation
  over-fits to agent traces with no digestion process; retrieval misses
  when edges are absent.

The resolution is a factoring, not a compromise: **three functional
roles**, closed forever, with all domain semantics in text and properties
— never in schema.

## The role model

Every node carries exactly one role. Roles are engine words; no domain
word ever appears in engine code (CI-enforced grep: `Clause`, `Matter`,
`File` appear only under `profiles/`).

### Entity — real-world referents

Parties, courts, statutes, jurisdictions, judges, products, people, repos.

- **Identity is strict.** Two nodes for one referent is a bug (split seed
  mass; both lose the walk). Entity resolution applies here and only here.
- **Natural hubs** ("Delaware"); the walk discounts them in ranking.
- **Mostly navigation and seeding**, rarely the payload.

### Source — evidence

Documents, chunks, filings, executed agreements, transcripts, tickets,
PRs, agent traces, benchmark tasks.

- **Immutable.** Never merged, never rewritten — at most `retired`
  (excluded from ranking, kept for provenance).
- **The leaves.** Outcome events touch Sources; loop A deposits weight on
  paths into Sources; the harness scores precision/recall over Sources;
  the working agent *reads* Sources.
- **Provenance-bearing**: document id, span, ingestion run.

### Concept — belief

Patterns, gotchas, playbooks, doctrine summaries, the `Law → practice
area → …` taxonomy, firm- and lawyer-specific know-how. Everything the
current Concept-only graph holds lands here.

- **Fallible and revisable.** Concepts are the system's beliefs, born
  over-fit from trace analysis. That is acceptable *because* the librarian
  digests them: merge near-duplicates, lift generalizations, retire the
  unsupported.
- **Provenanced to evidence.** Every Concept carries `derived_from` edges
  into supporting Sources. A Concept whose supporting Sources are all
  retired is stale by construction — a precise, computable signal
  impossible in a role-less graph.
- **Soft-hierarchical.** Overlapping layers (broad → specific) via
  `specializes` edges. No rigid tree; the flexibility of the Concept-only
  design survives intact, *inside* this role.

### Edges

Free-form: `relation` is text (embedded, never a categorical code), any
topology. Every edge carries:

| field        | meaning                                                         |
| ------------ | --------------------------------------------------------------- |
| `relation`   | free-text name ("cites", "amended_by", "specializes")           |
| `weight`     | numeric walk mass; default 1.0; reinforced by loop A            |
| `provenance` | `asserted` (ingestion) \| `derived` (librarian)                 |
| `status`     | `active` \| `retired`                                           |
| timestamps   | created, last-reinforced (drives decay)                         |

### Role invariants (the graph contract)

1. Every node has exactly one role, a `name` (+ optional aliases), text
   content, and an embedding.
2. Entities are unique per referent (the entity-resolution bar applies to
   Entities only).
3. Sources are immutable and provenance-bearing.
4. Concepts have ≥1 `derived_from` edge into Sources — a belief with no
   evidence is not admitted.
5. Some path exists from the seedable layer (Entities + Concepts) to
   Sources — otherwise walks rank beliefs and never reach evidence.
6. Structural/navigation nodes (taxonomy spine: `Law`, practice areas)
   are flagged `walkable: false`.

Ingestion — parsing, chunking, NER, role classification, embedding — is
out of engine scope. Role classification is itself a judgment seam: a
profile *prompt*, not profile code.

## Retrieval: tools, not packages

The engine's primary interface is a small set of verbs, exposed both as
agent tools and as a CLI (the same surface the librarian and operators
use):

- **`search(query) → refs`** — direct hybrid index lookup (fulltext +
  vector), no walk. For *locating* known things: "the node for Acme
  Corp," "does a concept about this already exist?" Also the librarian's
  duplicate-detection primitive. This is the same machinery `explore`
  uses to seed, exposed on its own.
- **`explore(query, actor?) → ranked refs`** — seed + walk (below), for
  *discovering* relevant things; returns scored
  `(ref, role, name, one-liner)` rows, grouped by role.
- **`neighbors(ref, relation?) → refs`** — local expansion,
  path-constrained stepping.
- **`read(ref) → node`** — full content; for Concepts, includes support
  summary (n supporting Sources, freshness) so beliefs are always
  *labeled as beliefs*, never presented as evidence.

The four map onto how a person uses a library: catalog lookup
(`search`), asking what's related to a topic (`explore`), browsing the
shelf around a book (`neighbors`), reading the book (`read`). One
interface for every actor in the system — consuming agents, child
readers, the librarian, and operators via the CLI. Mutation verbs
(`merge`, `create-parent`, `retire`, `link`) are a separate guarded
surface, available only to the librarian and ingestion.

Retrieval is a conversation, not a one-shot: an agent that gets a weak
result re-queries with different terms or expands from a promising node.
This removes the pressure for any single walk to be perfect — which is
precisely the pressure that once justified a trained re-ranker. A thin
default package (top-k per role, rendered once at task creation and cached
on the task) exists for cheap or non-agentic consumers; it is a
convenience wrapper over `explore`, not a subsystem.

### Relation to recursive graph-walking agents

The current production pattern — graph-walking agents spawning child
walkers so no single context holds everything — conflates two jobs, and
this design splits them:

- **Traversal (subsumed by the walk).** A recursive agent hierarchy is a
  token-expensive Monte Carlo approximation of relevance propagation:
  each child samples a subgraph and propagates its judgment upward. PPR
  computes that propagation exactly, over the whole graph, in
  milliseconds, for zero tokens. The context-window problem that forced
  the hierarchy dissolves rather than getting partitioned — no agent
  traverses the graph; `explore` returns only the ranked top-k. Child
  walkers also only ever find what is *reachable* from where the parent
  dropped them, so they inherit the missing-edge problem; soft seeds
  reach disconnected-but-relevant nodes no recursive edge-following can.
- **Comprehension (still agents, now cheaper).** Reading and judging
  large volumes of retrieved content still fans out to child agents —
  but they are readers with `read`/`neighbors` (and their own `explore`
  subquestions), not walkers. Tokens go to comprehension, never
  navigation.

**Seed→walk is navigation; agents are comprehension.** One residual for
agent-driven stepping: PPR propagates mass blindly and cannot express
conditional traversal ("follow this citation chain only while each
document amends the prior"). Path-constrained hops remain an agent
stepping through `neighbors` — local and bounded, never a
load-everything fan-out.

### Seed — a personalization vector, not a seed list

Adopted from HippoRAG 2's core finding: **do not require an edge (or an
exact match) for a node to receive walk mass.** Seeding outputs a full
teleport vector `p`:

- **Hard seeds**: exact/alias fulltext matches, restricted to Entities +
  Concepts. High mass each (~60%).
- **Soft seeds**: top-m embedding neighbors of the query (Entities +
  Concepts only — never raw Source chunks, which would collapse the walk
  into vector search), weighted by similarity, temperature-scaled (~25%).
  This is the missing-edge bridge: a Concept semantically near the query
  gets mass even if no edge connects it to anything matched.
- **Bias seeds** ("who is asking"): caller-supplied refs — the attorney's
  active matters — at a reserved fraction (~15%).

If no hard seeds exist, soft seeds absorb their mass — graceful
degradation toward semantic search. The split is one tunable, A/B'd on
the harness.

### Walk — weighted personalized PageRank, role-aware

PPR (damping α ≈ 0.85) over the in-memory graph, consuming edge `weight`,
with inverse-degree normalization (an edge into a node touched by
everything carries less per-walk mass), a ranking discount on Entities
(connectors, rarely the payload), and hard exclusion of `walkable: false`
structural nodes — `Law` must never win a walk.

Why PPR remains the backbone: embedding search finds nodes that *sound
like* the query; PPR finds nodes *structurally entangled* with the seeds —
the side-letter that modifies the clause nobody quoted. The
personalization vector fixes PPR's brittleness to missing edges; PPR fixes
embedding search's blindness to structure. Neither alone survives the
harness. Latency budget: < 250 ms per `explore`.

### The ambient map

~1–2k tokens, regenerated nightly by the librarian (a writing task, not a
template): a ranked hierarchical digest of the structural spine + top
Entities/Concepts by global centrality and recency, hard token budget. An
index of *names*, never content — it teaches the model the corpus's
vocabulary, which directly improves seeding.

## Learning

### Loop A — outcome counting (code)

On each outcome event, increment `weight` along edges on the task →
artifact → touched-Sources paths, and on `derived_from` edges of Concepts
that were retrieved *and* whose Sources were touched. Exponential recency
decay (half-life ~90 days, profile-tuned) applied at read time. A pattern
seen twice stays noise; seen fifty times, it dominates the walk. Zero
training infrastructure.

### Loop B — usage logging (code)

One table, from the first query ever served:
`graph_queries(query_text, seeds, returned_refs, consumer, task_ref,
actor_ref, profile_id, ts)`. Joined against later outcome events it
yields precision@k time series, recall-ceiling measurements
(touched-but-never-retrieved), and merge candidates for the librarian
(co-retrieved, never co-used).

### The librarian — consolidation as an agent (judgment)

Nightly agent run, driving the same CLI verbs plus mutation verbs
(`merge`, `create-parent`, `retire`, `link`). Its brief: digest episodic
memory into semantic memory.

- **Merge** near-duplicate Concepts (inputs it queries: embedding
  similarity, shared neighbors, loop-B co-retrieved-never-co-used). The
  librarian writes the merged text; the merged node takes the union of
  edges (`provenance: derived`); originals tombstone-redirect.
- **Abstract**: lift recurring patterns — clusters of specific Concepts
  supported across ≥ k distinct matters — into parent Concepts
  (`derived_from` → union of supporting Sources; children kept, linked
  `specializes`). This is the fix for trace-overfit creation: specifics
  persist as leaves; the retrievable mid-layer is *induced*.
- **Resolve** duplicate Entities (strict, evidence-based merge — the
  opposite discipline from Concept merging, which is why roles exist).
- **Retire** Concepts with no fresh support and no retrieval/outcome
  activity. Retired ≠ deleted: kept for provenance, excluded from walks.
- **Propose edges** it finds obviously missing while reading
  (`provenance: derived`, modest initial weight — loop A confirms or
  decay starves).

Hard guardrails in code, not in the prompt: Sources immutable; Entities
merge only with evidence; every mutation logged with provenance and
reversible; per-night mutation budget; and the harness runs before/after
each session — regression beyond threshold auto-reverts the night's
mutations and alerts. Judgment is the model's; invariants are mechanical.

The librarian is also why this design *leans into* model progress: merge
quality, abstraction quality, and the ambient map all improve with every
model upgrade, with zero engine changes.

### Deliberately absent: trained retrieval models

No trained re-ranker, no learned link predictor, no GNN — cut, not
deferred, for cause:

- Soft-seed personalization already bridges missing edges at query time;
  a graph-side edge predictor would solve the same symptom twice, at the
  cost of training pipelines plus the closed-loop-degeneration defenses
  they require. Machinery whose main complexity is defending against
  itself is a smell.
- An agent reading `explore`'s top-50 *is* a re-ranker — per-task,
  dynamic, and upgraded free with every model generation.
- Iterative tool-driven retrieval removes the one-shot-perfection
  pressure that motivated trained rankers in the first place.

If the harness ever shows a persistent, named gap that agentic retrieval
plus loop A cannot close, revisit — as a measured decision against that
gap, not as roadmap.

## Supervision and outcome events

Two signals, two jobs:

- **Benchmark suites** (task → expected context/answer): the *harness*
  labels. Fixed, replayable, immune to feedback loops — the regression
  gate for every change and every librarian session.
- **Real usage traces**: the *outcome events* for loops A and B. Legal's
  native event (filed brief / executed agreement → Sources it cites) is
  sparse and lagged, so profiles declare weighted proxy events: citations
  in shipped drafts, attorney accept/reject of retrieved context, a
  retrieved Source actually opened/quoted during the task.

| Outcome signal quality   | What the deployment gets                           |
| ------------------------ | -------------------------------------------------- |
| Dense + machine-readable | Full design: reinforcement + librarian + harness   |
| Sparse/lagged + proxies  | Full design, slower convergence                    |
| Benchmarks only          | Retrieval + librarian + harness; loop A idles      |
| None                     | Static retrieval (still most of the value)         |

Outcome detection is always code — supervision is never delegated to a
model; labels must not argue back.

## Substrate (greenfield decision)

**Postgres as the durable store; an in-process graph service holding the
walkable graph in memory (CSR adjacency); pgvector for embeddings;
Postgres fulltext for lexical seeding.** No dedicated graph database.

- **Scale envelope.** This graph is distilled knowledge, not raw corpus:
  ~10⁵–10⁶ nodes, ~10⁶–10⁷ edges even at large deployments — tens to
  hundreds of MB as CSR. Power-iteration PPR runs in ~10–100 ms
  in-process, inside the budget with no projection-caching machinery.
- **Arbitrary personalization vectors are the point.** Off-the-shelf
  GDS-style `sourceNodes` gives uniform mass over a node list; the soft-
  seed design needs per-node teleport weights. In-process PPR makes the
  vector a first-class input for ~100 lines of code.
- **Everything else is SQL.** Loop A is `UPDATE … SET weight`; loop B is
  an insert + join; librarian mutations are transactions with provenance.
  One database, one backup story, no dual-write consistency problem.
- **Considered and rejected**: Neo4j+GDS (operational weight, uniform-mass
  personalization, projection latency), Memgraph (a second stateful
  system for a graph that fits in RAM), embedded graph DBs (ecosystem
  risk; Postgres is needed anyway for logs/outcomes). If the graph
  outgrows RAM, swap power iteration for forward-push PPR before any
  database migration.

Core tables (spec-level):

```sql
nodes(id, role,            -- 'entity' | 'source' | 'concept'
      name, aliases text[], body text, props jsonb,
      walkable bool default true, status,
      embedding vector, tsv tsvector,
      created_at, updated_at)

edges(id, src, dst, relation text,
      weight real default 1.0,
      provenance,            -- 'asserted' | 'derived'
      status, created_at, last_reinforced_at)

graph_queries(id, query_text, seeds jsonb, returned jsonb,
              consumer, task_ref, actor_ref, profile_id, ts)

outcome_events(id, task_ref, artifact_ref, touched_source_ids bigint[],
               event_kind, profile_id, ts)

graph_mutations(id, actor,  -- 'ingestion' | 'librarian' | 'loop_a'
                verb, refs jsonb, inverse jsonb, session_id, ts)
```

The graph service loads active walkable nodes/edges into CSR at boot,
refreshes incrementally, and exposes the retrieval verbs (tools + CLI)
plus guarded mutation verbs. Engine code lives in its own service module
with `profiles/` beside it.

## Domain profile

After the simplification pass, a profile is mostly prompts and detectors:

```ts
interface DomainProfile {
  // Judgment seams — prompts, upgraded free with the model:
  classifyPrompt: string;      // ingested item → role + name + body
  librarianBrief: string;      // domain framing for the nightly session
  ambientMapBrief: string;     // how to render the corpus map

  // Code — must be adversary-proof:
  outcomeEvents: Array<{
    detect: (event) => boolean;
    touchedSources: (artifact) => NodeRef[];
    kind: string; weight: number;   // primary vs proxy
  }>;
  isStructural: (node) => boolean;  // taxonomy spine → walkable:false
  actorSeeds?: (actor: ActorRef) => NodeRef[];

  // Knobs (few, harness-gated): seed mass split, decay half-lives,
  // librarian mutation budget, ambient map token budget.
  tuning?: Partial<EngineTuning>;
}
```

## First profile: legal

- **Ingestion** (profile's pipeline): documents → chunked **Sources**
  (immutable, spans recorded); NER + resolution → **Entities** (parties,
  courts, statutes, judges, jurisdictions); agent-trace analysis →
  **Concepts**, each `derived_from` the traces/documents that produced
  them. The existing Concept-only graph migrates via a batch
  role-classification pass (the roles are natural categories; a node that
  resists classification is usually two nodes).
- **Structural spine**: `Law` → practice areas → doctrine areas,
  `walkable: false`; renders the ambient map.
- **Outcome events**: primary — filed brief / executed agreement → cited
  or incorporated Sources. Proxies (lower weight) — citations in shipped
  drafts, attorney accept/reject, Source opened/quoted during task.
- **Known strains, stated**: NER noise makes the Entity-resolution bar
  the hard part of ingestion; super-hubs (landmark cases, mega-parties)
  make the Entity ranking discount and structural exclusion mandatory.

## Evaluation harness

Runs from day one — benchmark labels already exist.

- **Labels**: benchmark suites (fixed regression set) + trace outcomes
  (growing set; temporal split, train old / test new, never random).
- **Metrics**: precision@10 / recall@10 over Sources; seed hit rate
  (lexicon health); hub escape rate (top-percentile-degree nodes in
  top-k; should fall); belief-staleness rate (% retrieved Concepts with
  no fresh support); librarian digestion health (Concept count vs.
  retrieval coverage — a graph that only grows is not being digested);
  `explore` latency.
- **Baseline ladder — each rung must beat the previous to ship, in every
  deployed domain:**
  (a) embedding similarity only →
  (b) unweighted PPR, hard seeds only →
  (c) + soft-seed personalization →
  (d) + loop-A weights + role-aware ranking →
  (e) + agentic multi-turn retrieval (measured end-to-end on task
  success, not per-query).
  A change that helps one domain and hurts another is a profile change,
  never an engine change.
- **Librarian gate**: benchmark suite before/after every nightly session;
  regression beyond threshold auto-reverts the session's mutations
  (from `graph_mutations.inverse`) and alerts.

## Order of work

1. **Substrate**: Postgres schema, CSR graph service, weighted PPR with
   arbitrary personalization vectors, hybrid seeding. Latency test at
   target scale with a synthetic graph.
2. **Harness first**: benchmark suites wired; measure rungs (a)–(b)
   before anything adaptive exists. Sets the bar.
3. **Migration + ingestion**: role-classification pass over the existing
   Concept graph; legal ingestion honoring the contract.
4. **Retrieval v1**: tools/CLI (`search`, `explore`, `neighbors`,
   `read`), soft seeds, ambient map, thin default package. Loop B ships in the same
   change. Measure rung (c).
5. **Loop A**: outcome events (primary + proxies) → reinforcement +
   decay. Measure rung (d); A/B bias seeds here.
6. **Librarian**: staged — merge only, then retire, then abstraction —
   each stage harness-gated with auto-revert.
7. **Agentic retrieval** in the consuming agents (multi-turn tool use
   replacing one-shot packages where the consumer supports it). Measure
   rung (e).
8. **Second profile** (code or support) against a real corpus — the
   proof the engine is domain-blind. Budget for it to flush hidden
   couplings.

## Principles

- **Code for invariants, math, and measurement; agents for judgment.**
  Every judgment seam is a tool boundary; the engine's code surface
  should *shrink* over time as models improve.
- **The graph is the memory; nothing accumulates in weights.** Every
  derived artifact is rebuildable from graph + logs.
- **LLMs write content, never labels.** Supervision comes only from
  outcomes and benchmarks — signals that can't argue back.
- **Derived structure is proposed, never trusted.** Provenance + modest
  weight + decay; loop A promotes, silence demotes.
- **Beliefs are labeled as beliefs.** Sources are the evidence.
- **No domain words in engine code.** CI-enforced grep.
- **No always-in-context dumps.** The ambient map is ranked, budgeted,
  an index of names.
- **No pretense that ingestion is solved.** The contract is stated; a
  domain that can't meet a bar gets the documented degraded tier, not a
  silent quality cliff.

## Success metrics

- precision@10 / recall@10 over Sources, per domain, per baseline rung
- end-to-end task success with agentic retrieval (rung e) vs. one-shot
- seed hit rate; hub escape rate; belief-staleness rate
- digestion health: Concept growth vs. retrieval coverage
- librarian revert rate (harness-triggered auto-reverts per month —
  should be near zero; rising means the guardrails, not the model, are
  doing the work)
- `explore` latency: < 250 ms at target scale
