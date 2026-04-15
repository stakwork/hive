# Scorer Drilldown: Per-Agent Log Stats

## Goal

Parse agent log blobs and extract per-agent metrics (tool call counts, token estimates, bash command frequency, etc.) so we can surface them in the scorer UI without fetching blobs on every page load. This enables drill-down from feature → task → agent-level performance data.

## Context

We already have:
- `parseAgentLogStats()` in `src/lib/utils/agent-log-stats.ts` — parses a blob and returns `AgentLogStats` (totalMessages, estimatedTokens, totalToolCalls, toolFrequency, bashFrequency, developerShellFrequency)
- `ScorerDigest` table with a `metadata` JSON field that caches per-feature metrics
- `AgentLog` table with `blobUrl`, `agent` name, `taskId`, `featureId`
- Agent naming convention: `{type}-agent-{id}` where type is `plan`, `TASK_GENERATION`, `coding`, `build`, `test`, `browser`

## What we don't have

- Cached per-agent-log stats. Every time we want tool call counts, we'd have to fetch + parse the blob from Vercel Blob storage. That's too slow for the metrics page.
- Visibility into agent-level performance in the UI. The current TaskCard shows agent run counts (from a `groupBy` on AgentLog) but not what happened inside each agent session.
- Agent sessions don't yet report their timing — `startedAt` and `completedAt` fields have been added to `AgentLog` but are not yet populated by the agent orchestration. This is a future integration point.

## Design

### New fields on `AgentLog`

No separate model. We add three timing fields and a `stats` JSON field directly on `AgentLog`:

```prisma
model AgentLog {
  // ... existing fields ...
  startedAt       DateTime?    @map("started_at")
  completedAt     DateTime?    @map("completed_at")
  stats           Json?        // cached parsed/computed stats
  // ... existing relations ...
}
```

The `stats` JSON holds parsed blob output plus derived values. Null until populated (on demand or via backfill). Shape:

```ts
interface AgentLogStatsJson {
  totalMessages: number;
  estimatedTokens: number;
  durationSeconds: number | null;           // computed from startedAt/completedAt
  totalToolCalls: number;
  toolFrequency: Record<string, number>;    // { "bash": 12, "edit": 5, ... }
  bashFrequency: Record<string, number>;    // { "grep": 4, "cat": 3, ... }
  developerShellFrequency: Record<string, number>;
  conversationPreview: Array<{ role: string; text: string }>;
}
```

`startedAt` and `completedAt` are source fields on `AgentLog`, reported by the agent session. `durationSeconds` is derived from them and stored in `stats` at cache time.

### Conversation preview

The `conversationPreview` field inside `stats` stores a compressed view of the human-readable back-and-forth — first 100 characters of each `user` and `assistant` message, skipping `system`, `tool`, and `tool-result` roles. This lets a reviewer quickly scan the flow without fetching the full blob:

```ts
// Extract from parsed conversation
function buildConversationPreview(
  messages: ParsedMessage[]
): Array<{ role: string; text: string }> {
  const preview: Array<{ role: string; text: string }> = [];
  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      // Grab first text part only
      for (const part of msg.content) {
        if (part?.type === "text" && part.text) {
          text = part.text;
          break;
        }
      }
    }
    if (!text) continue;
    preview.push({ role: msg.role, text: text.slice(0, 100) });
  }
  return preview;
}
```

What you can spot at a glance:
- **Arguments:** `[user] "No that's wrong..."` → `[assistant] "I apologize..."` → `[user] "Just do X"` 
- **Misunderstandings:** `[user] "Rename the route"` → `[assistant] "I'll rename the API endpoint..."` → `[user] "No, the UI route"`
- **Clean runs:** `[user] "Implement X"` → `[assistant] "Done! Here's what I changed..."`
- **Stuck loops:** `[assistant] "Attempting fix..."` × 5 in a row
- **Wasted context:** `[user] "{3000 char system prompt}"` repeated at the start of every agent

### Agent type extraction

Parse agent type from the `agent` field name:

