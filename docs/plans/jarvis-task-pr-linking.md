# Linking `HiveTask` → `PullRequest` in the graph

A follow-up to the entity graph-mirror (`HiveFeature` / `HiveTask` /
`HiveChatMessage`). When a task's autonomous agent opens a PR, draw an edge from
the task's graph node to the **existing** `PullRequest` node that the codegraph
ingestion already created — so the graph connects "the work item" to "the code
change it produced."

Status: **implemented.** Spikes A and B resolved (see below). Hive side shipped:
`src/services/jarvis-pr-link-cron.ts`, `src/app/api/cron/jarvis-pr-links/route.ts`,
PR mappers in `src/services/jarvis-mirror/mappers.ts`, `searchLatestByTypes` in
`src/services/swarm/api/nodes.ts`, `Task.jarvisPrLinkedAt` marker, and the
`jarvisSyncState.prLink.highWater` mark. **Remaining dependency:** the
`HiveTask -RESULTED_IN-> PullRequest` edge must be added to the Hive schema in
jarvis-backend (`get_hive_schema_edges()`) or the edge writes will be rejected.

## Why this is a separate job, not part of the mirror cron

The entity mirror (`src/services/jarvis-mirror-cron.ts`) is **cursor-driven**:
it only touches a Feature/Task/ChatMessage whose `updatedAt` advanced since the
last run. PR linking does **not** fit that model, for three reasons:

1. **Different trigger.** The `PullRequest` node is created by the
   codegraph / stakgraph ingestion pipeline, often **after** the task row last
   changed. The task's `updatedAt` may never move again, so the mirror cron
   would never revisit it to draw the edge. The real trigger is *"the PR node
   now exists in the graph"*, which the entity cursor can't observe.

2. **Stub-creation risk from name drift.** Drawing the edge by `node_key`
   (`pullrequest-name`, see the codegraph schema in
   `jarvis-backend/api/constants/schema_library.py`) is unsafe because the PR
   node `name` is **not stable**: live data on a prod swarm shows older PRs
   named `stakwork/hive/pr-1192.0` (carrying `legacyName: "pr-1192"`) while
   newer ones are `stakwork/hive/pr-4542`. If we reconstruct the key from
   `{repo}/pr-{number}` and the real node used the `.0` form, Jarvis's
   create-or-merge edge endpoint will happily **create a stub `PullRequest`
   node** instead of linking to the ingested one — silently polluting the
   graph. The fix (spike A below) is to **not** use `node_key` at all: look the
   node up by its stable integer `number` + `repo` properties and link by
   `ref_id`.

3. **Different timing/ordering.** The edge target must already exist. A job that
   runs independently and simply **keeps retrying** unlinked tasks is a far
   better fit than threading "is the PR ingested yet?" into the cursor loop.

So: a separate, retry-oriented cron that scans *unlinked tasks-with-PRs* and
best-effort draws the edge. It reuses the same building blocks
(`getJarvisConfigForWorkspace`, `addEdgeBulk` with `ref_id` endpoints) — **no
new infrastructure**.

## Research spike

### A. How does codegraph name `PullRequest` nodes? — **RESOLVED**

Confirmed against a prod swarm (`POST /graph/search/latest-by-types` with
`{"nodeTypes":{"PullRequest":N}}`). A representative node:

```
node_type: PullRequest
ref_id:    7a98f842-77e5-49b2-8418-5fda2565d8d0
name:      stakwork/hive/pr-4542        (== id)
number:    4542                         (integer)
repo:      stakwork/hive
url:       https://github.com/stakwork/hive/pull/4542
title:     feat(jarvis): mirror Feature/Task/ChatMessage entities...
```

Property keys: `name, id, number, repo, url, title, date, files, docs, summary,
newDeclarations` + token counts. Findings:

- **There is no `source_link`.** The stable join key is the integer `number`
  plus `repo`. (`url` is derivable as `https://github.com/{repo}/pull/{number}`.)
