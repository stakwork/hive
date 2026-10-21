# The infinite canvas (plan v5)

Standalone: another session can pick this up cold. Repos: `stakwork/hive` (paths under `src/app/org/[githubLogin]/` unless noted), `stakwork/jarvis-backend`, strut. Last updated 2026-10-21. No feature flag: we build directly on the Brainstorm tab.

## 1. What we're building

The **infinite canvas** collapses three features into one, branching from the React Flow "Desk" on the Brainstorm tab (`_components/brainstorm-board/*`, `CanvasTab "brainstorm"` in `_components/useOrgView.ts`, mounted in `OrgCanvasView.tsx`). The Map tab (Evan's `system-canvas`), workspace Whiteboards and the old Initiatives view are left alone and retired later. End state: `/org/<org>` lands on the canvas; Chats becomes a panel in it.

**Journey 1 (start):** land on the latest 5 initiatives → "create an initiative: why…" → milestones → features → stories → requirements (`proposed`, a person accepts) → "brainstorm X" → options, effects, Fast/Good/Cheap scores. Cards appear as they are written.
**Journey 2 (continue):** next day each initiative card shows a one-line stage from the graph ("12 requirements, 3 unaccepted"); clicking one reopens its Jamie session, and Jamie starts from the graph state.

## 2. Data: the graph is the record

- Initiatives, milestones, briefs, features, stories and requirements live in the graph. The canvas never reads or writes Hive's Postgres for them.
- We **reuse the existing `HiveInitiative` and `HiveMilestone` nodes**. No import.
- The Postgres → graph copy job (`src/services/canvas-mirror-cron.ts`) **stays on**. Nobody creates initiatives in the old screens any more, so it has nothing new to copy. It only rewrites a node when its Postgres row changes. It goes when the old Initiatives feature is removed.
- Which graph: the org's home workspace graph (`SourceControlOrg.defaultWorkspaceId` → swarm), where the copy job already writes initiatives.
- Chain (Jarvis migration 133): `HiveInitiative -HAS_MILESTONE-> HiveMilestone`; `HiveInitiative -HAS_BRIEF-> Brief`; `HiveInitiative|HiveMilestone -HAS_FEATURE-> InitiativeFeature -HAS_STORY-> UserStory -HAS_REQUIREMENT-> Requirement`; `Question -ABOUT-> InitiativeFeature`. HiveMilestone is the phase.
- Keys: Jarvis dedupes on `node_key` built from a key property (`initiative_id`, `milestone_id`, `brief_id`, `feature_id`, `story_id`, `requirement_id`) and refuses a node without it. **Whoever creates a node supplies a UUID** for that property.

## 3. Who writes

- **Jamie / Strut** (chat, voice later) write through Strut's generic graph steps (`create-node`, `edit-node`, `create-triplet`, `create-batch-triplet`, …). Gated steps become Strut proposals the person accepts in chat.
- **On-screen edits** (rename an initiative, edit the brief's why, add a milestone/feature/story/requirement) go through a **Hive endpoint** that checks permission and writes the graph directly, like the Desk's brainstorm save (`src/services/graph/brainstorm-write.ts`).
- Both paths validate against the same Jarvis ontology and stamp the same provenance properties, so a person's edit and a Strut edit read the same.
- Hive's Jamie `propose_*` tools (`src/lib/ai/graphWriteTools.ts`) are not part of this path.

## 4. Work, in order

### Jarvis (this session)
Migration 134 in `jarvis-backend` (133 is deployed, never edited in place):
1. Provenance on HiveInitiative, HiveMilestone, Brief, InitiativeFeature, UserStory, Requirement: `created_at`, `updated_at`, `created_by`, `created_by_kind` (`human|strut|jamie`), `assignee_id`, `assignee_kind`. All optional.
2. Describe HiveInitiative/HiveMilestone as graph-native (drop "mirrored from Postgres").
3. Document key generation: the creator supplies the key property as a UUID.
4. Define `Option` and `Effect` in the repo so `HAS_EFFECT`, `AGAINST`, `RATED_ON`, `PRODUCES` are seeded everywhere and testable.
5. `RATED_ON`: re-rating updates in place, never two edges for one option and corner; optional `by` (user id, `jamie` or `strut`).
6. Check `PRIORITISES.weight` against the native edge `weight`; rename if it collides.
7. **`status` stays** (no rename to `state`): Strut steps and the Hive endpoint both allow it, and HiveInitiative/HiveMilestone already use it.

### Hive (this session)
| # | Piece | Needs |
|---|---|---|
| a | Landing + sessions panel + latest 5 initiative cards (job ea4f03df, in flight elsewhere; verify once merged) | – |
| b | Graph read `getInitiativeTree(ref_id)` (milestones, features, stories, requirements, computed stage) next to `src/services/graph/workbench.ts` | – |
| c | Drill in: click an initiative to open its milestone and feature cards; click again to collapse | a, b |
| d | Edit endpoint: permission check, write the graph, stamp provenance, generate the key UUID | Jarvis 134 |
| e | Inline edits on cards (initiative name, brief why) and adding milestones/features/stories/requirements by hand | c, d |
| f | Canvas context message to Jamie (surface, initiative, milestone/feature, selected card, stage; *Canvas Context* concept), extending `composeFor` in `brainstorm-board/actions.ts` and `_state/canvasChatStore.ts` | c |
| g | "Build out" and "Brainstorm" buttons that launch the Strut workflows | Strut workflows |

### Strut + Concepts (another session, after Hive)
- Workflows `initiative-build` (read plan doc + existing nodes → draft Brief/features/stories/requirements → check each story has ≥1 requirement, no empties, unique names → write, requirements `proposed` → notify canvas) and `brainstorm` updated to write `Effect.score`, `AGAINST` requirement, `RATED_ON`. `initiative-create` shrinks to a prompt.
- Strut fix: stamp `updated_at` itself instead of rejecting it as reserved (`node-writer.ts`).
- Check first: Strut's graph is the same database as the org's home workspace graph, or its writes won't show on the canvas.
- Update stale Concepts: *Brainstorm Method*, *Hive Roadmap and Canvas*, *Org Canvas*, *Initiatives and Milestones*.

## 5. Decisions

| Decision | Source |
|---|---|
| Name is "infinite canvas"; build on the Brainstorm tab, no flag; old tabs untouched | Tom |
| Graph is the record; reuse HiveInitiative/HiveMilestone; nothing new in Postgres | Tom |
| Postgres copy job stays on until the old feature is removed | Tom |
| On-screen edits go through a Hive endpoint, not Strut | Tom |
| Jamie/Strut write through Strut's graph steps | Tom |
| Keep `status`; no rename | proposed, not objected |
| Creator supplies node keys as UUIDs | proposed, not objected |
| Stay on React Flow; Evan's embedding spike optional before drill-in | open |

## 6. Open questions
1. Approval: one Strut proposal for a whole `initiative-build` write step, or direct write with requirements `proposed`? Default: direct write, `proposed`.
2. Does a single Strut step handle a 40+ edge tree? (Strut session.)
3. Still gate drill-in on the Evan spike? Default: no, React Flow.