```ts
function extractAgentType(agentName: string): string {
  if (agentName.startsWith("plan-agent")) return "plan";
  if (agentName.startsWith("TASK_GENERATION-agent")) return "task_generation";
  if (agentName.startsWith("coding-agent")) return "coding";
  if (agentName.startsWith("build-agent")) return "build";
  if (agentName.startsWith("test-agent")) return "test";
  if (agentName.startsWith("browser-agent")) return "browser";
  return "unknown";
}
```

### Service: `src/lib/scorer/agent-stats.ts`

```ts
/** Parse + cache stats for a single agent log. Skips if stats already populated. */
async function cacheAgentLogStats(agentLogId: string): Promise<AgentLog>

/** Parse + cache stats for all agent logs in a feature. */
async function cacheFeatureAgentStats(featureId: string): Promise<void>

/** Parse + cache stats for all agent logs in a workspace (backfill). */
async function backfillWorkspaceAgentStats(workspaceId: string): Promise<{ processed: number; skipped: number; errors: number }>

/** Read agent logs with cached stats for a task. */
async function getTaskAgentStats(taskId: string): Promise<AgentLog[]>

/** Read agent logs with cached stats for a feature. */
async function getFeatureAgentStats(featureId: string): Promise<AgentLog[]>
```

The `cacheAgentLogStats` function:
1. Checks if `stats` field is already populated — if so, return it
2. Fetches the blob via `fetchBlobContent(blobUrl)`
3. Runs `parseAgentLogStats(content)` to get stats
4. Builds `conversationPreview` from the parsed messages (user + assistant only, first 100 chars each)
5. Writes JSON to `AgentLog.stats`
6. Returns the updated row

### Pipeline integration

Hook `cacheFeatureAgentStats` into the existing scorer pipeline:
- In `pipeline.ts` `onFeatureCompleted()` — after generating the digest, also cache agent stats
- In `computeAndCacheMetrics()` — optionally trigger stats caching for features that don't have them yet

### API routes

**`GET /api/admin/scorer/agent-stats?taskId=X`** — Returns agent logs with cached stats for a task. Used by the UI when expanding a task card.

**`GET /api/admin/scorer/agent-stats?featureId=X`** — Returns agent logs with cached stats for all agents in a feature (plan + task_generation + per-task agents).

**`POST /api/admin/scorer/agent-stats/backfill`** — Triggers backfill for a workspace. Body: `{ workspaceId: string }`. Processes in batches to avoid connection pool issues. Returns progress.

### UI changes

Update `TaskCard` in `ScorerDashboard.tsx`:

**Current:** Shows agent run counts (`coding: 2, testing: 1`)

**New:** When a task is expanded, show per-agent stat cards:

```
  coding-agent                    build-agent                   test-agent
  ┌─────────────────────┐        ┌──────────────────────┐     ┌──────────────────────┐
  │ 157 msgs  ~38k tok  │        │ 33 msgs  ~8k tok     │     │ 121 msgs  ~30k tok   │
  │ 12m 34s             │        │ 3m 12s               │     │ 8m 45s               │
  │ 42 tool calls       │        │ 12 tool calls        │     │ 35 tool calls        │
  │ bash: 18  edit: 12  │        │ bash: 8  shell: 4    │     │ bash: 22  edit: 3    │
  │ grep: 8  cat: 6     │        │                      │     │ grep: 12  cat: 5     │
  └─────────────────────┘        └──────────────────────┘     └──────────────────────┘
```

Each card is collapsible and shows:
- Message count + estimated tokens
- Duration (from `durationSeconds`, when available)
- Total tool calls
- Top tool names with counts
- Top bash/shell subcommands with counts
- **Conversation preview** — scrollable list of `[user] first 100 chars...` / `[assistant] first 100 chars...` lines, styled with role-based coloring (user = blue, assistant = gray). This is the quick-scan view that lets you spot arguments, misunderstandings, and stuck loops without opening the full log.

```
  coding-agent
  ┌──────────────────────────────────────────────────────────────────┐
  │ 157 msgs  ~38k tok  │  12m 34s  │  42 tool calls               │
  ├──────────────────────────────────────────────────────────────────┤
  │ [user]  Implement the settings route rename by moving src/app/… │
  │ [asst]  I'll start by examining the current settings directory… │
  │ [user]  No, don't rename the API route, only the UI page route  │
  │ [asst]  I apologize for the confusion. I'll only rename the UI… │
  │ [asst]  Done! Moved src/app/admin/settings/ → src/app/admin/po… │
  └──────────────────────────────────────────────────────────────────┘
```