- **`name` is NOT stable — do not reconstruct the node_key.** Older PRs are
  named `stakwork/hive/pr-1192.0` with `legacyName: "pr-1192"`; newer ones are
  `stakwork/hive/pr-4542` (no `.0`). Building `pullrequest-{sanitize(name)}`
  would miss the legacy form and create stubs.
- **No usable by-key/by-property read endpoint.** Probed on prod:
  `graph/search?node_type=[...]&name=...&node_key=...` **ignores the filters**
  and returns a default set; `/v2/nodes/search` and `/v2/nodes` return empty for
  `PullRequest`; `GET /node/{key}` 404s and `GET /node` 405s. The only endpoint
  that returns PR nodes with properties is `POST /graph/search/latest-by-types`.

**Decision (lookup-by-ref):** the linker fetches `PullRequest` nodes via
`latest-by-types`, builds a `Map<"{repo}#{number}", ref_id>` keyed on the stable
integer `number` + `repo`, and creates edges by **`ref_id`**. This is immune to
name drift and never creates stubs.

**Scale: full backfill once, then incremental by high-water mark.** Measured on
prod:

- The endpoint has **no hard cap** — it honors the per-type limit and returns up
  to the real total in one call (this swarm: 3406 PR nodes; requesting 5000
  returned 3406). So "get all 4000" is one request, not paginated.
- The match fields (`number`, `repo`) require `include_properties:true`, which
  also drags the heavy `docs`/`files`/`summary` blobs: **~1.7 KB/PR** → a full
  pull of 3406 was **5.8 MB / 7 s**. `include_properties:false` is cheap
  (371 KB) but returns only `ref_id`/`date_added_to_graph` — useless for matching.
- **Results are ordered `date_added_to_graph` DESC** (newest-ingested first,
  verified).

A fixed "recent window" would be **wrong**: on the first run every task-with-PR
is unlinked and those PRs span the whole history, so a top-N window would never
match (and therefore never link) the older ones. The requirement is that *all*
linkable tasks get linked. So:

- **First run / backfill: pull the full PR set** (one request; ~6 MB / 7 s for
  ~4000 — fine as a one-time cost). Build the complete `{repo}#{number} → ref_id`
  map and link every matchable task.
- **Steady state: incremental high-water fetch.** Persist the greatest
  `date_added_to_graph` processed (per workspace). Each run, read from the top of
  the DESC list and **stop once you reach a `date_added_to_graph` ≤ the stored
  high-water** — i.e. fetch only PRs ingested since last run. This is cheap and
  still complete: backfill covered all history, and any later PR always enters at
  the top, so it's caught on the next run. (A task can't reference a PR older
  than itself in practice — the task's own agent opens the PR — so newly-unlinked
  tasks always resolve against newly-ingested PRs.)
- Combined with the per-task linked marker, only still-unlinked tasks are ever
  chased, and the fetch volume is bounded by ingestion rate, not total PR count.

### B. Where does a Hive `Task` record its PR? — **RESOLVED**

There is **no PR column on `Task`**. A task's PR is a `PULL_REQUEST`-typed
`Artifact` on one of the task's `ChatMessage`s; the canonical reference is
`artifact.content.url` (the GitHub `html_url`). `content.repo`/`content.number`
are inconsistent across writers (bare name vs `owner/repo`; `number` only in
seed data), so **derive both `repo` and `number` from the URL** (see
`parsePullRequestUrl`). Query path: `Task → chatMessages → artifacts
(type='PULL_REQUEST') → content.url`. A task may have multiple PR artifacts
(multi-repo / re-push) — de-dupe by `repo#number` and only mark the task linked
once *all* its PRs resolve.

## Sketch (after the spike)

