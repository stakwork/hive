# Mirroring Postgres → Neo4j (graph mirror)

Mirror a **chosen subset** of the Neon Postgres tables into a Neo4j graph on a
separate server, so the data can be traversed as nodes + edges (workspaces →
features → phases → tasks → messages → artifacts, people, repos, initiatives,
…) without bolting graph queries onto the relational app.

Status: **proposed.**

## The one-line answer to "do all 1000 routes need to change?"

**No.** Not one route changes. Every write in the app already funnels through a
single Prisma client instance (`src/lib/db.ts:7`). We intercept **there**, once,
with a Prisma Client extension. The 1000 route handlers are oblivious; they keep
calling `db.task.update(...)` exactly as today.

The FK→edge translation is **derived from the schema**, not hand-written per
route: Prisma already declares every relationship (`@relation(fields:…,
references:…)`), so the node/edge mapping is generated from the schema's DMMF
plus a small per-model override table for the handful of awkward cases (chats,
polymorphic parents, JSON blobs).

## Why an extension, not the obvious alternatives

| Approach | Verdict | Why |
| --- | --- | --- |
| **Dual-write in each route** | ✗ Rejected | 1000 places to forget; couples every handler to Neo4j uptime; misses migrations/backfills. This is the thing the question was worried about — we explicitly do not do it. |
| **CDC / logical replication (Debezium → Neo4j sink)** | ◐ Viable, heavier | Truly automatic, catches *every* write including raw SQL & migrations. But it streams the whole DB (filtering lives in infra config), needs a Kafka/Redpanda + connector stack, and ships raw row shapes that still need the same mapping layer. Overkill unless we later need 100% fidelity. Kept as the documented upgrade path (see "When to graduate to CDC"). |
| **Prisma Client extension → Redis Stream → consumer** | ✓ **Chosen** | One interception point covers all routes; per-model allowlist + field selection is plain TypeScript next to the schema; reuses the `ioredis` client we already run (`src/lib/redis.ts`). Its one gap (writes that bypass Prisma) is closeable and, for our curated business tables, negligible. |

## The animating principle

**Intercept at the data layer, project at the edge, write from afar.**

1. **Data layer (in-app, cheap):** a Prisma extension observes writes and emits
   a tiny, self-describing *change event* to a Redis Stream. It does **no**
   Neo4j I/O — Vercel functions stay short and never block on the graph DB.
2. **Projection (pure):** a mapping module turns a change event into graph
   operations (`MERGE` node, `MERGE`/`DELETE` edges) using a schema-derived map
   plus per-model overrides. Pure function, unit-testable, no I/O.
3. **Write (out-of-app):** a long-running **consumer on the Neo4j server** (not
   on Vercel) drains the stream and applies Cypher idempotently.

Each stage is independently testable and independently fails safe: if Neo4j is
down, events pile up in Redis and drain later; the app never notices.

## Hard constraint: we are serverless

`vercel.json` shows the app is Vercel serverless + cron. There is **no
persistent worker process inside the app** to drain a queue. This is the single
most load-bearing fact in the design and it dictates the topology:

- The **producer** (Prisma extension) runs inside request/cron invocations and
  must be fire-and-forget — enqueue to Redis via `after()`/`waitUntil` so it
  never adds latency or fails a user request.
- The **consumer** runs as an ordinary Node process **on the separate Neo4j
  server** (the same box that runs Neo4j, or one next to it), holding a
  `XREADGROUP` loop. It is the only thing that talks to Neo4j. This keeps the
  Bolt connection off Vercel entirely and gives us a real, restartable worker
  with backpressure.

```
            Vercel (serverless)                    │   Neon          │   Neo4j server (long-running)
 ┌──────────────────────────────────────────┐     │                 │
 │ 1000 routes ─► db (Prisma client) ─writes─┼─────┼──► Postgres      │
 │                   │                        │     │                 │
 │            $extends query hook             │     │                 │
 │                   │ (after(): enqueue)     │     │                 │
 │                   ▼                        │     │                 │
 │            Redis Stream  "graphsync"  ◄────┼─────┼─────────────────┼──┐
 └──────────────────────────────────────────┘     │                 │  │ XREADGROUP
                                                    │                 │  ▼
                                                    │           ┌─────────────────┐
                                                    │           │ consumer worker │──MERGE──► Neo4j
                                                    │           │ (mapping + Bolt)│
                                                    │           └─────────────────┘
```

