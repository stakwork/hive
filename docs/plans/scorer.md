# Scorer: Agent Performance Analysis System

## Goal

Build a system that lets us (Hive developers) understand how well our agents are performing, surface the highest-priority improvements, and get better automatically as models improve. The system observes the full lifecycle of a feature — from human description through planning, task execution, and PR — and identifies where our prompts, context, and tooling fall short.

## Core Principle

Don't over-specify what to look for. Compress the raw data faithfully, then let the LLM decide what matters. The system should surface things we haven't thought of yet, not just check a predefined list.

## Layers

### Layer 1: Automated Metrics

Pure computation, no LLM. Numbers for filtering, sorting, and dashboarding.

**Per-task metrics:**
- Message count before PR (fewer = better understanding)
- Correction count (number of USER messages in a task after the initial message — i.e. `ChatMessage` count where `taskId` is set, `role` = USER, minus 1 for the initial prompt. Any follow-up from a human means the agent didn't get it right the first time)
- CI pass/fail on first attempt
- PR outcome: merged / cancelled / still open
- Time from task start (`workflowStartedAt`) to PR merge
- Halt/retry attempts (`haltRetryAttempted`)
- Agent resolution attempts (`progress.resolution.attempts`)

**Per-feature metrics:**
- Plan file precision: % of files the agent touched that were predicted by the architecture
- Plan file recall: % of files the architecture mentioned that actually needed changing
- Task completion rate: tasks that produced merged PRs vs total tasks
- Total human intervention count across all tasks

**How to compute plan file precision/recall:**
- Extract file/module paths from `Feature.architecture` (regex or simple LLM extraction)
- Extract actual files from `DIFF` artifacts (`ActionResult[].file` + `.action`). A task may have multiple DIFF artifacts (agent can finish/restart multiple times), so de-duplicate files across all DIFFs for that task. The DIFF artifact is the primary source — it's generated from the pod on agent finish, before the PR is created. Falls back to GitHub API (fetch files from PR URL) if no DIFF artifacts exist.
- Compare the two sets

**Data sources:** All in the DB already. `Feature` (for `.architecture`), `Task` (for statuses and timestamps), `ChatMessage` (for message counts), `Artifact` (type `PULL_REQUEST` for PR outcomes, type `DIFF` for files touched). GitHub API needed only as fallback when DIFF artifacts are missing.

**Purpose:** These metrics are for the admin UI — sort features by "worst performing," filter to failures, spot trends over time. They are not the analysis itself.

### Layer 2: Full Session View

The complete end-to-end record of a single feature, from the human's initial description through every task to every PR. This is the "what actually happened" layer — detailed enough that a human or LLM reviewing it can understand the full agent journey through the codebase.

This is per-feature, not per-task. A feature has phases, each phase has tasks, and you see the whole thing as one narrative.

**Multiple agents, one narrative:** A feature involves multiple agents that run in sequence. Each agent produces an `AgentLog` record with a distinct `agent` name string, linked via `featureId` and/or `taskId`. Current agents:

1. **Plan agent** (AI SDK, runs on the swarm) — takes the human's description, explores the codebase, and produces the PLAN artifact (brief, requirements, architecture, user stories, task breakdown). Logs linked via `featureId`.
2. **Coding agent** (Goose CLI, runs on a pod) — executes each task: explores, edits files, produces DIFF and PR. Logs linked via `taskId`.
3. **Test agent** — runs tests after coding. Logs linked via `taskId`.
4. **Build agent** — runs builds after coding. Logs linked via `taskId`.

The structure is open-ended — new agent types just produce new `AgentLog` records with a different `agent` name. The session assembly collects all logs for a feature (by `featureId`) and its tasks (by `taskId`), groups them by agent name and timestamp, and stitches them into one chronological narrative.

**What goes into a full session:**

```
FEATURE: {title}
Workspace: {workspace.name}
Status: {feature.status}
Created: {createdAt} | Completed: {workflowCompletedAt}

--- PLANNING PHASE ---
(from plan agent logs, linked via featureId)

Human's original request: {feature chat USER messages}

Plan agent transcript (tool call inputs kept, tool results stripped):
  [ASSISTANT] Let me explore the codebase to understand the architecture.
    -> search_files({ query: "workspace", path: "src/" })
    -> read_file({ path: "src/services/workspace.ts" })
    -> read_file({ path: "src/app/api/workspaces/route.ts" })
  [ASSISTANT] I see the workspace service. Let me check the pod management.
    -> search_files({ query: "pod", path: "src/" })
    -> read_file({ path: "src/lib/pods/index.ts" })
  [USER] Actually I also need it to handle the swarm config
  [ASSISTANT] Got it, let me look at the swarm module too.
    -> read_file({ path: "src/services/swarm.ts" })
  ...

Plan output:
  Brief: {feature.brief}
  Requirements: {feature.requirements}
  Architecture: {feature.architecture}
  User Stories: {feature.userStories[].title}

--- EXECUTION PHASE ---
(tasks may be organized into phases, or directly on the feature)

PHASE 1: {phase.name} — {phase.description}    (omitted if tasks are unphased)

  TASK 1.1: {task.title}
  Description: {task.description}
  Status: {task.status} | Workflow: {task.workflowStatus}

  Context given to coding agent (featureContext):
    {the actual featureContext JSON sent via callStakworkAPI}

  Coding agent transcript (from agent logs linked via taskId):
    [USER] {message}
    [ASSISTANT] I need to find the session provider. Let me search for it.
      -> search_files({ query: "session provider", path: "src/" })
      -> read_file({ path: "src/lib/auth.ts" })
    [ASSISTANT] That's the old auth module. Let me check the middleware.
      -> read_file({ path: "src/middleware.ts" })
      -> read_file({ path: "src/lib/auth/nextauth.ts" })
    [ASSISTANT] Found it. I'll update the auth module and the provider.
      -> edit_file({ path: "src/lib/auth/nextauth.ts", ... })
      -> edit_file({ path: "src/providers/SessionProvider.tsx", ... })
    [USER] {follow-up message}
    [ASSISTANT] Got it, I also need to update the middleware config.
      -> read_file({ path: "src/config/middleware.ts" })
      -> edit_file({ path: "src/config/middleware.ts", ... })
    ...

  Files touched (de-duplicated across all DIFF artifacts for this task):
    - src/lib/auth/nextauth.ts (modify)
    - src/providers/SessionProvider.tsx (modify)
    - src/config/middleware.ts (modify)
    - src/app/api/auth/callback/route.ts (create)

  Test agent transcript (if ran):
    [ASSISTANT] Running test suite...
      -> bash({ command: "npm run test" })
    [ASSISTANT] 2 tests failed. Let me fix them.
      -> read_file({ path: "src/__tests__/auth.test.ts" })
      -> edit_file({ path: "src/__tests__/auth.test.ts", ... })
      -> bash({ command: "npm run test" })
    ...

  Build agent transcript (if ran):
    [ASSISTANT] Running build...
      -> bash({ command: "npm run build" })
    [ASSISTANT] Build succeeded.

  PR: {url} — {status}
  CI: {ciStatus} — {ciSummary}
  Duration: {workflowStartedAt} to {workflowCompletedAt}

  TASK 1.2: {task.title}
  ...

PHASE 2: {phase.name}
  ...
```

**Key design decisions:**

- **Agent logs are the primary source for the transcript, not chat messages.** Agent log blobs (stored in S3, fetched via `fetchBlobContent`) contain the full agent trace: every tool call, every reasoning step, every decision. The existing parser `parseAgentLogStats()` in `src/lib/utils/agent-log-stats.ts` already extracts structured `ParsedMessage[]` with `ToolCallContent` (tool name + input) and `ToolResultContent` (output). It supports both AI SDK and OpenAI formats.
- **Tool call inputs are kept, tool results are dropped.** The agent's decisions ("search for X", "read file Y", "edit file Z") are small and reveal the agent's path through the codebase. The tool results (actual file contents, search results) are massive and take up 99% of context. We keep every tool call with its `toolName` and `input`, but strip all `tool-result` / `tool` role messages.
- **Agent reasoning is kept verbatim.** The `reasoning` field on assistant messages (and any text content) shows the agent's thinking between tool calls — "I think the user means X, let me check Y." This is where disambiguation confusion is visible.
- Human messages (from chat messages) are kept verbatim. Always.
- The plan context (`featureContext`) that was sent to the agent is included, so you can see exactly what information the agent had.
- DIFF artifacts are expanded to show file paths and actions (create/modify/delete), not the full diff content.
- This is assembled on the fly, not stored. It can be large — that's fine. It's for deep inspection of one feature, not for batching.

**Data sources:**
- `Feature` with `.brief`, `.requirements`, `.architecture`
- `Feature.userStories`
- `Feature.phases` -> `Phase.tasks` (for phased features) and `Feature.tasks` (for unphased tasks directly on the feature)
- `AgentLog` blobs — **the primary source for transcripts.** Fetched from S3 via `fetchBlobContent(blobUrl)`, parsed with `parseAgentLogStats()` (in `src/lib/utils/agent-log-stats.ts`). Filter out `tool-result` / `tool` role messages to keep only agent reasoning and tool call inputs. Two types of logs to stitch together:
  - **Plan agent logs:** `AgentLog` records where `featureId` is set. The `agent` field identifies the plan agent (e.g. "researcher", "architect"). These contain the exploration and reasoning that produced the plan.
  - **Per-task agent logs:** `AgentLog` records where `taskId` is set, grouped by `agent` name. Includes coding agent (file exploration, edits, reasoning), test agent (test runs, fixes), build agent (build runs), and any future agent types. Each is a separate `AgentLog` record with a different `agent` string.
- `ChatMessage` where `featureId` is set — the human's messages during the planning phase (feature chat). These are the USER messages the plan agent responded to.
- `ChatMessage` where `taskId` is set — human messages during task execution. Used alongside coding agent logs.
- `Artifact` where type = `DIFF` — primary source for files touched. Contains `ActionResult[]` with `{ file, action, content, repoName }`. Generated on agent `finish` webhook from the pod's control port diff endpoint. A task may have multiple DIFF artifacts (agent can finish/restart), so collect all and de-duplicate by file path (keep the latest action per file).
- `Artifact` where type = `PULL_REQUEST` — contains `{ repo, url, status, progress? }`. Does NOT contain file lists. Use the PR URL to fetch file lists from GitHub API as a fallback when DIFF artifact is missing (e.g. pod was already gone).
- The `featureContext` sent to each coding agent can be reconstructed from `buildFeatureContext()` or captured at generation time

**When to generate:** On-demand from the admin UI (click a feature, assemble and view its full session). Always computed live from existing data — never cached.

### Layer 3: Session Digests

A compressed version of the full session (Layer 2), small enough to batch 25+ together. This is the bridge between deep single-feature inspection and wide multi-feature pattern detection.

**Generated from:** The Layer 2 full session, compressed by an LLM. This is a Sonnet call that takes the full session text and produces a condensed version following the digest format below. The LLM is instructed to preserve facts (file lists, message counts, outcomes) and identify key moments (direction changes, corrections, pivots) while dropping routine tool calls and repetitive reasoning.

Compression rules:
- Individual tool calls are collapsed into summaries: "searched 12 files, read 8, edited 5" — but the list of unique files touched is preserved. The per-call inputs (search queries, file paths) that are visible in Layer 2 are dropped here.
- Agent reasoning is trimmed to key moments only — where the agent changed direction, where the user corrected it, where it got stuck. Routine "I'll do X next" reasoning is dropped.
- The plan context is summarized to just the brief and file list, not reproduced in full
- Outcome metrics from Layer 1 are included inline (message count, correction count, CI result, duration)

**Target size:** ~50-100 lines per digest. Small enough that 25-50 fit in a single LLM context.

**What goes into a digest:**

```
Feature: {title} | Workspace: {workspace.name}
Plan accuracy: precision {X}%, recall {Y}%

Task 1: {title} [{status}]
  Messages: {N} | Corrections: {N} | Duration: {X}min
  Files planned: [list] | Files touched: [list]
  Key moments:
    - Agent initially targeted src/components/Settings.tsx
    - User corrected: "not Settings, the ThemeContext provider"
    - Agent pivoted to src/providers/ThemeContext.tsx
  PR: {url} — {merged/cancelled} | CI: {pass/fail first attempt}

Task 2: {title} [{status}]
  ...
```

**Cached in DB** so it doesn't need to be recomputed every time pattern detection runs. One digest per feature (not per task — the feature is the unit of analysis). Regenerated on demand when the underlying data changes.

**When to generate:** On-demand from the admin UI, or as part of kicking off a pattern detection run (auto-generate missing/stale digests for the selected features before sending to the LLM).

### Layer 4: Analysis

LLM-powered analysis that produces insights. Two modes:

#### Mode A: Single-Session Analysis

An LLM reads one full session (Layer 2) and analyzes it in depth. This is for when you're inspecting a specific feature and want detailed suggestions — what went wrong, where the agent wasted time, what could be improved.

**Input:** One feature's full session text (the Layer 2 output, assembled on the fly).

**When to use:** From the admin UI session view — a "Run Analysis" button on any feature. Also useful for features that scored poorly in Layer 1 metrics.

Default single-session prompt:

```
You are analyzing a single agent coding session from our AI development platform.
The session shows the full journey: the human's request, the plan agent's exploration,
and each coding agent's execution through to the PR.

Identify specific issues in this session:
- Where did the agent waste time or go in the wrong direction?
- Did the agent misunderstand the human's intent? What words or concepts caused confusion?
- Were there files or modules the agent should have found faster?
- What could we change in our prompts, context, or tooling to improve this specific case?

Be specific — reference exact tool calls, search queries, and file paths from the transcript.

{session}
```

#### Mode B: Pattern Detection

An LLM reads N session digests (Layer 3) together and finds recurring issues across multiple sessions.

**Input:** 10-50 session digests (selected by recency, worst metrics, or specific workspace).

**When to use:** Periodically, or when you want to find systemic issues rather than one-off problems.

Default pattern detection prompt:

```
You are reviewing {N} recent agent coding sessions from our AI development platform.
Each session shows a task given to a coding agent, what context it received,
how the conversation went, and the outcome.

Your job: identify the highest-priority issues we should address to improve
agent performance. Focus on patterns that appear across multiple sessions.
Rank by impact.

For each issue, explain:
- What the pattern is
- Which sessions exhibit it
- What the root cause likely is
- What we could change (in prompts, context, tooling, or documentation)

{digests}
```

#### Prompt Library

Both modes use prompts from the same `ScorerPrompt` library. Each prompt is tagged with a `mode` field (`single` or `pattern` or `both`) so the UI knows which prompts to offer in which context. Users can create custom prompts for either mode.

Example custom prompts:

- (single) "Trace the agent's search queries in order. Build a map of what terms the user used vs what terms the codebase uses. Suggest a glossary."
- (pattern) "Focus on cases where the agent explored files that turned out to be irrelevant. What could we change in the codebase documentation or graph to help it navigate more efficiently?"
- (pattern) "Look at the user's first message in each task. When did the agent misinterpret the user's intent? What vocabulary or phrasing caused confusion?"
- (both) "Compare the architecture section of the plan to the files actually touched. What concepts are poorly linked in our codebase graph?"

#### Output

Both modes produce `ScorerInsight` records with the same schema. The LLM is instructed to return structured JSON — an array of insights, each with `severity`, `pattern`, `description`, `featureIds`, and `suggestion`. The `POST /api/admin/scorer/analyze` endpoint parses this JSON and creates one `ScorerInsight` record per item. If the LLM returns malformed JSON, the raw response is stored in a failed insight for manual review.

For single-session analysis, `featureIds` contains one entry; `digestIds` is empty. For pattern detection, `featureIds` lists the affected features; `digestIds` lists which digests were input.

Example LLM output format:
```json
[
  {
    "severity": "HIGH",
    "pattern": "Agent misidentifies auth module",
    "description": "In 4 of 25 sessions, the agent searched for ...",
    "featureIds": ["feature-1", "feature-7", "feature-12", "feature-19"],
    "suggestion": "Add an alias in AGENTS.md mapping 'auth' to ..."
  }
]
```

**Why this scales with model improvements:** The prompts are simple and the input format is rich. A better model extracts more subtle patterns from the same data. Custom prompts let you dig into specific areas without changing code — just write a new prompt and run it.

## Data Model

Three stored models. Metrics and full sessions are computed live — no need to persist what you can derive from existing data.

```prisma
/// Saved prompts for Layer 4 analysis (single-session or pattern detection).
/// Users can create custom "lenses" to analyze sessions/digests from different angles.
model ScorerPrompt {
  id          String            @id @default(cuid())
  name        String            // Short label: "Default", "Navigation efficiency", "Vocab mismatches"
  description String?           // What this prompt is looking for
  prompt      String            // The full prompt template ({session} or {digests} placeholder)
  mode        ScorerPromptMode  // SINGLE, PATTERN, or BOTH — which analysis mode this prompt is for
  isDefault   Boolean           @default(false) @map("is_default")
  createdById String            @map("created_by_id")
  createdAt   DateTime          @default(now()) @map("created_at")
  updatedAt   DateTime          @updatedAt @map("updated_at")
  createdBy   User              @relation(fields: [createdById], references: [id])
  insights    ScorerInsight[]

  @@index([createdById])
  @@index([mode])
  @@map("scorer_prompts")
}

/// Layer 3: Compressed per-feature summary, small enough to batch 25-50 together.
/// Cached because these are the input to pattern detection and are non-trivial to build.
model ScorerDigest {
  id          String    @id @default(cuid())
  featureId   String    @unique @map("feature_id")
  workspaceId String    @map("workspace_id")
  content     String    // The compressed digest text (see Layer 3 format)
  metadata    Json?     // { filesPlanned, filesTouched, taskCount, keyMoments, ... }
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@index([featureId])
  @@index([workspaceId])
  @@map("scorer_digests")
}

/// Layer 4: LLM-generated findings from pattern detection.
model ScorerInsight {
  id             String        @id @default(cuid())
  promptId       String        @map("prompt_id")
  promptSnapshot String        @map("prompt_snapshot") // Exact prompt text at time of analysis (survives prompt edits)
  severity       String        // HIGH, MEDIUM, LOW
  pattern        String        // Short label: "Agent misidentifies auth module", etc.
  description    String        // Full explanation from the LLM
  featureIds     String[]      @map("feature_ids") // Feature IDs that exhibit this pattern
  suggestion     String        // What to change
  digestIds      String[]      @map("digest_ids") // Which digests were input to this analysis
  createdAt      DateTime      @default(now()) @map("created_at")
  prompt         ScorerPrompt  @relation(fields: [promptId], references: [id])

  @@index([promptId])
  @@index([severity])
  @@index([createdAt])
  @@map("scorer_insights")
}

enum ScorerPromptMode {
  SINGLE    // For single-session analysis (uses {session} placeholder)
  PATTERN   // For pattern detection across N digests (uses {digests} placeholder)
  BOTH      // Works in either mode
}
```

**What is NOT stored:**
- **Metrics (Layer 1)** — computed live from existing `Feature`, `Task`, `ChatMessage`, and `Artifact` tables. Always fresh.
- **Full sessions (Layer 2)** — assembled on the fly from the same tables. No staleness issues.

**What IS stored:**
- **Digests (Layer 3)** — cached because they're non-trivial to assemble (require querying the full feature tree + compressing). Regenerated on demand or when a feature's tasks change. `featureId` is unique — one digest per feature.
- **Insights (Layer 4)** — the output of LLM analysis. Each insight records the `promptId` it came from and a `promptSnapshot` (the exact prompt text at analysis time, so editing a prompt later doesn't retroactively change what past insights claim). Also records `digestIds` so you know which digests were input.
- **Prompts** — the reusable prompt library.

## Admin UI

New page: `/admin/scorer`

**Top-level view:**
- Automated metrics computed live, with filters (workspace, date range, feature status)
- Sort by worst-performing features
- Aggregate stats: avg message count, avg CI pass rate, plan accuracy trends over time

**Feature drill-in (Layer 2):**
- Click a feature to see its full session assembled on the fly — the entire journey from plan to PRs
- Every task's transcript with tool call inputs (files read, searched, edited)
- Plan vs reality comparison: files architecture mentioned vs files actually touched
- "Analyze This Session" button — runs single-session analysis (Layer 4 Mode A) with a chosen prompt, produces insights specific to this feature

**Digest view (Layer 3):**
- Compressed version of the session, shows key moments and outcomes
- Useful for quick scanning across many features

**Prompt library:**
- List of saved prompts with name, description, last used
- Create / edit / delete prompts
- Each prompt has a "Run" button that selects digests and kicks off analysis

**Insights (Layer 4):**
- Two entry points: "Analyze This Session" on a single feature, or "Run Pattern Analysis" across N features
- Pattern analysis: pick a prompt, select N features (or auto-select worst performers), run analysis
- Results: ranked list of insights with severity badges
- Each insight links to the features that exhibit it
- History of past insights, filterable by prompt and mode (single vs pattern), to track whether issues are getting better or worse

## API Routes

```
GET    /api/admin/scorer/metrics         — compute metrics live (filterable by workspace, date range)
GET    /api/admin/scorer/sessions/[id]   — assemble full session on the fly for a feature
POST   /api/admin/scorer/digests         — generate/regenerate digests for selected features
GET    /api/admin/scorer/digests         — list stored digests
POST   /api/admin/scorer/analyze         — run analysis. Body: { promptId, mode: "single" | "pattern", featureId? (for single), digestIds? (for pattern) }
GET    /api/admin/scorer/insights        — list insights (filterable by prompt, severity, date, mode)
GET    /api/admin/scorer/prompts         — list saved prompts (filterable by mode)
POST   /api/admin/scorer/prompts         — create a new prompt
PATCH  /api/admin/scorer/prompts/[id]    — edit a prompt
DELETE /api/admin/scorer/prompts/[id]    — delete a prompt
```

All under `/api/admin/` prefix — already covered by superadmin middleware policy.

## Implementation Order

1. **Schema + migration** — add the three new models (`ScorerPrompt`, `ScorerDigest`, `ScorerInsight`)
2. **Metrics computation** — API route that queries existing data live and computes per-task/per-feature metrics. No LLM, immediately useful.
3. **Admin UI: metrics view** — table of features with sortable metric columns
4. **Full session assembly** — API route that builds the complete feature session on the fly from existing data. No persistence needed.
5. **Admin UI: session view** — click a feature to see its full end-to-end session
6. **Digest generation** — API route that compresses sessions into digests. Cached in DB.
7. **Prompt library** — CRUD for scorer prompts + admin UI for managing them
8. **Pattern detection** — API route that batches N digests with a chosen prompt, sends to LLM, stores insights
9. **Admin UI: insights panel** — display ranked insights, filterable by prompt

Steps 1-5 are immediately useful without any LLM calls or new stored data. Steps 6-9 add the intelligence layer.

## Future Directions

- **Automatic digest regeneration** — trigger on feature completion via webhook, so digests stay fresh
- **Scheduled pattern detection** — weekly cron that auto-runs the default prompt on recent digests and surfaces new insights
- **Feedback loop** — when an insight leads to a prompt change, track whether metrics improve in subsequent features
- **Adaptive compression** — as context windows grow, digests can include more raw data (more transcript, actual code snippets), making pattern detection sharper
- **Cross-workspace patterns** — find issues that affect all workspaces vs workspace-specific problems
