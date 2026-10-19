# Jamie engine — Hive or the strut orchestrator

An org-level setting that picks which engine answers the org canvas chat
(Jamie, `/org/<githubLogin>?chat=<id>`). Two values:

| Value   | Label (settings UI)  | What answers a message                                                                                   |
| ------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| `hive`  | Hive                 | Today's canvas agent (`src/lib/ai/runCanvasAgent.ts`) with its tools, cards and approval flow. **Default.** |
| `strut` | Strut orchestrator   | One run of the swarm strut's `orchestrator` workflow per message (`src/services/strut-orchestrator.ts`). |

The strut path is an **option** beside the default, never a replacement:
with the setting on `hive` every existing code path runs exactly as before.

## Where it lives

- Stored on `SourceControlOrg.jamieEngine` (`source_control_orgs.jamie_engine`,
  text, default `'hive'`; migration `20261019120000_source_control_org_jamie_engine`).
- Read per request by `jamieEngineForOrg(orgId)` (`src/lib/ai/jamieEngine.ts`).
  Fails closed to `hive`: a missing org, an unknown value or a lookup error
  all leave the default path alone.
- Flipped from **Org settings → Jamie** (`JamieEngineSettings`), which
  reads and writes `GET`/`PATCH /api/orgs/[githubLogin]/settings`
  (`{ jamieEngine: "hive" | "strut" }`). Owners and admins only, like the
  default-workspace setting on the same route.

## The strut path, turn by turn

1. **Launch** — `/api/ask/quick` persists the user's row as today, then
   (engine `strut`) hands the turn to `runOrchestratorTurn` instead of
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

## What the strut path cannot do yet

- Hive-owned proposal kinds — initiatives, milestones, prompts — have no
  strut step, so the orchestrator cannot propose them. Features, research
  and the other Hive-engine tools are likewise not on this path.
- Attachments on a message are not forwarded to strut (text only).
- Flipping the engine mid-conversation starts a **cold** strut session (the
  session is new to strut, and hive replays nothing). Start a fresh
  conversation after switching.
- Depends on the swarm's lab seeding the orchestrator's graph tools and
  gating the writes as proposals — stakwork/stakgraph#1799 — and on a strut
  with proposals (stakwork/strut#222). Without the workflow the launch
  fails with a clear "no `orchestrator` workflow yet" notice.
