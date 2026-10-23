# The infinite canvas (plan v6)

Standalone: another session can pick this up cold. Repo: `stakwork/hive` (paths under `src/app/org/[githubLogin]/` unless noted). Last updated 2026-10-21. No feature flag: we build directly on the Brainstorm tab.

## 1. Where things stand

| Piece | State |
|---|---|
| Jarvis ontology 134 (provenance properties, UUID keys, score-writing rules) | Merged: stakwork/jarvis-backend#3148. Deploy to swarms: check |
| Hive graph reads: generic `readTree`, `getInitiativeTree`, `listInitiatives`, stage line | stakwork/hive#5577 (open) |
| Hive edit endpoint `POST …/graph/initiative-tree/changes` | stakwork/hive#5578 (open, stacked) |
| First canvas build on the Brainstorm tab | local branch `claude/infinite-canvas-ux` (not pushed) |
| v2 rework (Jamie bar, card asks, road, next step; has a render loop) | local branch `claude/infinite-canvas-v2-wip` |
| **Chosen UX: prototype B** with C's brainstorm | `src/app/prototype/infinite-canvas/b/` (git-excluded); A and C kept for reference |
| Strut side (orchestrator, jobs, graph writes, artifacts) | Tom |

## 2. What we're building: one Hive PR

Fold #5577 and #5578 into it (close them as superseded). Four pieces:

1. **The canvas: prototype B on real data, on the Brainstorm tab.**
   - Land on the initiatives. Click to go in, level by level: org → initiative → milestone → feature. Zooming never changes the level; ←, the breadcrumbs (top-left) and Esc go back out.
   - ⌘K search over initiatives, milestones, features, stories and requirements, grouped, with paths. Saying "pull up <name>" to Jamie does the same.
   - Quiet cards with a clear status pill. Milestones and initiatives roll up progress.
   - Feature level: user stories with their requirements beneath them (proposed in pencil with Accept/Drop, accepted ticked, dropped struck and faded), "+ Add user story" / "+ Add requirement" by hand, architecture and tasks.
   - Brainstorms only at feature level, in C's style: a tree off the feature; options with pros/cons against that feature's requirements and fast/good/cheap; Choose, Expand, More options, undo.
   - Typeset everywhere except a person's own words (handwriting). No legend. No people/assignees in v1.
   - Reads: `listInitiatives`, `getInitiativeTree`, `readTree` (brainstorm trees). Writes: the edit endpoint.
2. **Jamie: one bar in three sizes.** Input only → input plus the last reply (collapsible) → "Full chat" sliding in from the left (reuse the chat component); the canvas narrows, it isn't covered. Mic for voice. "On: …" says what Jamie is pointed at. "Ask Jamie" on any card opens an input there with suggestions.
3. **Jobs on cards, live.**
   - **Where you are goes in as text.** Hive adds the focus to the hidden context line it already prepends to every orchestrator message (`context.line`, today "<time>, <tz>."), e.g. `On the canvas: initiative "Self-serve onboarding" (ref), feature "Repo picker" (ref).` No orchestrator or strut change.
   - **Which card a job is on:** Hive stores the focus on the turn's `StrutRun` input; each `job_turn` row the turn starts points back via `input.parentRunId`, so the job inherits its card.
   - **Markers:** live `job.update` events already reach the browser (`CANVAS_JOB_UPDATE`). The card shows the job's title, state and who started it.
   - **Shared, not per-chat:** also broadcast those updates on the org channel tagged with the card's ref, so everyone viewing the initiative sees them (today they go only to the starting conversation's channel).
   - **New cards appear:** when a job on an initiative updates or settles, re-read that initiative's tree (nothing fires today when strut writes the graph).
4. **Artifacts on cards, as in chat.** A card shows the same thumbnails the chat shows for its jobs' artifacts; tapping one opens the existing artifact panel, which fetches from the swarm as today. Check a teammate may read artifacts of someone else's job (the reader checks access through the run's conversation).

Two sessions build it in parallel in their own worktrees, merged into one branch and PR: **canvas port** (pieces 1–2, `_components`, reads/edits) and **jobs + artifacts plumbing** (pieces 3–4: context line, job→card, org-channel updates, refresh, artifact access).

## 3. Conversations and people

- **Chats stay personal**, as today. A new chat starts fresh; nothing about an initiative lives in a conversation.
- **The canvas is shared, from the graph:** provenance on nodes, jobs on the card they're about whoever started them, artifacts on the card.
- **Coming back** works from the graph (stage, what's next), not chat history.
- **Two people at once:** direct edits are last-write-wins, stamped with who and when; open canvases refresh on change.
- People (assignees, faces) are out of v1. If they come back, the recommendation is edges (`ASSIGNED_TO` / `CREATED_BY` → a `HiveUser` or `HiveAgent` node) in a follow-up Jarvis migration, replacing 134's properties.

## 4. Strut side (Tom)

Strut keeps doing what it does: read the message (with its context line), decide, start jobs, write the graph per the ontology (UUID keys, `created_by_kind: "strut"`, requirements `proposed`, a brainstorm as a `Question ABOUT` the feature with options whose effects point `AGAINST` requirements and are rated on fast/good/cheap), and return artifacts. Optional later: a `ref` and `{step, done, total}` on `job.update` for "3 of 6" progress.

**Canvas Context concept: add this rule up front.**

> When the message context names a canvas focus, first read that node and everything under it from the graph — its stage, requirements nobody has accepted yet, jobs already running there, and brainstorms about it — and start from that. Don't rely on chat history: the graph is the record, and other people may have changed it since.

Other concepts still stale: *Brainstorm Method*, *Hive Roadmap and Canvas*, *Org Canvas*, *Initiatives and Milestones*.

## 5. Decisions

| Decision | Source |
|---|---|
| Graph is the record; reuse HiveInitiative/HiveMilestone; nothing new in Postgres | Tom |
| Prototype B (zoom layers, click to go in) with C's brainstorms; A dropped | Tom |
| Brainstorms only at feature level for v1 | Tom |
| One Hive PR; Strut side is Tom's | Tom |
| Focus goes to strut as text in the context line; no strut change | Tom |
| Chats personal; canvas shared from the graph | Tom |
| No people in v1 | Tom |
| Artifacts as chat thumbnails opening the existing panel | Tom |
| On-screen edits through the Hive edit endpoint | Tom |

## 6. Open questions

1. Is ontology 134 deployed to the swarms? The edit endpoint needs it.
2. Feature status and PRs: derived from that feature's jobs (their PR artifacts, CI) until features have real task links?
3. Does accepting a story mark its feature in progress, or does status come only from tasks and PRs?
4. Mermaid diagrams: add a mermaid artifact kind, or strut returns SVG images?