Redis Streams (not a plain list/pubsub) because they give us **consumer groups,
acks, replay, and a pending-entries list** — i.e. at-least-once delivery with a
dead-letter path, for free, on infra we already run.

## Change-event contract

The extension emits one self-describing event per mutating operation. It carries
*data*, never Cypher — projection happens consumer-side so the mapping can
evolve without redeploying the app.

```ts
interface GraphChangeEvent {
  v: 1;                       // schema version of THIS envelope
  model: string;              // Prisma model name, e.g. "Task"
  op: "upsert" | "delete";    // create/update/upsert collapse to "upsert"
  id: string;                 // primary key of the affected row
  // Full post-write row for upserts (selected fields only — see field policy).
  // For deletes, just enough to locate the node + its edges (the id + any FK
  // columns needed to drop edges, captured pre-delete).
  data: Record<string, unknown> | null;
  ts: string;                 // ISO; for ordering/observability
  txId?: string;              // optional: group multi-row tx (see ordering)
}
```

`create | update | upsert` all collapse to `op: "upsert"` because the consumer
always `MERGE`s — there is no separate "insert" path in an idempotent graph
sync. `delete` / `deleteMany` produce `op: "delete"`.

## The producer: one Prisma extension

A single `$extends` on the client in `src/lib/db.ts`. Sketch:

```ts
// src/lib/graphsync/extension.ts
const SYNCED = new Set(["Workspace","User","WorkspaceMember","Repository",
  "Feature","Phase","Task","ChatMessage","Artifact","Attachment",
  "SharedConversation","Initiative","Milestone", /* …chosen subset… */]);

const MUTATIONS = new Set(["create","update","upsert","delete",
  "createMany","updateMany","deleteMany"]);

export const graphSync = Prisma.defineExtension({
  name: "graphSync",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const watched = SYNCED.has(model) && MUTATIONS.has(operation);
        // For deletes we must read the row(s) BEFORE the write to capture
        // FK columns needed to drop edges (the row is gone afterward).
        const preDelete = watched && operation.startsWith("delete")
          ? await capturePreDelete(model, args)   // SELECT by where
          : null;

        const result = await query(args);         // the real write

        if (watched) {
          // never block the request; never throw into the caller
          after(() => enqueueGraphEvents({ model, operation, args, result, preDelete })
            .catch((e) => logger.warn("graphsync enqueue failed", e)));
        }
        return result;
      },
    },
  },
});
```

Wired in `src/lib/db.ts`:

```ts
export const db = (globalForPrisma.prisma ?? new PrismaClient({ … }))
  .$extends(graphSync);
```

Producer rules (these are the "no loose ends" details):

- **Fire-and-forget, always.** Enqueue inside `after()` (Next) /
  `ctx.waitUntil`. A graphsync failure must never fail or slow a user write.
  Wrap in try/catch; on enqueue failure, log + drop (the periodic backfill, see
  below, is the safety net).
- **`createMany`/`updateMany`/`deleteMany` are the sharp edge.** They don't
  return the affected rows. Options, in order of preference:
  - For `updateMany`/`deleteMany`: run a `findMany({ where, select: { id, …fks } })`
    around the op to enumerate affected ids (the `capturePreDelete` helper
    generalizes to this). Cost is one extra indexed query on the bulk paths,
    which are rare.
  - For `createMany`: re-query by a discriminator if needed, or require callers
    of bulk-create on synced models to also emit (rare; document the exceptions).
  - If a bulk op can't be cheaply enumerated, **skip it and rely on backfill** —
    the daily reconciler converges it. Mark such models explicitly.
