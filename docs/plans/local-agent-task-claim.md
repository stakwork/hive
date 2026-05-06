# Local Agent Task Claim

## Problem

Today, Hive Tasks are executed exclusively by cloud agents. The pipeline is:

1. User creates a Feature ("Plan") and Stakwork generates a plan + suggested tasks.
2. User assigns tasks to the Task Coordinator (`systemAssigneeType = TASK_COORDINATOR`).
3. The cron dispatcher (`executeTaskCoordinatorRuns`) atomically claims a pod, calls `startTaskWorkflow`, and dispatches the Task to Stakwork, which runs an agent in a sandbox pod.
4. Artifacts (chat, IDE/BROWSER, PR) flow back via `/api/chat/response` and friends; a `PULL_REQUEST` artifact auto-marks the Task DONE.

A workspace member who would rather drive a Task locally — with Claude Code, Goose, Codex, or any agent of their choice — has no first-class path. They can manually look at the Task, work on the repo, open a PR, and update the Task by hand, but Hive doesn't know an agent is running and the Task chat / artifact / status pipeline is bypassed.

## Goal

Let any workspace member **claim a Task and run it locally** with their agent of choice, while still feeding the Task's chat history, artifacts, and final PR through the same pipeline a cloud agent uses. No new infrastructure (queues, brokers, separate services) — only a recombination of existing building blocks.

## Non-Goals

- Running cloud agents on the user's machine. The local agent is whatever the user runs (Claude Code, etc.).
- Pod provisioning for local runs. Local runs do not consume a pod.
- Replacing the cloud pipeline. Both modes coexist; a Task can be claimed by either.

## Existing building blocks we'll reuse

