# Jamie engine — the strut orchestrator

Jamie — the org canvas chat (`/org/<githubLogin>?chat=<id>`) — runs on the
swarm strut's `orchestrator` workflow, for every user in every org. Each
turn of an org conversation is one run of it (`src/services/strut-orchestrator.ts`);
the reply lands later as rows through the strut-runs webhook. Hive's own
canvas agent (`src/lib/ai/runCanvasAgent.ts`) no longer answers Jamie.
There is no switch: the server decides, and nothing about the org, the user
or the conversation records a choice.

## Where a turn starts

Every path that writes a Jamie reply into an org conversation launches an
orchestrator turn through `launchOrchestratorTurn`:

| Path | What starts the turn |
| ---- | -------------------- |
| `/api/ask/quick` | A person's message in the chat (web, and the native app's server-history mode — a turn id is minted when the client sends none). Answers an empty UI-message stream at once. |
| `/api/ask/sync` | A live (non-dry-run) message from a synchronous caller (the native app): the route waits for the reply rows (`awaitOrchestratorReply`, up to `ORCHESTRATOR_REPLY_WAIT_MS`) and returns them, or `pending: true` with none. |
| `/api/calls/turn` | A request Jamie heard on a voice call (sphinx-voice), as `"<speaker>: <text>"` with the transcript excerpt attached. One conversation per call, run as the person who started it (`lib/calls/callRecord.ts`); the call line ends `context.line`. Voice reads the replies — wake replies too — from `/api/calls/messages` and stops a turn with `/api/calls/cancel`. |
| `strut-runs/job-turn.ts` | A job's turn landed in the conversation — whoever started the job (`strut-orchestrator-wake.ts`). |
| `automation-dispatcher.ts` | A scheduled automation: a fresh conversation with its prompt, the turn as its owner. |
| `deferred-chat-action-dispatcher.ts` | A check-back scheduled in an older conversation comes due; a conversation still busy puts it back for the next sweep. |
| `legal-benchmark-jamie-chat.ts` | A benchmark run asked for a review chat. |
| `system-map/finding-fix.ts` | An Infosec finding's automated fix. |

Each turn carries the person's model pick (`User.chatAgentModel`, the
composer's model picker) as `params.model`; none → the workflow's default.
A turn hive starts with nobody watching (an automation, a check-back, a
benchmark review) writes a refused launch into the conversation as the
reply, since no browser is there to show the notice.

What still runs Hive's canvas agent, and is not Jamie:

- `/api/ask/sync` **dry runs** (the eval harness): they score that agent's
  replies and proposals without writing anything, which strut cannot do.
- The workspace dashboard chat (`DashboardChat`) and public viewers on
  `/api/ask/quick` — no `orgId`.
- The org MCP's `org_agent` tool (`src/lib/mcp/orgMcpTools.ts`), its
  research and graph-walk sub-agents, and the plan-mode org-context scout.
- Approve / reject on a Hive proposal card in a conversation from before
  the move (`approvalIntent` on `/api/ask/quick`): the side effect runs, no
  agent turn follows.

## The strut path, turn by turn

1. **Launch** — `/api/ask/quick` persists the user's row, then hands the
   turn to `runOrchestratorTurn`. That dispatches a `StrutRun` of kind `orchestrator_turn`
   through `dispatchStrutRun` (purpose `orchestrator` → the org default
   swarm, like `chat` and `job`):

   ```
   POST {labBase}/workflows/orchestrator/run
   x-api-token: <swarm key>   x-strut-actor: <the user's actor>
   { "input": { "prompt": "@<slug>\n<message>", "session": "<SharedConversation.id>",
                "context": { "line": "Mon 19 Oct, 14:02, Europe/London. " } },
     "params": { "model": "<the person's pick, when they made one>" },
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

2. **Every job turn wakes the orchestrator** (`src/services/strut-orchestrator-wake.ts`).
   A job row landing in a conversation — one the orchestrator started
   (`via: "orchestrator"`), or one hive launched (a card, an event about an
   artifact, a job from a conversation older than the move) — launches one
   turn of strut's orchestrator on the same conversation and session, with
   a wake prompt: the job's outcome, its reply text **inline** (strut's
   agent cannot read hive's rows; capped), its question, the cards the user
   already sees, and three choices — summarize (the default), continue
   through its own `job/continue`, or stay silent. The reply lands as a
   normal orchestrator row. The wake runs behind `runGatedAutoTurn` in
   `canvas-strut-autoturn.ts`: the master kill switch, the
   per-conversation claim, idempotency — the launch marker row carries the
   job row's id as `wakeId` — and a loop breaker that counts job rows
   since the last human message (`countTrailingJobRows`, cap
   `MAX_CONSECUTIVE_STRUT_DISPATCHES`), since continue → land → wake →
   continue could otherwise cycle. There is no per-user opt-in: without the
   wake the orchestrator never sees the job's reply, and "ok, do it" after
   its question reaches an agent that never saw it.

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

## What it cannot do yet

- Hive-owned proposal kinds — initiatives, milestones, prompts — have no
  strut step, so the orchestrator cannot propose them. Features, research
  and Hive's other canvas-agent tools are likewise not on this path.
- A conversation from before the move has Hive's turns in its rows but not
  in strut's session: the orchestrator starts that conversation cold.
  `job/get` and the job index still reach what its jobs did.
- Depends on the swarm's lab seeding the orchestrator's graph tools and
  gating the writes as proposals — stakwork/stakgraph#1799 — and on a strut
  with proposals (stakwork/strut#222). Without the workflow a launch fails
  with a clear "no `orchestrator` workflow yet" notice.

## Where the user is (`context.line`)

`context.line` is built from three parts, in order: the time line
(`orchestratorContextLine`), the canvas line (`On the canvas: …`, only on the
Brainstorm tab with an initiative open; unchanged), and a generic
**where-the-user-is** line built from the user's breadcrumb path:

```
Where the user is: Org › Workspace "hive" (`ws:…`) › Initiative "Self-serve onboarding" (`ref`) › Feature "Guided setup" (`ref`) [view: Canvas / Brainstorm]. 
```

The last path step is what "this" / "here" mean. Optional tags: `selected: …`
(graph node), `open question: …` (brainstorm board).

- **Client** (`OrgCanvasView`): publishes `pageContext` `{ surface, view, tab,
  path: [{ kind, name, ref }], selected?, question? }` into the chat
  conversation's context and `useSendCanvasChatMessage` sends it to
  `/api/ask/quick`. The path reuses the canvas library's breadcrumb trail
  (labels + refs), topped up with the open initiative / selected card from
  `initiativeFocus` (`buildPageContextPath`); nothing is tracked twice.
- **Server**: `sanitizePageContext` (`src/lib/jamie-page-context.ts`) keeps
  names and refs only — control characters, quotes, backticks and markdown
  are stripped, names cap at 80 chars, the path at 8 steps (root + deepest
  kept), selections at 5, malformed refs drop their step, and the kind comes
  from the ref prefix. `verifyPageContextRefs`
  (`src/services/jamie-page-context.ts`) then checks `ws:` / `initiative:` /
  `feature:` / `milestone:` refs belong to the user's org, and accepts graph
  ref_ids only when the existing focus parsers already vetted them against
  the request's workspaces; the path is cut at the first step that fails.
- **Surfaces**: only the org page's Jamie chat (chats, canvas Map /
  Initiatives / Brainstorm, graph views) publishes it. Workspace, task,
  plan and agent-logs pages use `DashboardChat`, which sends no `orgId`, so
  they never reach the orchestrator and are unchanged.
