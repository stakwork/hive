# Scorer Pipeline

Analyzes agent coding sessions to surface actionable insights about agent performance.

## Pipeline steps

```
session.ts          Assemble raw transcript from chat messages + agent logs
    |
digest.ts           Compress transcript into a 50-100 line summary (LLM)
    |
agent-stats.ts      Parse agent log blobs into per-agent token/tool/duration stats
    |
metrics.ts          Compute per-feature metrics (corrections, plan accuracy, duration)
    |
analysis.ts         Send session or digests to LLM, parse JSON response into ScorerInsight records
    |
prompts.ts          Default prompts for single-session and pattern-detection modes
```

## Two analysis modes

- **Single-session** (`analysis.ts → analyzeSingleSession`) — analyzes one feature's full transcript. Produces insights about that specific session.
- **Pattern detection** (`analysis.ts → analyzePatterns`) — reviews many compressed digests at once. Finds recurring issues across features.

## Triggers

### Automatic (`pipeline.ts → onFeatureCompleted`)

Fires when all tasks on a feature reach terminal state. Runs the full pipeline:

1. `generateDigest(featureId)` — compress the session
2. `cacheFeatureAgentStats(featureId)` — parse agent log stats
3. `computeFeatureMetrics(featureId)` — check thresholds
4. If thresholds exceeded → `analyzeSingleSession(featureId)`

Thresholds: >2 corrections, CI failed first attempt, plan accuracy <50%, or duration >3x workspace avg.

### Manual (API: `POST /api/admin/scorer/analyze/[featureId]`)

"Analyze" button in the scorer dashboard. Runs the same steps as automatic (digest → agent stats → analysis) but always runs analysis regardless of thresholds.

### Cron (`pipeline.ts → runPatternDetectionCron`)

Daily. For each scorer-enabled workspace, if 10+ new digests exist since the last pattern detection run, triggers `analyzePatterns`.

## Data flow

```
Feature completion
  → ScorerDigest (compressed session text)
  → AgentLog.statsJson (cached per-agent stats)
  → ScorerInsight (severity + pattern + description + suggestion)
```

Insights are displayed in the scorer dashboard, sorted HIGH → MEDIUM → LOW then by recency.