| Piece | Where | What it gives us |
| --- | --- | --- |
| Atomic claim primitive | `src/services/task-workflow.ts:237` (`startTaskWorkflow`'s conditional `updateMany`) | Race-safe state transition pattern |
| Per-task webhook secret + JWT | `src/app/api/agent/route.ts:303` + `src/lib/auth/agent-jwt.ts` | Per-task scoped credential, easy revocation |
| MCP HTTP transport + auth | `src/lib/mcp/handler.ts:498` | Workspace API key auth and stateless tool-calling surface that local CLIs already use (`stadeum/stadeum.mjs`) |
| Assistant message persistence | `src/app/api/agent/webhook/route.ts` | Pattern for writing `ChatMessage(role: ASSISTANT)` + tool-call/tool-result logs |
| PR auto-complete | `src/app/api/tasks/[taskId]/messages/save/route.ts:97` | Posting a `PULL_REQUEST` artifact already auto-marks the Task DONE |

## Design

### Claim representation

Reuse existing fields. On claim, atomically set:

- `task.mode = "local"` (signals the cron dispatcher and any other automation to skip this Task)
- `task.assigneeId = userId` (the human who owns this run)
- `task.workflowStatus = IN_PROGRESS`
- `task.workflowStartedAt = now()`
- `task.agentWebhookSecret = <encrypted random secret>` (mints the per-task channel)

The claim is rejected if any of the following are true:

- `stakworkProjectId != null` (a cloud workflow is in flight)
- `systemAssigneeType != null` (queued for the Task Coordinator)
- `assigneeId != null && assigneeId != userId` (already claimed by another user)
- `workflowStatus == IN_PROGRESS` and `mode != "local"` for this user

The atomic guard is the same `updateMany`-with-`where`-clause trick `startTaskWorkflow` already uses.

### Auth

Per-task JWT minted at claim time, signed with the per-task `agentWebhookSecret`. Mirrors the V2 broker (`/api/agent` ↔ `/api/agent/webhook`). Revocation is just clearing `agentWebhookSecret` on the row (e.g. on `release_task` or claim-expiry).

The local agent receives this JWT in the `claim_task` response and presents it on every subsequent write to a per-task webhook endpoint. The existing workspace API key still authenticates the initial discovery and claim calls via MCP.

### New MCP tools

Added to `src/lib/mcp/mcpTools.ts` and registered in `src/lib/mcp/handler.ts`:

| Tool | Purpose |
| --- | --- |
| `claim_task(taskId)` | Atomic claim. Returns `{ webhookToken, branch, repoUrl, baseBranch, contextPack }`. |
| `release_task(taskId, reason?)` | Reverse claim. Restores `workflowStatus = PENDING`, clears `agentWebhookSecret`, leaves chat history intact. |
| `post_assistant_message(taskId, text, artifacts?)` | DB-direct write of `ChatMessage(role: ASSISTANT)` (mirrors what `/api/agent/webhook` does for `text` events). |
| `post_pr_artifact(taskId, prUrl, title, summary)` | Wraps the auto-DONE PR-artifact path in `messages/save`. |
| `update_task_status(taskId, status, workflowStatus?)` | Wraps the existing `PATCH /api/tasks/[taskId]` semantics. |

All tools enforce `record.workspaceId === auth.workspaceId` (existing MCP helper). Write tools additionally require either (a) the workspace API key + `assigneeId == userId` check, or (b) a valid per-task JWT.

### `stadeum` CLI subcommands

Thin wrappers over the new MCP tools — the CLI work is trivial once the tools exist:

```
stadeum claim <taskId>          # claims and prints { webhookToken, repoUrl, branch }
stadeum say <taskId> <text>     # posts an assistant message
stadeum log <taskId> <event>    # posts a tool-call / tool-result log entry
stadeum finish <taskId> <prUrl> # posts PULL_REQUEST artifact, auto-DONE
stadeum release <taskId>        # release the claim
```

The expected local agent loop is a small driver script (or Claude Code subagent) that:

1. `stadeum claim` → captures repo + branch + token.
2. Runs the agent locally against the repo.
3. Streams text/tool events with `stadeum say` / `stadeum log`.
4. On PR: `stadeum finish`.

### Cron / dispatcher exclusion

`processTicketSweep` (`src/services/task-coordinator-cron.ts:138`) only picks tasks with `systemAssigneeType: TASK_COORDINATOR`, so locally-claimed tasks are naturally ignored. Two small additions:

- `releaseStaleTaskPods` (line 264) gains a "no pod, just revert" branch for stale local claims (where `mode == "local"` and `podId == null`).
- A claim TTL (e.g. 24h since last assistant message) auto-releases abandoned local claims.

### UI surface (later)

Out of scope for v1, but worth noting:

- A "Claim locally" button on the Task page that surfaces a copy-pasteable `stadeum claim <taskId>` command.
- A small badge on the Task showing "Running locally — @username" while `mode == "local"`.
- Pod-related UI (IDE/BROWSER artifact panes) should null-safely hide when `task.podId == null`.

## Open questions

1. **Claim TTL.** 24h matches `releaseStaleTaskPods`. Worth making configurable per-workspace?
2. **Multi-task claims per user.** Allowed by default? Cloud agents are gated by pool size; local has no such gate, but spam protection might be worth a per-user concurrent-claim limit.
3. **PR artifact provenance.** When a PR comes from a local run, do we want a `source: "local"` flag on the artifact for downstream analytics?
4. **MCP write-tool auth.** Do we accept the workspace API key alone for `post_assistant_message` (simpler) or require the per-task JWT (tighter)? The current proposal accepts either; we should pick one before shipping.
5. **Agent log parity.** Cloud agents push structured `AgentLog` rows (S3 blob URLs). Locals would post chat-style logs only. Do we want a thin upload endpoint for parity in the AgentLog UI, or is chat-only good enough for v1?

## Why this is feasible

The architectural skeleton already exists. The Mode-B V2 broker (`/api/agent` + `/api/agent/webhook`) is a working blueprint of "external agent ↔ Hive task" with proper per-task auth and a webhook event vocabulary. Local-claim is essentially:

> MCP auth surface (already global) + V2 webhook secret pattern (already per-task) + `startTaskWorkflow`'s atomic-claim trick (already proven) + one new claim-state signal (`mode = "local"`).

No new services, no new transports, no schema migration beyond reusing existing fields.
