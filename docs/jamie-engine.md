# Jamie engine — Hive or the strut orchestrator

A per-browser experiment that picks which engine answers the org canvas chat
(Jamie, `/org/<githubLogin>?chat=<id>`). Two values:

| Switch | What answers a message                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------- |
| off    | Today's canvas agent (`src/lib/ai/runCanvasAgent.ts`) with its tools, cards and approval flow. **Default.** |
| on     | One run of the swarm strut's `orchestrator` workflow per message (`src/services/strut-orchestrator.ts`). |

The strut path is an **option** beside the default, never a replacement:
with the switch off every existing code path runs exactly as before, and
nothing about the org, the user or the conversation records the choice.

## Where it lives

- A **Strut orchestrator** switch in the chat header's ⋯ menu (and the
  mobile chat actions sheet), next to the Concept-tree prompt, which it
  mirrors: `localStorage` only (`src/app/org/[githubLogin]/_state/strutEnginePreference.ts`,
  key `hive.jamieStrutEngine`), off by default, storage errors read as off.
  Any org member can flip it for their own browser; the rest of the org is
  untouched.
- Sent with each canvas chat request as `strutEngine: true`
  (`useSendCanvasChatMessage`), exactly like `slimPrompt`. The route
  (`/api/ask/quick`) reads the flag off the body; nothing is looked up.
- Server-side turns — planner wakes, automations, anything not sent from a
  browser — never carry the flag, so they always run on Hive.

## The strut path, turn by turn

1. **Launch** — `/api/ask/quick` persists the user's row as today, then
   (`strutEngine: true`) hands the turn to `runOrchestratorTurn` instead of
   `runCanvasAgent`. That dispatches a `StrutRun` of kind `orchestrator_turn`
   through `dispatchStrutRun` (purpose `orchestrator` → the org default
   swarm, like `chat` and `job`):

   ```
   POST {labBase}/workflows/orchestrator/run
   x-api-token: <swarm key>   x-strut-actor: <the user's actor>
   { "input": { "prompt": "@<slug>\n<message>", "session": "<SharedConversation.id>",
                "context": { "line": "Mon 19 Oct, 14:02, Europe/London. " } },
     "callback": { "url": ".../api/strut-runs/webhook?id=<row>&token=…" } }
   ```

   The 202 must say `callback: true`. A launch-marker row
   (`orchestrator-launch-<row>`, `source.kind: "orchestrator_launch"`) is
   written once strut accepted; the chat shows a working card on it. The
   route answers an empty UI-message stream (nothing to stream yet).
   A second message while strut is still on the first is refused as
   "Still working on your last message" — by hive when a PENDING row
   exists for the conversation, or from strut's `session_busy:` / 409.

