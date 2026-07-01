# Graph-walker KG tools: real-label matching (the `PullRequest` casing problem)

The graph-walker agent tools that filter by node type silently return nothing
for multi-hump node labels such as `PullRequest`. This is a casing mismatch
between the **schema registry** (capitalize-normalized) and the **real Neo4j
labels** (preserved). It will get worse as more node types are added.

Status: **planned, not implemented.** This doc is the implementation spec.

Repos involved:
- `jarvis-backend` (`/Users/evanfeenstra/code/sphinx/jarvis-backend`) — additive
  only. We can ADD endpoints/params/helpers; we must NOT change existing
  behavior, because other teams depend on these endpoints heavily.
- `hive` — the graph-walker tools + KG adapter.

## Background: where the casing comes from

Jarvis schema types are **capitalized on write**: `create_edge_schema` /
node-schema seeding run Python `str.capitalize()` on the type name
(`jarvis-backend/api/helper/schema_crud.py:1370-1371`, and the node-schema
equivalents at `:728/:736/:1014/:1031`). `str.capitalize()` upper-cases the
first char and **lower-cases the rest**, so:

- `"PullRequest".capitalize()` → `"Pullrequest"` ❌ (mangled)
- `"Concept".capitalize()` → `"Concept"` ✅ (single word, unchanged)
- `"File"`, `"Function"`, `"Repository"`, `"Hivetask"` … → unchanged ✅

Meanwhile stakgraph ingests code-graph nodes **directly**, bypassing Jarvis's
capitalize-on-write, so their real Neo4j labels keep their natural casing —
e.g. the label is `PullRequest`, but the registered `Schema.type` is
`Pullrequest`.

Confirmed on prod swarm `swarm38`: every `Schema.type` is capitalize-normalized
(no internal capitals), while `latest-by-types` reports the real node label as
`PullRequest`.

So the mismatch class is exactly: **multi-hump CamelCase labels**. Today that's
`PullRequest`; any future multi-word type (e.g. `UnitTest`, `DataModel`) will
hit the same wall.

## Root cause: type filters resolve to schema casing, then match real labels

Two read endpoints accept a node-type filter, **canonicalize it to the schema
casing**, and then **match it against the real label** — so a multi-hump type
can never match:

### `GET /v2/nodes/search` (graph_search)
`api/service/node_service_v2.py` → `search_nodes_lite`:
- `resolve_canonical_node_types(session, node_types)` rewrites input → schema
  casing (`:1209`). Unknown → `400 UNKNOWN_NODE_TYPE` (`:1212-1221`).
- Filter: `ANY(t IN $node_types WHERE t IN labels(n))` (`:1228`) — **exact**
  match against real labels.
- Access path is the **fulltext index** (`db.index.fulltext.queryNodes`); the
  type filter is a post-filter on the bounded hit set.

### `GET /v2/nodes/{ref_id}?expand=edges` (graph_neighbors)
`api/service/prediction_service.py` → `get_node_edges`:
- `resolve_canonical_node_type(...)` per type, lenient (`:100-101`, keeps
  unresolved as-is via `or t`).
- The filter is then applied inside `NodeHelperV2.get_node_edges`
  (`api/helper/node_helper_v2.py`) in **two** ways depending on `sort_by`:
  - default path: APOC **`labelFilter`** string `"File|Function"`
    (`node_helper_v2.py:251`), evaluated during `apoc.path.expandConfig`
    expansion — **exact label strings, no case-insensitive form**.
  - `sort_by=importance` path: Cypher `any(lbl IN labels(node) WHERE lbl IN
    $imp_node_types)` (`node_helper_v2.py:371/391`).
- Access path is `MATCH (source {ref_id: $ref_id})` (indexed) + **1-hop**
  expansion; the type filter only ever touches that node's neighbors.

`resolve_canonical_node_type` (`api/helper/node_type_helper.py:24-66`) resolves
case-insensitively against `Schema` nodes and returns `Schema.type` (the
capitalized value). So `PullRequest` (any casing) → `Pullrequest` → fails the
real-label match. Ironically, the **presence** of the mis-cased schema is what
breaks it: with no schema the lenient path would keep `PullRequest` verbatim and
match.

## Tool-by-tool impact (Hive `src/lib/ai/graphWalkerTools.ts` + `kg-adapter.ts`)