- **`$executeRaw` / `$queryRaw` are invisible** to the extension. Enumerate every
  raw write to a synced table (grep `\$executeRaw|\$queryRaw`) and either route
  it through the ORM or have it emit an event manually. This is the only place
  "you touch code" beyond the extension — and it's a finite, auditable list, not
  1000 routes.

## The consumer: one worker on the Neo4j box

A standalone Node process (lives in this repo under `scripts/graphsync-consumer.ts`
or a tiny sibling package, deployed to the Neo4j server). Loop:

```
XREADGROUP GROUP g1 c1 COUNT 200 BLOCK 5000 STREAMS graphsync >
  → for each event: project() → Cypher → run in a tx
  → XACK on success
  → on failure: leave unacked; after N delivery attempts (XPENDING idle),
    move to graphsync:dead + alert
```

- **Idempotent by construction.** Every node write is `MERGE (n:Label {id})
  SET n += $props`. Every edge is `MERGE (a)-[r:TYPE]->(b)`. Re-delivering an
  event is a no-op. This is why at-least-once delivery is fine.
- **Batched.** Drain up to N events, group by label, apply with `UNWIND
  $rows AS row MERGE …` for throughput.
- **Ordering** (see below) handled by per-key collapse, not global order.

## Projection: schema-derived map + per-model overrides

`src/lib/graphsync/map.ts` exports a `GRAPH_MAP`. The **bulk** of it is
generated from Prisma's DMMF (`getDMMF()` over `schema.prisma`) at build time:
every model → a node label, every `@relation` scalar FK → an edge. We commit the
generated file and hand-edit only the override entries.

```ts
type ModelMap = {
  label: string;
  props: string[];                                  // field allowlist (privacy!)
  edges: EdgeMap[];
  expand?: (row: any) => ExpandedNode[];            // JSON-blob explosion
};
type EdgeMap = {
  fk: string; to: string; type: string;
  when?: (row: any) => unknown;                     // conditional / polymorphic
};
```

### Field policy (privacy + noise)

`props` is an **allowlist**, never "all columns." This is deliberate: many
synced tables carry secrets or bulky blobs we must not copy into a second store.
Hard exclusions, enforced by a test that fails if a sensitive column sneaks into
any `props`:

- Tokens/secrets: `Account.*_token`, `SourceControlToken`, `WorkspaceApiKey`,
  `WorkspaceSecret`, `EnvironmentVariable.value`, `Swarm` keys, `Pod` creds.
- Bulk JSON we don't want in the graph: `Whiteboard.elements/appState/files`,
  raw `provenanceData`, etc.

Default stance: sync **structure and identifiers**, not payloads. A `Task` node
gets `id, title, status, priority, createdAt`; not its full chat history.

### Polymorphic / nullable FKs

The schema has several "belongs to A **or** B" columns. The `when` predicate
emits only the live edge:

```ts
ChatMessage: {
  label: "Message",
  props: ["id","role","timestamp","status"],        // NOT `message` body by default
  edges: [
    { fk:"taskId",    to:"Task",    type:"IN_CHAT",  when: r => r.taskId },
    { fk:"featureId", to:"Feature", type:"IN_CHAT",  when: r => r.featureId },
    { fk:"userId",    to:"User",    type:"SENT_BY",  when: r => r.userId },
  ],
},
Artifact:   { label:"Artifact",   props:["id","type","icon"],
              edges:[{ fk:"messageId", to:"Message", type:"ATTACHED_TO" }] },
Attachment: { label:"Attachment", props:["id","filename","mimeType","size"],
              edges:[{ fk:"messageId", to:"Message", type:"ATTACHED_TO" }] },
```

Grounded in the real columns: `ChatMessage.taskId?`, `.featureId?`, `.userId?`
(`prisma/schema.prisma:635-653`); `Artifact.messageId`, `Attachment.messageId`
(`:664`, `:679`).

## The genuinely hard model: `SharedConversation`

This is the one place the schema-derived generator cannot help, and it needs the
only bespoke code in the whole system. Two distinct problems:

### Problem 1 — the messages are a JSON blob, not rows