2. **Reply** — the `run.end` callback settles the row; the
   `orchestrator_turn` handler (`src/services/strut-runs/orchestrator-turn.ts`)
   reads the run's artifacts and proposals from the row's swarm and appends,
   in one transaction:
   - `orchestrator-<row>` — the reply (`text`, `ask` as a question,
     `artifacts` mapped by the job turn's `mapStrutArtifacts`),
     `source.kind: "orchestrator"`; a plain bubble in the chat;
   - one `orchestrator-<row>-proposal-<id>` row per proposal,
     `source.kind: "proposal"` — a `StrutProposalCard`.
   No Jamie wake, no auto-turn: strut's agent remembers the conversation
   through its session.

3. **Proposals** — a gated graph write the agent asked for is recorded on
   strut, not run (strut `specs/API.md` §12). The card reads the record live
   through `GET /api/orgs/[githubLogin]/strut/proposals/[id]?run=<row>` and
   decides at `POST …/proposals/[id]/decide { runId, action, reason?, input? }`,
   which forwards to `POST {labBase}/proposals/:id/decide` **as the clicking
   user** (`x-strut-actor`) and appends a result row ("Applied: …",
   "Rejected: …", or the error; `source.kind: "proposal_result"`). Both
   routes require org membership, a conversation the caller owns or that is
   shared, and a record that names the turn's run as its proposer. A failed
   proposal can be accepted again; a decided one answers 409 with its record.

   Card bodies: `graph/create-node`, `graph/create-triplet`,
   `graph/create-batch-triplet`, `graph/move-node` and `graph/delete-edge`
   (by endpoints) reuse hive's graph proposal bodies; `graph/edit-node` shows
   the patch and the properties to drop; `graph/delete-node` the node; any
   other step a key/value table of its input.

4. **Readout** — `read_conversation` (org MCP) lists each strut proposal
   row with its latest status.

## Jobs the orchestrator starts

Strut's orchestrator is granted `job/start` and `job/continue`: it hands
bigger work to strut's `job` workflow and ends its turn. That job runs
**detached inside strut** — hive launched nothing, so no `StrutRun` row
exists for it — and, per strut `specs/CALLBACKS.md` §4 ("A job your run
started"), its `run.end` is posted to the **orchestrator turn's** callback
URL with `workflow: "job"`, the job id, the job run's `runId`, its output
and its resolved artifacts.

1. **Adoption** — the strut-runs webhook (`src/app/api/strut-runs/webhook`)
   recognises that payload under an `orchestrator_turn` row and, instead of
   answering 400 for the workflow mismatch, finds-or-creates a `job_turn`
   row for (the row's swarm, `job`, `runId`) — an upsert on the unique
   index, so two deliveries mint one row. Everything that routes the reply
   is copied from the orchestrator row (workspace, user, swarm,
   conversation); the job id and run id are strut's; the input is a hive
   launch's shape with an empty prompt, `via: "orchestrator"` and the
   orchestrator row as `parentRunId`; the token is fresh and unused (strut
   posts to the orchestrator's URL). The row is then settled through
   `completeStrutRun` like any job turn, so `handleJobTurnSettled` runs
   unchanged: artifacts read from the swarm, the claims and trace cards,
   the artifact index, the reader route (`/jobs/<job>/files/…` now has a
   row to match), PR events and the one automatic check-failure fix. A
   replay of the same `run.end` finds the row and takes the settled path.
   Every later turn of such a job that hive launches — an event's, a card's
   — carries `via: "orchestrator"` forward from the first.

   **While it works.** The orchestrator turn that launched the job usually
   settles first (`job/start` returns at once). Its handler reads the run's
   event log (`GET …/runs/<runId>/events`), picks out each `tool:job_start`
   / `tool:job_continue` call (`parseOrchestratorJobCalls`), mints that job
   run's `job_turn` row PENDING through the same upsert
   (`services/strut-runs/orchestrator-jobs.ts`), and puts the jobs on the
   reply row as `source.jobs: [{ jobId, title, runId }]`. The chat hangs a
   running `PendingJobTurnCard` under the reply until `job-<runId>` lands —
   so a job that beat the reply draws nothing. A log strut cannot serve
   delivers the reply without the card.

2. **The wake goes to the orchestrator** (`src/services/strut-orchestrator-wake.ts`).
   Where a hive-launched job's row wakes the canvas agent to summarize it,
   a row marked `via: "orchestrator"` launches one turn of strut's
   orchestrator on the same conversation and session, with a wake prompt
   modeled on the canvas agent's: the job's outcome, its reply text
   **inline** (strut's agent cannot read hive's rows; capped), its question,
   the cards the user already sees, and three choices — summarize (the
   default), continue through its own `job/continue`, or stay silent. The
   reply lands as a normal orchestrator row. The wake runs behind the same
   gates as hive's own (`runGatedAutoTurn` in `canvas-strut-autoturn.ts`):
   the master kill switch, the per-conversation claim, the owner's
   `canvasAutonomousTurns` opt-in, idempotency — the launch marker row
   carries the job row's id as `wakeId` — and a loop breaker that counts
   job rows since the last human message (`countTrailingJobRows`, cap
   `MAX_CONSECUTIVE_STRUT_DISPATCHES`), since continue → land → wake →
   continue could otherwise cycle.

   - **Silence** is a text convention: the orchestrator answers with
     exactly `[silent]` (`ORCHESTRATOR_SILENT_MARKER`) and the handler
     appends a `silent` row with no text — the row must land for the
     working card to clear — which the chat and the readout skip, unless
     the turn still produced cards.
   - **Busy** is never a notice. A person's turn in flight, or the
     orchestrator turn that started the job still ending, makes the launch
     busy (hive's pending-row guard or strut's `session_busy`); the wake is
     retried a bounded number of times inside the callback's after-response
     budget (`ORCHESTRATOR_WAKE_RETRY_DELAYS_MS`), then dropped with a log —
     the orchestrator reads the job back through `job/get` on its next turn.

Known gaps:

- **No live strip.** Strut registers a `jobCallback` only on a launch hive
  makes; a job started inside strut has none, so its live updates (shots,
  a recording, a pod, a check's verdict) never reach `/api/strut-jobs/events`.
  The running card shows (above), but its strip stays empty until the reply
  lands whole.
- **PR attribution.** A hive-launched job pushes the owner's GitHub token
  to strut as the actor's secret before each turn. A strut-started job's
  first turn had no such push, so a pull request it opens is attributed to
  strut's deployment token, not the user. Later turns hive launches (an
  event's) push the token as usual.

## What the strut path cannot do yet

- Hive-owned proposal kinds — initiatives, milestones, prompts — have no
  strut step, so the orchestrator cannot propose them. Features, research
  and the other Hive-engine tools are likewise not on this path.
- Attachments on a message are not forwarded to strut (text only).
- Flipping the switch mid-conversation starts a **cold** strut session (the
  session is new to strut, and hive replays nothing), and flipping it back
  leaves Hive's agent without strut's turns in its history. Start a fresh
  conversation after switching.
- The switch is per browser, so two people in one shared conversation can be
  on different engines. Each engine only sees the rows the other appended,
  not its memory.
- Depends on the swarm's lab seeding the orchestrator's graph tools and
  gating the writes as proposals — stakwork/stakgraph#1799 — and on a strut
  with proposals (stakwork/strut#222). Without the workflow the launch
  fails with a clear "no `orchestrator` workflow yet" notice.