| Tool | Endpoint | Sends type filter? | Affected? |
|------|----------|--------------------|-----------|
| `graph_get` | `GET /v2/nodes/{ref_id}?limit=1` (`kg-adapter.ts:200`) | No (ref_id) | ✅ immune |
| `graph_neighbors` (pg/canvas label enrichment) | `POST /v2/nodes/by-refs` (`kg-adapter.ts:260`) | No (ref_ids) | ✅ immune |
| `graph_ontology` | `GET /schema/all?concise=true` (`kg-adapter.ts:411`) | No (returns list) | ⚠️ returns schema casing — discovery source is wrong |
| `graph_neighbors` (kg) | `GET /v2/nodes/{ref_id}?expand=edges&node_type=[...]` (`kg-adapter.ts:325`) | Yes | ❌ breaks for multi-hump |
| `graph_search` (kg) | `GET /v2/nodes/search?node_type=...` (`kg-adapter.ts:458`) | Yes | ❌ breaks for multi-hump |

Single-word KG types (`Concept`, `File`, `Function`, `Class`, `Endpoint`,
`Datamodel`, `Page`, `Repository`, …) work fine today; only multi-hump labels
break.

## Design

Three additive changes in jarvis-backend + matching Hive wiring. The guiding
idea: **resolve the caller's type to the real Neo4j label, then keep matching
exact.** Do NOT switch the node-matching to case-insensitive Cypher — it can't
express APOC `labelFilter` and would change the access cost story.

### 1. New resolver: resolve to the real graph label (not the schema)

Add to `api/helper/node_type_helper.py` (additive; existing
`resolve_canonical_node_type` untouched):

```python
def resolve_graph_label(session, raw: str) -> "str | None":
    """Resolve *raw* (any casing) to the real Neo4j label via db.labels().
    Case-insensitive. Returns None if no such label exists. Cached like
    resolve_canonical_node_type; invalidate alongside it if needed."""
    # CALL db.labels() YIELD label WHERE toLower(label) = toLower($raw) RETURN label LIMIT 1

def resolve_graph_labels(session, raw) -> "tuple[list[str], list[str]]":
    """List/CSV variant → (resolved_real_labels, unknown)."""
```

Why `db.labels()`: it reads the **label catalog** (token store) — O(#distinct
labels), a few dozen entries, **independent of node count**. No node scan, fast
at any graph size (this is the answer to "what about hundreds of thousands of
nodes?": the resolution is metadata, and downstream matching is unchanged from
today). Cache results in-process keyed by `lower(raw)` exactly like the existing
schema resolver.

Note: `db.labels()` is DB-global (not namespace-scoped). For casing resolution
that's correct and cheap. It may include labels not present in the caller's
namespace, which is harmless (filtering by an absent label just returns empty)
and is already how `/schema/all` behaves (global schema list).

### 2. Optional `canonicalize` param on the two read endpoints (default `true`)

Default `true` = today's behavior, byte-for-byte. Only when `canonicalize=false`
do we use the new resolver.

**`search_nodes_lite`** (`node_service_v2.py`):
- Read `canonicalize` from `params` (default `"true"`; `false` only when
  explicitly `"false"`).
- When `false`: resolve `node_types` via `resolve_graph_labels`; skip the
  `UNKNOWN_NODE_TYPE` 400 (unresolved kept verbatim → simply matches nothing).
  The existing exact filter `t IN labels(n)` now receives the real label.
- When `true`: unchanged (`resolve_canonical_node_types` + 400).

**`get_node_edges`** (`prediction_service.py`):
- Read `canonicalize` from `request.args` (default true).
- When `false`: resolve `node_type_filter_list` via `resolve_graph_labels`
  (real labels) instead of `resolve_canonical_node_type`. The real label flows
  into `NodeHelperV2.get_node_edges` → APOC `labelFilter` (exact) and/or the
  importance-path Cypher filter — both now match because they get the real
  label.
- When `true`: unchanged.

