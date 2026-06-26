# Linking `HiveTask` → `PullRequest` in the graph

A follow-up to the entity graph-mirror (`HiveFeature` / `HiveTask` /
`HiveChatMessage`). When a task's autonomous agent opens a PR, draw an edge from
the task's graph node to the **existing** `PullRequest` node that the codegraph
ingestion already created — so the graph connects "the work item" to "the code
change it produced."

Status: **proposed.**

## Why this is a separate job, not part of the mirror cron

The entity mirror (`src/services/jarvis-mirror-cron.ts`) is **cursor-driven**:
it only touches a Feature/Task/ChatMessage whose `updatedAt` advanced since the
last run. PR linking does **not** fit that model, for three reasons:

1. **Different trigger.** The `PullRequest` node is created by the
   codegraph / stakgraph ingestion pipeline, often **after** the task row last
   changed. The task's `updatedAt` may never move again, so the mirror cron
   would never revisit it to draw the edge. The real trigger is *"the PR node
   now exists in the graph"*, which the entity cursor can't observe.

2. **Different, uncertain identity.** Drawing the edge means matching the
   **existing** PR node's `node_key` (`pullrequest-name`, see the codegraph
   schema in `jarvis-backend/api/constants/schema_library.py`). If we guess the
   `name` wrong, Jarvis's create-or-merge edge endpoint will happily **create a
   stub `PullRequest` node** instead of linking to the ingested one — silently
   polluting the graph. This needs upfront research (below), which should not
   block or complicate the clean entity mirror.

3. **Different timing/ordering.** The edge target must already exist. A job that
   runs independently and simply **keeps retrying** unlinked tasks is a far
   better fit than threading "is the PR ingested yet?" into the cursor loop.

So: a separate, retry-oriented cron that scans *unlinked tasks-with-PRs* and
best-effort draws the edge. It reuses the same building blocks
(`getJarvisConfigForWorkspace`, `addEdgeBulk` with node_key endpoints) — **no
new infrastructure**.

## Research spike (do this first)

Two unknowns must be nailed down before writing the linker. Both are cheap.

### A. How does codegraph name `PullRequest` nodes?

The edge target is matched by the PR node's `node_key` = `pullrequest-name`
(i.e. the sanitized `name` property). We must produce the **exact** same `name`
the ingestion writes, or we create a duplicate stub.

- Find where stakgraph/codegraph ingests PRs and what it sets as `name` (PR
  title? `owner/repo#123`? the PR URL? the head branch?). Also note `number`
  and `source_link` on the `PullRequest` schema — one of those may be a more
  stable join key than `name`.
- Confirm `sanitize_node_key` behavior: `name` is lowercased, spaces stripped,
  non-alphanumerics removed (`schema_validation.py:sanitize_node_key`). The
  linker must mirror that normalization if it constructs node_data endpoints.
- **Safer alternative:** rather than reconstructing the node_key, look the PR
  node up first (e.g. read API by `number`/`source_link` within the workspace
  namespace) and create the edge by **`ref_id`**. This avoids any chance of stub
  creation. Decide lookup-by-ref vs. node_key-endpoint during the spike.

### B. Where does a Hive `Task` record its PR?

We need a reliable per-task PR reference (number and/or URL). Candidate sources,
to be verified:

- `Task.branch` — head branch; may be matchable to the PR.
- `Artifact` rows on the task's `ChatMessage`s — there may be a PR-typed
  artifact (`ArtifactType`) whose `content` JSON holds the PR URL/number.
- `Task` deployment / workflow fields, or a `Deployment` relation.

Output of the spike: a small function `getTaskPullRequests(task): { number, url,
repo }[]` and a confirmed PR-node match strategy.

## Sketch (after the spike)

- **Schema (jarvis-backend):** add an edge to the Hive library:
  `HiveTask -RESULTED_IN-> PullRequest` (or reuse an existing relationship verb).
  Lands in `get_hive_schema_edges()` alongside `HAS_TASK` / `HAS_MESSAGE`.
- **Tracking:** avoid re-linking every run. Either:
  - a per-task boolean/marker (`jarvisPrLinkedAt` on `Task`), or
  - rely on edge idempotency (the edge endpoint dedups by edge_key) and just
    scan a bounded window of recent tasks-with-PRs each run.
  Prefer a marker so the scan stays cheap as task count grows.
- **Cron:** `src/app/api/cron/jarvis-pr-links/route.ts` + a
  `jarvis-pr-link-cron.ts` service. Per workspace with a swarm:
  1. find tasks that have a PR but are not yet linked (capped per run),
  2. resolve each PR node (lookup-by-ref **or** node_key endpoint per the spike),
  3. `addEdgeBulk` the `RESULTED_IN` edges,
  4. mark linked.
  CRON_SECRET guard, `maxDuration`, best-effort per workspace — mirror the
  entity cron's posture.
- **Schedule:** hourly (`0 * * * *`) is fine; linking is eventually-consistent.

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