`SharedConversation.messages` is a single `Json` column
(`prisma/schema.prisma:593`) holding `StoredMessage[]` (the shape in
`src/services/canvas-turn-persistence.ts:92` — `{ id, role, content, timestamp,
toolCalls?, attachments?, source?, … }`). There are **no per-message FKs to
follow**, so generic FK→edge logic sees one opaque node. To get message-level
nodes we must parse the blob ourselves via `expand()`:

```ts
SharedConversation: {
  label: "Conversation",
  props: ["id","title","source","inputTokens","outputTokens","lastMessageAt","createdAt"],
  edges: [
    { fk:"workspaceId",        to:"Workspace",        type:"IN_WORKSPACE", when:r=>r.workspaceId },
    { fk:"sourceControlOrgId", to:"SourceControlOrg", type:"IN_ORG",       when:r=>r.sourceControlOrgId },
    { fk:"userId",             to:"User",             type:"OWNED_BY",     when:r=>r.userId },
  ],
  expand: (row) => {
    const msgs: StoredMessage[] = Array.isArray(row.messages) ? row.messages : [];
    return msgs.map((m, i) => ({
      // StoredMessage HAS a stable `id` (messagesFromSteps assigns
      // `${idPrefix}${n}`), so prefer it; fall back to a synthetic id.
      node: { label:"Message", id: m.id ?? `${row.id}:${i}`,
              props: { role:m.role, idx:i, hasTools: !!m.toolCalls?.length } },
      edges: [
        { to:"Conversation", toId: row.id, type:"IN_CHAT" },
        ...(i>0 ? [{ to:"Message", toId: msgs[i-1].id ?? `${row.id}:${i-1}`, type:"NEXT" }] : []),
      ],
    }));
  },
},
```

Note: `StoredMessage` already carries a stable `id`, so we are *not* forced into
fragile positional synthetic ids — we only fall back to `${row.id}:${i}` if an
older row predates ided messages.

### Problem 2 — it's blob-per-conversation, so every turn is a full-row UPDATE

`ChatMessage` is row-per-message: appending a turn is one `create` → one clean
event. `SharedConversation` is the opposite — the whole `messages` array is
rewritten in place each turn (e.g. `/api/ask/quick`'s `onFinish`, and the
append path in `canvas-turn-persistence.ts`). So a single conversation emits a
fresh `upsert` of the **entire history** on every turn. Consequences the
consumer must handle:

- **Idempotent re-projection is mandatory, not optional.** Each turn re-`expand()`s
  the full blob; `MERGE` on message id makes re-seen messages no-ops and only the
  new tail creates nodes. Without `MERGE` we'd duplicate the whole conversation
  every turn.