This keeps node matching **exact** (APOC `labelFilter` + `IN labels(n)`), so the
access path and cost are identical to today; only the tiny resolution step
changed (and that's a metadata lookup).

### 3. New endpoint for live labels (graph_ontology source)

Do NOT modify `/schema/all` (other consumers depend on it). Add a new route:

`GET /graph/labels` (in `api/route/graph_route.py`, new service method):
- Returns the real labels via `db.labels()`, each merged with the matching
  `Schema` description where one exists (case-insensitive join on type), so the
  agent gets real casing + descriptions, **including** newly-ingested types that
  have no schema yet (description empty).
- Response shape (mirror what `kgGetOntology` already parses so the Hive change
  is minimal), e.g.:
  ```json
  { "labels": [ { "type": "PullRequest", "description": "..." }, ... ] }
  ```
- Exclude the wildcard `*` sentinel and any internal/base labels
  (`ApplicationConstant.BASE_LABELS`, `Schema`, etc.).

### Hive wiring (`src/lib/ai/kg-adapter.ts`)

- `kgSearch` (`:451-459`): append `canonicalize=false` to the query string.
- `kgGetNeighbors` (`:314-325`): append `canonicalize=false`.
- `kgGetOntology` (`:406-...`): call `GET /graph/labels` instead of
  `/schema/all?concise=true`; parse `data.labels` (was `data.schemas`). Keep the
  return type `{ type, description }[]`.
- No change needed to `graph_get` or the `/v2/nodes/by-refs` enrichment (immune).
- Tool descriptions/prompt (`graphWalkerTools.ts`): no behavioral change
  required, but optionally note that types come from `graph_ontology` (now real
  labels) and any casing is accepted.

## Why not the alternatives

- **Case-insensitive Cypher match** (`toLower(label)=toLower(t)`): doesn't work
  for the APOC `labelFilter` expand path (exact strings only), and only would've
  covered `search` + the importance branch. Rejected.
- **Auto-fallback in `resolve_canonical_node_type`** (try schema, else real
  label): would change behavior for ALL existing callers of a shared helper —
  violates the additive-only constraint. Rejected in favor of the opt-in param.
- **Fix the schema casing to `PullRequest`**: impossible via the API
  (`create_edge_schema` re-capitalizes), and mutating Schema nodes directly is
  risky/shared. Rejected.

## Performance notes (the "hundreds of thousands of nodes" question)

- Neither read endpoint uses a **label scan** as its access path:
  `search` is fulltext-index driven; `expand=edges` is ref_id lookup + 1-hop.
  The type filter is a post-filter on a bounded candidate set in both cases, so
  total node count is irrelevant to it — same as today.
- The new resolution step reads `db.labels()` (label catalog metadata),
  O(#distinct labels), independent of node count. Cache it per-process.
- `GET /graph/labels` likewise reads `db.labels()` + a small schema join — no
  node scan.

Net: no new scaling risk at any graph size.

## Constraint checklist (jarvis-backend = additive only)

- New helpers `resolve_graph_label(s)` — additive. ✅
- `canonicalize` param on two existing endpoints — optional, default preserves
  exact current behavior; new branch only runs on explicit `false`. ✅ (approved)
- `GET /graph/labels` — brand-new route; `/schema/all` untouched. ✅
- Watch the Flask endpoint-name gotcha: if decorating the new route with
  `track_request_time`, set an explicit `endpoint=` (the decorator's `wrapper`
  isn't `functools.wraps`-preserved — this already bit PR #2933).

## Tests

jarvis-backend (integration, needs Neo4j test stack):
- `search` with `canonicalize=false` matches a node by its real multi-hump
  label; with default it does not (documents the existing behavior).
- `expand=edges` with `canonicalize=false` returns neighbors filtered by a
  real multi-hump label (covers BOTH the APOC `labelFilter` path and the
  `sort_by=importance` path).
- `resolve_graph_label` resolves any casing → real label; unknown → None.
- `GET /graph/labels` returns real labels incl. one with no schema; merges
  descriptions; excludes `*`/base labels.

hive (unit):
- `kg-adapter` sends `canonicalize=false` on search + neighbors.
- `kgGetOntology` parses `/graph/labels` response shape.

## Rollout

1. Merge/deploy jarvis-backend first (new endpoint + params must exist).
2. Deploy Hive. If Hive ships first, `canonicalize=false` is just an unknown
   param (ignored by the old backend) and `graph_ontology` would 404 on
   `/graph/labels` — so backend goes first.
3. No data migration. Behavior change is opt-in via the param + new endpoint.

## File reference index

jarvis-backend:
- `api/helper/node_type_helper.py` — add `resolve_graph_label(s)`
- `api/service/node_service_v2.py` — `search_nodes_lite` `canonicalize` param
- `api/service/prediction_service.py` — `get_node_edges` `canonicalize` param
- `api/helper/node_helper_v2.py` — confirm real label flows into `labelFilter`
- `api/route/graph_route.py` — new `GET /graph/labels`
- (service for the labels endpoint — `graph_service.py` or a new method)

hive:
- `src/lib/ai/kg-adapter.ts` — `kgSearch`, `kgGetNeighbors`, `kgGetOntology`
- `src/lib/ai/graphWalkerTools.ts` — (optional) prompt/description note
- tests: `src/__tests__/unit/...` kg-adapter coverage