- **Schema (jarvis-backend):** add an edge to the Hive library:
  `HiveTask -RESULTED_IN-> PullRequest` (or reuse an existing relationship verb).
  Lands in `get_hive_schema_edges()` alongside `HAS_TASK` / `HAS_MESSAGE`.
- **Tracking:** two pieces of state:
  - a per-task marker (`jarvisPrLinkedAt` on `Task`) so the task scan only
    chases still-unlinked tasks-with-PRs and stays cheap as task count grows
    (edge creation is also idempotent — the endpoint dedups by edge_key — so the
    marker is an optimization, not a correctness requirement), and
  - a per-workspace PR-fetch high-water (greatest `date_added_to_graph` seen,
    e.g. in `Swarm`/`jarvisSyncState`) so the PR pull is **full on first run**
    and **incremental thereafter** (see spike A). Missing/zero high-water ⇒
    backfill.
- **Cron:** `src/app/api/cron/jarvis-pr-links/route.ts` + a
  `jarvis-pr-link-cron.ts` service. Per workspace with a swarm:
  1. find tasks that have a PR but are not yet linked (capped per run),
  2. fetch `PullRequest` nodes via `latest-by-types`
     (`include_properties:true`, newest-ingested-first) — **full set on the first
     run**, then **only those newer than the stored `date_added_to_graph`
     high-water** on later runs — build a `Map<"{repo}#{number}", ref_id>`, and
     resolve each task's PR to a `ref_id` (skip — retry next run — if not yet
     ingested),
   3. `addEdgeBulk` the `RESULTED_IN` edges with `target: { ref_id }` (chunked at
      `BULK_CHUNK`),
   4. mark linked; if the task batch hit the per-run cap, set `capped`.
- **Vercel timeout — reuse the mirror's machinery verbatim** (it already survives
  the limit): `export const maxDuration = 300`; bounded work per run (cap
  PRs-linked-per-workspace, `BULK_CHUNK = 100`); **self-chain** via `after()` +
  `?d=depth` up to `MAX_CHAIN_DEPTH` when `anyCapped`; best-effort per workspace
  (one failure never aborts the loop); CRON_SECRET / `x-vercel-cron` guard. See
  `src/app/api/cron/jarvis-mirror/route.ts` and `runJarvisMirror`.
  - The full backfill PR pull is ~7 s for one workspace — well inside 300 s — and
    the high-water mark means only workspaces still in backfill pay it; the rest
    pull a tiny incremental slice. No single invocation runs long.
  - **High-water vs. self-chain gotcha (unlike the mirror's keyset cursor):**
    while a backfill is *capped* and self-chaining, the still-unlinked tasks point
    at **old** PRs, so every chained run still needs the **full** map. Advancing
    the high-water after the first pull would make the next chained run fetch only
    *new* PRs and strand the backlog. Rule: **keep doing full PR pulls while
    `capped`; only advance the high-water on an uncapped (fully-drained) pass.**
- **Schedule:** hourly (`0 * * * *`); add to `vercel.json` `crons` alongside
  `jarvis-mirror`. Linking is eventually-consistent.

## Out of scope

- Linking PRs to `HiveFeature` (could be derived transitively via the task).
- Commit / file-level links — the codegraph already models those; this plan is
  only the task → PR bridge.

## Related

- Entity mirror: `src/services/jarvis-mirror-cron.ts`,
  `src/services/jarvis-mirror/mappers.ts`, `src/services/swarm/api/nodes.ts`
  (`addEdgeBulk` already accepts `{ node_type, node_data }` / `{ ref_id }`
  endpoints).
- Jarvis Hive ontology: `jarvis-backend` `get_hive_schema_library()` /
  `get_hive_schema_edges()` (PR stakwork/jarvis-backend#2925).
- Connection resolution: `src/lib/helpers/jarvis-config.ts`.
- PR-node read: `POST /graph/search/latest-by-types` (same endpoint as
  `src/app/api/swarm/jarvis/search-by-types/route.ts`, payload key `nodeTypes`).
