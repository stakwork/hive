# Jobs: explore first, keep what was found as a note

Status: built 2026-10-09, not deployed. Stakgraph:
[stakwork/stakgraph#1756](https://github.com/stakwork/stakgraph/pull/1756).
Hive: the pull request that adds this file.

## Problem

Today a code change through Jamie looks like this:

1. Jamie answers questions with `repo_agent`. What it learns stays in
   Jamie's context.
2. Jamie starts a job with the user's words and a repository URL, nothing
   else (the `start_job` rule).
3. The job's agent has no repository checked out and no page telling it to
   look first. The `Code Change` page sends a one-sentence change straight to
   `code-change-pr`.
4. The coder gets a thin brief and a system prompt that says to keep the
   change minimal.

Each step hands the next one less. The coder does the change with barely
any context.

## The shape we want

The job's `work` agent is a coordinator. It talks with the person over many
turns and hands work to sub-agents, each a child run with its own context:

| Work | Who does it | What comes back |
| --- | --- | --- |
| Reading code | `explore`, on this strut or a peer | answer, sources, confidence |
| Changing code | `code-change-pr`, or the agent in a pod | the pull request |
| Seeing a running page | `browser-explore` | answer and screenshots |

What `explore` finds is written as a **note** in the job directory,
`notes/<topic>.md`, shown to the person as an artifact card. Later turns and
the coder start from the note. Nothing is explored twice, and nobody has to
carry findings by hand: Jamie does not pass its own findings into the job.

Jamie is the layer that knows how the org's workspaces fit together. It
names them in the job prompt as `@slug`. The org strut runs on the org's
default workspace, so it explores that workspace locally and every other
workspace on that workspace's own strut, which Hive already registers as a
peer by slug.

The machinery exists already: `meta/run-workflow` runs a child under the job,
`strut/run-workflow` runs one on a peer, `explore` is seeded on every lab.
What was missing is wiring and two bugs.

## Bugs found

- **`explore` cannot run inside a job turn.** Under a job its session
  defaulted to the job id. The job agent holds that session for its whole
  turn, and strut allows one holder per session, so the child fails
  `session_busy:`. A peer call never forwards the job, so peers were fine.
- **Pods always came from the default workspace.** Jobs route to the org's
  default workspace, and the launch's `workspace` was that workspace's id,
  whatever workspace Jamie named.

## Steps

Stakgraph (`mcp/src/lab`, seeded, no Hive release needed):

1. **`explore` starts cold.** Its session comes only from the input, never
   from the job. The note is the memory between explorations.
2. **The job agent may call peers.** Add `strut/run-workflow` to the `job`
   workflow's tools. The launch's `workspace` is now the home workspace's
   slug, and the prompt says so.
3. **An `Explore` page under `Job`.** When to explore, how to run it locally
   or on a peer by `@slug`, and how to write and reuse the note.
4. **The `Job` page says how work is split.** Delegate reading, changing and
   seeing. Keep the thread to the conversation and its conclusions. It names
   no kind, as before.
5. **`Code Change` sizes against notes.** Only a small change in a file you
   already know goes straight to the coder. Anything else explores first and
   passes the note.
6. **`code-change-pr` takes `notes`.** Paths in the job directory. The
   workflow reads each with `job/read` and adds it to the coder's prompt, so
   the job agent never retypes a note.
7. **`Pod` claims by slug.** Claim for the workspace whose repository is
   changing, and put the note's relevant part in the pod agent's task.

Hive:

8. **Send the home slug.** `launchJobTurn` puts the org strut's workspace
   slug on the input instead of its id.
9. **Pod routes take a slug or an id.** `claim-pod` and `drop-pod` resolve
   the path segment as either, through `resolvePodCaller`, which already
   checks an org key against the workspace's org.
10. **Jamie names workspaces and lets the job explore.** In the strut
    snippet and both system prompts: write `@slug` in the job prompt, start
    the job with the question when it is heading toward a change, and keep
    `repo_agent` for quick answers the user will not build on.

## Deploy order

Hive first (steps 8 to 10). The pod routes then accept a slug before any
job sends one. Stakgraph second. Strut drops input a workflow does not
declare, and `workspace` was already declared, so either order is safe for
the launch itself.

## Not in this

- **A list-peers step for workflows.** Only the builder chat has
  `list_peers`. The job agent knows peers from Jamie's `@slug`.
- **GitHub tokens on peers.** Hive pushes the person's token only to the org
  strut, so a peer's `explore` of a private repository answers from that
  workspace's graph unless the swarm has its own token. Not verified.