Stats load lazily when expanding a task — fetched from the API on demand. Shows a spinner if the stats haven't been cached yet (triggers caching on the server side).

### Aggregate agent stats in feature metrics

Add to the feature-level metrics (stored in `ScorerDigest.metadata`):
- `totalEstimatedTokens` — sum across all agents for the feature
- `totalDurationSeconds` — sum of `durationSeconds` across all agents (when available)
- `planTokens` — tokens used by plan + task_generation agents
- `executionTokens` — tokens used by coding/build/test/browser agents
- `planVsExecutionRatio` — `planTokens / executionTokens`

Display in the aggregate metrics bar:
- **Avg tokens/feature** — average `totalEstimatedTokens` across features
- **Avg duration/feature** — average `totalDurationSeconds` across features
- **Plan overhead** — average `planVsExecutionRatio` (lower = more efficient planning)

## Implementation order

1. **Schema** — Add `startedAt`, `completedAt`, `stats` fields to `AgentLog`, migration
2. **Service** — `src/lib/scorer/agent-stats.ts` with cache/read/backfill functions
3. **API routes** — GET stats, POST backfill
4. **Pipeline hook** — Cache stats on feature completion
5. **UI: TaskCard** — Lazy-load agent stat cards on expand
6. **UI: Aggregate** — Add token + duration metrics to feature table + aggregate bar
7. **Backfill script** — `scripts/scorer/backfill-agent-stats.ts` for existing data

## Existing code locations

- **Scorer service library:** `src/lib/scorer/` — metrics.ts, session.ts, digest.ts, analysis.ts, pipeline.ts, prompts.ts
- **Scorer API routes:** `src/app/api/admin/scorer/` — metrics, sessions, insights, digests, analyze, workspaces, pattern-detect, cron
- **Scorer admin UI:** `src/app/admin/scorer/` — page.tsx (server), ScorerDashboard.tsx (client)
- **Agent log parser:** `src/lib/utils/agent-log-stats.ts` — `parseAgentLogStats()` returns `AgentLogStatsResult`
- **Blob fetcher:** `src/lib/utils/blob-fetch.ts` — `fetchBlobContent()` — requires `BLOB_READ_WRITE_TOKEN` env var for Vercel Blob private access
- **Prisma schema:** `prisma/schema.prisma`
- **Middleware route policies:** `src/config/middleware.ts` — new `/api/admin/scorer/agent-stats` routes are under `/api/admin/` which is already covered by the superadmin policy, but verify.

## Important: the taskId data problem

Many `AgentLog` rows for execution agents (coding, build, test, browser) have `taskId: null` in the DB, even though they belong to a specific task. This is a known data issue. These logs DO have `featureId` set.

When querying stats, you cannot rely on `AgentLog.taskId`. Instead:
1. If `AgentLog.taskId` is set, use it.
2. If `AgentLog.taskId` is null but the agent name contains a task-like ID suffix (e.g. `coding-agent-cmmk484lu0009jo045uq40jca`), try to match it against known task IDs for that feature. However, the suffix may be a stakwork run ID, not a task ID — so match cautiously.
3. For plan/task_generation agents, `taskId` is correctly null — these are feature-level agents.

For the UI, grouping by `featureId` + agent type is safer than grouping by `taskId`.

## Notes

- Blob fetching is the bottleneck. Backfill should process in serial (or small batches of 5) to avoid overwhelming Vercel Blob's rate limits.
- The `stats` JSON is immutable once written — agent log blobs never change. No cache invalidation needed.
- Token estimates are rough (chars/4) but consistent. Good enough for relative comparisons.
- **Backfill resilience:** The backfill function should track progress by skipping logs that already have `stats` populated. If it fails mid-way, re-running picks up where it left off. Log errors per-blob but don't abort the entire batch.
- **Route policies:** New API routes under `/api/admin/scorer/` are already covered by the superadmin middleware policy. No changes needed to `src/config/middleware.ts`.