- **Stale-edge pruning.** If messages are ever removed/edited, `MERGE`-only
  leaves orphan `Message` nodes. For the conversation case we accept append-only
  semantics (messages aren't deleted mid-thread in practice); the daily backfill
  reconciles any drift. Documented as a known, bounded limitation.
- **Cost guard.** Re-exploding a 500-message conversation on every turn is
  wasteful. Optimization (phase 2): the extension diffs `args.data.messages`
  length vs prior and emits only the tail, or the consumer caches last-seen
  length per conversation in Redis and skips unchanged prefixes. Not needed for
  correctness; needed for scale.

### Tiering knob

How deep `SharedConversation` goes is a dial, pick per need:

1. **Conversation-as-node only** — drop `expand`, keep the row as one node. Use
   when you only need "workspace/user ↔ conversation" topology. Trivial, cheap.
2. **Explode into Message nodes** (the `expand` above) — when you need to
   traverse/query individual turns, link messages↔artifacts, etc. Moderate.
3. **Explode + tail-diff optimization** — same graph, scalable writes. Phase 2.

**Default recommendation: Tier 1 for `SharedConversation`** at launch (it's the
canvas/quick-chat blob and message-level graph queries aren't the first use
case), Tier 2 only when a concrete traversal needs it. `ChatMessage` (task &
feature-plan chats) goes to message-level nodes from day one since it's already
relational and free.

## Ordering & consistency

- **Per-key collapse, not global ordering.** Two events for the same `Task` id
  must apply in order; unrelated rows may interleave freely. A single Redis
  Stream consumed by one worker preserves enqueue order globally, which is
  sufficient. If we later shard consumers for throughput, shard by `id` hash so
  same-key events stay on one consumer.
- **Out-of-order FKs (the child-before-parent case).** A `Task` event may arrive
  before its `Workspace` exists in Neo4j. `MERGE` on the target by id *creates a
  stub node* if absent (`MERGE (w:Workspace {id})`), which the later Workspace
  event fills in with `SET w += $props`. So edges never fail for missing
  endpoints; nodes converge. This is the key reason MERGE-everything is correct.
- **Deletes & cascades.** Postgres `onDelete: Cascade` (e.g. deleting a `Task`
  cascades its `ChatMessage`s) fires per-row Prisma events only if done through
  the ORM cascade; DB-level cascades are invisible. Mitigation: on a `delete`
  event, `DETACH DELETE` the node (drops it and all its relationships), and let
  the backfill clean any orphaned children. Document which cascades are
  DB-enforced vs ORM-enforced.

## Initial backfill & ongoing reconciliation

The extension only captures *future* writes. Two more pieces close the loop:

1. **One-time backfill.** A script (`scripts/graphsync-backfill.ts`) pages every
   synced table (`findMany` by cursor) and emits `upsert` events into the same
   stream — so backfill and live writes share one idempotent code path. Run it
   once at launch; safe to re-run anytime (it's all `MERGE`).
2. **Daily reconciler (the safety net).** A Vercel cron (add to `vercel.json`,
   alongside the existing crons) that re-emits recently-`updatedAt` rows, or does
   a count/checksum compare per label and re-emits drift. This is what makes the
   "fire-and-forget producer can drop an event" and "bulk ops skipped" and
   "raw SQL missed" gaps *eventually consistent* rather than permanent. Most
   synced models have `updatedAt`, making incremental reconcile cheap.

With backfill + daily reconcile, the system self-heals: the worst case for any
missed write is staleness until the next reconcile, never permanent divergence.

## Failure modes (and why each is safe)

| Failure | Effect | Recovery |
| --- | --- | --- |
| Neo4j down | Events accumulate in Redis Stream | Consumer resumes on reconnect; nothing lost |
| Consumer crashes mid-batch | Unacked events stay in PEL | Re-delivered on restart; idempotent `MERGE` makes redelivery safe |
| Redis enqueue fails in-app | That one event dropped | Daily reconciler re-emits; user write unaffected |
| Bad event poisons consumer | Stuck on one entry | After N attempts → `graphsync:dead` + alert; skip and continue |
| Mapping bug ships | Wrong edges written | Fix map, re-run backfill (idempotent) to overwrite |
| Raw SQL write to synced table | Missed live | Daily reconciler converges; also flagged by the raw-write audit |
| Schema migration adds/renames column | Map drift | Regenerate `GRAPH_MAP` from DMMF in CI; test fails if a model lacks a map entry |

## Scope

**In scope (v1):** the Prisma extension producer, the Redis Stream contract, the
consumer worker on the Neo4j box, the DMMF-generated map + overrides for a chosen
subset, the one-time backfill, the daily reconciler cron, and the chat-model
handling (`ChatMessage` → message nodes; `SharedConversation` → Tier 1).

**Chosen subset for v1** (the graph people actually want to traverse): `User`,
`Workspace`, `WorkspaceMember`, `Repository`, `Feature`, `Phase`, `Task`,
`ChatMessage`, `Artifact`, `Attachment`, `Initiative`, `Milestone`. Everything
else (auth/session, infra: `Swarm`/`Pod`/`Ec2Alert`, billing:
`FiatPayment`/`LightningPayment`, config tables) is **excluded** until a use case
appears — adding a model later is one `SYNCED.add` + one map entry + a backfill
run.

**Out of scope (v1):** `SharedConversation` message-level explosion (Tier 2),
tail-diff optimization, sharded consumers, real-time guarantees tighter than
"seconds," and bidirectional sync (graph is strictly read-derived; never writes
back to Postgres).

## When to graduate to CDC

If we ever need **100% fidelity including raw SQL/migrations/manual edits**, or
the missed-write gap becomes unacceptable, swap the *producer* for Debezium on
Neon's logical replication (`wal_level=logical`, which Neon supports) feeding the
**same** Redis Stream / event contract. The consumer, mapping, backfill, and
Neo4j side are unchanged — only the source of events changes. The architecture is
deliberately producer-agnostic so this is a swap, not a rewrite.

## Resolved design decisions

1. **Extension over CDC for v1.** Filtering and mapping live in TypeScript next
   to the schema; reuses existing Redis; no new streaming infra. CDC is the
   documented upgrade path, not the starting point.
2. **Consumer runs on the Neo4j server, not Vercel.** Serverless can't host a
   long-running drain loop, and we don't want Bolt connections from ephemeral
   functions. Redis Stream is the seam between the two worlds.
3. **Events carry data, Cypher is built consumer-side.** Lets the mapping evolve
   without redeploying the app; backfill and live writes share one path.
4. **`MERGE` everything; never `CREATE`.** Makes at-least-once delivery, backfill
   re-runs, out-of-order arrival, and blob re-projection all safe by construction.
5. **`props` is an allowlist.** Privacy-first: secrets/blobs never leave Postgres;
   a test enforces it.
6. **`SharedConversation` = Tier 1 at launch; `ChatMessage` = message nodes.**
   Matches effort to value: the relational chat is free, the blob chat is not.
7. **Daily reconciler is mandatory, not optional.** It is what downgrades every
   gap (dropped enqueue, bulk op, raw SQL) from "permanent divergence" to
   "bounded staleness."
8. **Graph is read-derived only.** No write-back to Postgres, ever. One direction.

## Implementation order

1. **Contract + map scaffolding.** Define `GraphChangeEvent`; write the DMMF
   generator (`scripts/gen-graph-map.ts`) → commit generated `GRAPH_MAP`; add
   override entries for the chat models and polymorphic FKs. Unit-test
   `project(event) → Cypher ops` as a pure function (no I/O).
2. **Producer.** `src/lib/graphsync/extension.ts` + wire into `src/lib/db.ts`.
   Implement `capturePreDelete` and bulk-op enumeration. `after()` enqueue to a
   `graphsync` Redis Stream. Unit-test that mutating ops on synced models enqueue
   the right envelope and that user writes never throw/slow on enqueue failure.
3. **Consumer.** `scripts/graphsync-consumer.ts`: `XREADGROUP` loop, batched
   `UNWIND … MERGE`, `XACK`, PEL/dead-letter handling. Integration-test against a
   throwaway Neo4j (docker) with replayed events (assert idempotency on double
   delivery).
4. **Backfill.** `scripts/graphsync-backfill.ts` paging every synced table into
   the stream. Run against a copy; verify node/edge counts vs Postgres row/FK
   counts.
5. **Reconciler cron.** Add `/api/cron/graphsync-reconcile` to `vercel.json`;
   re-emit recent `updatedAt` rows; alert on drift.
6. **Chat deep-dive.** Land `ChatMessage`/`Artifact`/`Attachment` message-node
   mapping; land `SharedConversation` Tier 1. Integration-test a real
   feature-plan chat and a task chat end-to-end into the graph.
7. **Ops.** Dashboards on stream depth, consumer lag, dead-letter count;
   runbook for "Neo4j was down, drain the backlog."

## Open questions for the human

- **Where does Neo4j run** and does the consumer co-locate on it, or on a
  sidecar box with network access to both Redis and Neo4j? (Affects deploy +
  secrets, not the design.)
- **Is "seconds of lag" acceptable** for the graph, or is there a use case
  needing tighter real-time (which would push toward CDC sooner)?
- **Confirm the v1 subset.** Is the 12-model list above the right set, or are
  there others (e.g. `Connection`, `Diagram`, `JanitorRecommendation`) wanted in
  the first graph?
- **`SharedConversation` tier:** ship Tier 1 first as proposed, or is
  message-level traversal of canvas/quick chats a day-one requirement (→ Tier 2)?
