# Agent-Proposed Milestones (with Feature Bundles)

Add a third propose tool — `propose_milestone` — to the org canvas chat agent. It mirrors `propose_initiative` and `propose_feature` (no DB write, conversation-as-source-of-truth, click-to-approve), but with one extra trick: a milestone proposal can carry a **list of features to attach to the milestone on approval**, biased toward features that are currently unlinked (no `milestoneId`).

> **Companion docs — read first.**
> - `docs/plans/agent-proposed-initiatives-features.md` — the foundational proposal pattern this extends. Skim "the animating principle" and "the approval handler" before reading further; everything below assumes that vocabulary.
> - `src/app/org/[githubLogin]/CANVAS.md` — the "milestone has no sub-canvas" gotcha (PR #4010); the `synthetic:feature-milestone:<featureId>` edge contract; the human-only-creates invariant the proposal pattern preserves.
> - `docs/plans/org-initiatives.md` and `docs/plans/milestone-progress.md` — projector and milestone-card semantics. Especially: a milestone's "1:N features" model is canonical; multi-feature attach is normal, not novel.
>
> **Out of scope (deliberately):** proposing edges; proposing milestone *removal* of features; reordering milestone `sequence`; auto-assigning to users; reusing this pattern for tasks. Each is reachable later — see "Future seams."

## Goal

Canonical scenario: the user is on an initiative sub-canvas (e.g. `initiative:cmoxyz…` — "Onboarding Revamp") and says *"propose a Q3 milestone covering the dashboard work."* Today the agent has no tool to suggest a milestone — it can only file features under one (`assign_feature_to_initiative`) or create features under existing milestones (`propose_feature` with `milestoneId`).

With this plan the agent calls `propose_milestone` and emits a card in chat that:

1. Names the milestone (e.g. "Q3 Dashboard Push") and optionally describes/dates it.
2. Lists candidate features to attach — biased toward *currently-unlinked* features on the same initiative.

On approval, the server creates the `Milestone` row and PATCHes the listed features' `milestoneId` to point to the new row.

## The animating principle (unchanged)

**The chat is the source of truth.** Same machinery as `agent-proposed-initiatives-features.md`:

- The proposal lives at `message.toolCalls[i].output` as a `ProposalOutput` discriminated by `kind: "milestone"`.
- Approve/Reject append a normal user message carrying `approval` / `rejection`. The user-side message is suppressed visually — the card transition is the feedback.
- `/api/ask/quick`'s pre-LLM block detects approval, runs `handleApproval`, streams a synthetic assistant message with `approvalResult` populated.
- Status is **derived** by scanning the conversation. No DB tables, no schema migration, no rehydration logic.
- Idempotency: re-clicking Approve appends another approval message; the server's idempotency scan finds the prior `approvalResult.createdEntityId` and returns it.

The only thing genuinely new is the multi-feature attach in step 6 of the approval handler.

## What gets added vs. unchanged

| Layer | New | Unchanged |
| --- | --- | --- |
| `src/lib/proposals/types.ts` | `MilestoneProposalPayload`, third arm of `ProposalOutput`, `PROPOSE_MILESTONE_TOOL` constant | `ApprovalIntent` / `ApprovalResult` / `getProposalStatus` (work for any kind) |
| `src/lib/ai/initiativeTools.ts` | `propose_milestone` tool factory entry | `assign_feature_to_initiative`, `propose_initiative`, `propose_feature` |
| `src/lib/proposals/handleApproval.ts` | `approveMilestone` branch + multi-feature reassign loop | `handleApproval` dispatcher, `findProposal`, `findPriorApproval`, idempotency scan, `resolveLandedOnName` |
| `src/lib/constants/prompt.ts` | `getCanvasPromptSuffix()` gets a milestone paragraph | Existing initiative/feature guidance |
| `src/app/org/[githubLogin]/_components/ProposalCard.tsx` | Render arm for `kind === "milestone"` (name + feature checklist) | Card shell, status derivation, approve/reject buttons, inline-edit pattern |
| `prisma/schema.prisma` | nothing | nothing |
| New REST endpoints | nothing — approval rides `/api/ask/quick` | — |

## The proposal shape

Add a third arm to `ProposalOutput` in `src/lib/proposals/types.ts`:

```ts
export interface MilestoneProposalPayload {
  initiativeId: string;            // required — milestones belong to an initiative
  name: string;
  description?: string;
  status?: MilestoneStatus;        // NOT_STARTED | IN_PROGRESS | COMPLETED
  dueDate?: string;                // ISO; the handler parses to Date
  assigneeId?: string;
  /**
   * `sequence` is omitted on purpose — the agent shouldn't pick a
   * sequence number; the approval handler computes
   * `MAX(sequence) + 1` for the initiative inside the same
   * transaction. (Picking it agent-side races with concurrent human
   * `+ Milestone` clicks and would 409 the unique-index.)
   */

  /**
   * Feature ids the agent suggests attaching to the new milestone
   * on approval. **Every featureId here MUST already belong to
   * `initiativeId`** — the propose tool validates this; the
   * approval handler re-validates. Empty array is legal (a milestone
   * with no features attached yet); the user can add later.
   *
   * Bias the suggestion toward features whose `milestoneId IS NULL`
   * (currently unlinked under the initiative). Re-attaching an
   * already-linked feature works but should be rare — say so in the
   * card subtext when it happens, so the user can approve knowingly.
   */
  featureIds: string[];
}

export type ProposalOutput =
  | { kind: "initiative"; proposalId: string; payload: InitiativeProposalPayload; rationale?: string }
  | { kind: "feature";    proposalId: string; payload: FeatureProposalPayload;    rationale?: string }
  | { kind: "milestone";  proposalId: string; payload: MilestoneProposalPayload;  rationale?: string };

export const PROPOSE_MILESTONE_TOOL = "propose_milestone" as const;
```

Update `ProposeToolName` to include the constant. The `ApprovalResult.kind` union widens to `"initiative" | "feature" | "milestone"`. `getProposalStatus` doesn't change — it's already kind-agnostic.

`ApprovalIntent.payload` keeps its `Partial<…>` shape but unions in `Partial<MilestoneProposalPayload>` so the inline-edit overrides work. `featureIds` overrides need a deliberate semantic: the user might check/uncheck rows on the card before approving. Treat the override as **full replacement** (not merge), same as how the title field already replaces (not merges into) the proposal. The card sends the post-toggle list; the handler uses it verbatim.

## The agent tool

Add to `src/lib/ai/initiativeTools.ts`. Same `buildInitiativeTools(orgId, userId)` factory, third entry.

### Validation in `execute` (cheap; same `sourceControlOrgId` pattern)

Order matters — fail fast:

1. **`initiativeId` belongs to this org.** `db.initiative.findFirst({ where: { id, orgId } })`. 404 if missing.
2. **Every `featureIds[i]`:**
   - Belongs to a workspace whose `sourceControlOrgId === orgId`. (Same check `assign_feature_to_initiative` does.)
   - Has `initiativeId === input.initiativeId`. **This is the load-bearing invariant.** A milestone can only own features of its parent initiative; without this check the handler would silently reassign a feature out of one initiative and into another via the milestone PATCH.
   - Is not soft-deleted (`deleted: false`).
   - Single round-trip: `db.feature.findMany({ where: { id: { in: featureIds }, deleted: false }, select: { id, initiativeId, workspace: { sourceControlOrgId } } })`, then assert each id present and each row matches.
3. **Status / dates** — light shape validation; the handler re-runs.

If validation fails, return `{ error }` so the agent retries (same pattern as the other propose tools). Validation errors do NOT land in the conversation as proposals — the tool result is `{ error }`, the streaming reducer surfaces it as a tool-call error indicator, the agent self-corrects on its next turn.

### Discovery (how the agent picks `featureIds`)

The agent already has `read_canvas(ref)` from `canvasTools.ts`. The right pre-call sequence is:

1. **Read the initiative canvas:** `read_canvas(ref: "initiative:<id>")`. The projector returns every feature anchored to this initiative, plus every milestone, plus the synthetic feature→milestone edges. Features without a synthetic edge are the unlinked ones.
2. **Optionally cross-check via `<slug>__list_features`** if the agent needs more than the projection's `LOOSE_FEATURE_LIMIT` (25, see CANVAS.md). The cap is irrelevant for most initiatives but worth knowing.

The prompt should make this explicit (see Prompt update below).

### Tool description (literal — paste into the tool's `description`)

```
Propose a new Milestone under an existing Initiative for this org.
USE THIS whenever the user asks you to add, create, draft, sketch,
suggest, brainstorm, spin up, kick off, set up, plan, or start a
new milestone — e.g. "propose a Q3 dashboard milestone", "draft a
launch milestone", "suggest two milestones for the rest of this
initiative." This tool does NOT write to the DB; it emits a
proposal card in chat that the user explicitly approves with a
click — approval is what creates the row. Do NOT decline
milestone-creation requests by telling the user to use the '+'
button; that advice is only for Workspaces / Repositories.

**BEFORE calling this tool**, you MUST call `read_canvas` with
`ref: "initiative:<id>"` for the initiative you're proposing under,
so you can see (a) the existing milestones (don't duplicate them)
and (b) the features anchored to this initiative — including which
ones already have a milestone (rendered with a synthetic edge to a
milestone card) and which are unlinked.

**`featureIds` should be biased toward currently-unlinked features**
(features on the initiative canvas with no synthetic edge to any
milestone card). Attaching an already-linked feature is legal but
moves it from its current milestone to the new one — only do this
if the user has explicitly asked for the move; otherwise stick to
unlinked features. Empty `featureIds` is fine — the user can attach
features later.

**Do NOT pick a `sequence`** — the system computes it.
```

`inputSchema`: `proposalId`, `initiativeId`, `name`, `description?`, `status?`, `dueDate?`, `assigneeId?`, `featureIds: string[]` (default `[]`), `rationale?`.

## The approval handler

Extend `src/lib/proposals/handleApproval.ts`. The dispatcher (`handleApproval`) gets a third `if` arm; the bulk of the new code is `approveMilestone`.

### Sequence

1. **Find the proposal** via the existing `findProposal` scan (already kind-agnostic).
2. **Idempotency** via `findPriorApproval` (already kind-agnostic).
3. **Merge inline-edit overrides** — `{ ...proposal.payload, ...intent.payload }`. As noted above, `featureIds` is a full replacement, not a merge. After the merge, **re-validate `featureIds`** against the same invariants the propose tool checked (workspace-org ownership, `feature.initiativeId === initiativeId`, not soft-deleted). The user could have added a feature id via inline edit that the agent never saw. Bail with a 400 if any id fails.
4. **Compute next `sequence`** inside the create transaction:
   ```ts
   const result = await db.$transaction(async (tx) => {
     const last = await tx.milestone.findFirst({
       where: { initiativeId },
       orderBy: { sequence: "desc" },
       select: { sequence: true },
     });
     const sequence = (last?.sequence ?? -1) + 1;

     const milestone = await tx.milestone.create({
       data: {
         initiativeId,
         name: merged.name.trim(),
         sequence,
         ...(merged.description !== undefined && { description: merged.description }),
         ...(merged.status !== undefined && { status: merged.status }),
         ...(merged.dueDate !== undefined && { dueDate: merged.dueDate ? new Date(merged.dueDate) : null }),
         ...(merged.assigneeId !== undefined && { assigneeId: merged.assigneeId }),
       },
       select: { id: true, initiativeId: true },
     });

     // Snapshot the prior milestoneId of every feature we're about to
     // reassign — needed for the per-feature CANVAS_UPDATED fan-out
     // below (the helper unions before+after refs).
     const priorMilestones = merged.featureIds.length
       ? await tx.feature.findMany({
           where: { id: { in: merged.featureIds } },
           select: { id: true, milestoneId: true, initiativeId: true, workspaceId: true },
         })
       : [];

     if (merged.featureIds.length) {
       await tx.feature.updateMany({
         where: {
           id: { in: merged.featureIds },
           initiativeId,         // belt-and-suspenders: re-assert invariant inside the tx
           deleted: false,
         },
         data: { milestoneId: milestone.id },
       });
     }

     return { milestone, priorMilestones };
   });
   ```

   `P2002` on the unique `(initiativeId, sequence)` index would mean another milestone was created concurrently between our `findFirst` and `create`. Wrap the transaction in a small retry (max 3 attempts) — same pattern the human `POST /milestones` route would benefit from, but isolated here for the proposal path.

5. **Compute `landedOn`.** Milestones project on the parent initiative canvas (no `milestone:<id>` scope exists — see CANVAS.md and PR #4010). So `landedOn = "initiative:" + milestone.initiativeId` unconditionally. **Position-overlay write only if the user is currently on that initiative canvas:**
   - `intent.currentRef === landedOn && intent.viewport` → call `setLivePosition(orgId, landedOn, "milestone:" + milestone.id, intent.viewport)`. Same side-channel `Canvas.data.positions[liveId]` write features use.
   - Otherwise → no overlay; the timeline projector's `sequence`-based auto-layout handles placement.

   There's no `featureProjectsOn`-style helper for milestones because the rule is trivial (milestones only ever project on their parent initiative). Don't generalize prematurely; one branch is fine.

6. **Fan out `CANVAS_UPDATED`** on every affected canvas:
   - The new milestone's parent initiative canvas (`initiative:<id>`) — the timeline projector re-runs and emits the new milestone card.
   - The org root (`""`) — the initiative card's milestone-completion footer denominator changed.
   - For **each reassigned feature**, call `notifyFeatureReassignmentRefresh(featureId, prior)` where `prior` is the snapshot from step 4 (so refs touched include both the old milestone and the new one, both initiatives if any feature crossed initiatives — which the invariant prevents but the helper handles correctly anyway, and the workspace).

   Reuse `notifyCanvasesUpdatedByLogin` for the milestone-create fan-out, mirroring `POST /milestones`.

7. **Resolve `landedOnName`** via the existing `resolveLandedOnName(orgId, landedOn)`. The `initiative:` branch already exists; no changes needed.

8. **Return** `{ proposalId, kind: "milestone", createdEntityId: milestone.id, landedOn, landedOnName? }`. The route writes this onto the synthetic assistant message's `approvalResult`; the card's status scan flips to "approved."

The synthetic assistant `content` reads naturally:
- 0 features attached: `"Created milestone **Q3 Dashboard Push** under **Onboarding Revamp**."`
- N features attached: `"Created milestone **Q3 Dashboard Push** under **Onboarding Revamp** and attached 3 features."`

### Failure modes worth being explicit about

- **Initiative deleted between propose and approve.** 404 from re-validation. Card shows the route's error string; user dismisses.
- **A feature in `featureIds` was reassigned to a different initiative between propose and approve.** Re-validation catches it (`feature.initiativeId !== initiativeId`). The whole approval bails — partial attach is worse than nothing. Error string lists the offending feature ids so the agent (or the user via inline edit) can drop them and re-approve.
- **A feature in `featureIds` was deleted.** Same as above — the `findMany` in step 4 returns fewer rows than `featureIds.length`; bail.
- **Race on `sequence`.** Caught by `P2002`; transaction retries.
- **`featureIds` includes a feature already attached to a different milestone of the same initiative.** Allowed but noted: the card's "attaching N features" subtext should distinguish "N new attaches, M reassignments" so the user knows they're moving features. Validation does NOT block this case — sometimes the move is intended.

## Card UX

Extend `<ProposalCard>` in `src/app/org/[githubLogin]/_components/ProposalCard.tsx`. Most of the shell is reused; the milestone arm adds a small feature checklist body.

### Layout (pending state)

```
┌─ 💡 PROPOSED MILESTONE ─────────────────────── [✓] [✗] ┐
│  Q3 Dashboard Push                                       │
│  Under Onboarding Revamp · Due Sep 30                    │
│                                                          │
│  Reduce time-to-first-meaningful-render on the dash      │
│                                                          │
│  Features to attach (3):                                 │
│    ☑ Cohort filter                          (unlinked)  │
│    ☑ Saved view bar                         (unlinked)  │
│    ☑ Realtime tile refresh                  (unlinked)  │
│    ☐ Legacy chart compat                    (in M2 ↗)   │
└──────────────────────────────────────────────────────────┘
```

- **Title** is inline-editable (same pattern as v1 cards).
- **"Under <initiative name>"** subtext is read-only — the proposal binds to a specific initiative; changing it would mean a different proposal. The agent can re-propose.
- **Feature rows** are checkable. Each row shows the feature title plus a tag:
  - `(unlinked)` — currently no `milestoneId`. **Default checked.**
  - `(in <other milestone name> ↗)` — currently linked to a different milestone. **Default unchecked.** Checking it means "move this feature out of M_other and into the new milestone." The card surfaces this as a small warning — "Will move from X."
- **Footer hint** (only when any "move" rows are checked): `"Will reassign 1 feature from another milestone."`
- **No "edit description / dueDate / status" UI in v1.** Same minimalism as the existing cards — title + the load-bearing list, nothing more.

### Data flow on Approve

The card builds `intent.payload` from:

- `name` if the user edited the title.
- `featureIds` = the list of currently-checked rows (full replacement, not delta).

Passes `currentRef` and `viewport` (defaulting to `{ x: 40, y: 40 }`, same as v1) for the position-overlay branch. Sends via `useSendCanvasChatMessage` with the `approval` field set — no new endpoint, no new fetch path.

### Resolving feature titles for the checklist

The proposal carries `featureIds`, not titles — the tool output is the bare ids the agent picked. Two options:

1. **Resolve client-side via the existing `<slug>__list_features` cache.** The canvas chat already has workspace context; if the chat store cached features for any reason, use it. Today it doesn't.
2. **Resolve server-side at proposal time and tuck names into the tool output.** Cleaner: the propose tool's `execute` does `db.feature.findMany({ where: { id: { in: featureIds }, ... }, select: { id, title, milestoneId, milestone: { select: { name } } } })` — same query as validation — and returns it as a sibling field on the proposal output:

```ts
type MilestoneProposalOutput = {
  kind: "milestone";
  proposalId: string;
  payload: MilestoneProposalPayload;
  rationale?: string;
  /** Resolved metadata for the feature checklist UI. Source of truth
   *  for *display only*; the approval handler re-fetches before
   *  writing. */
  featureMeta: Array<{
    id: string;
    title: string;
    currentMilestoneId: string | null;
    currentMilestoneName: string | null;
  }>;
};
```

**Pick option 2.** It avoids a fetch on card render, makes the chat transcript self-describing (reload a conversation a week later and the card still renders meaningfully even if a feature has since been renamed — the proposal shows what was suggested at proposal time), and the data is already in hand from validation. Carry `featureMeta` only on the milestone arm; the other proposal arms don't need it.

The handler **does NOT trust `featureMeta`** — it always re-validates against the DB at approval time. `featureMeta` is purely a render hint.

### States

Same machinery as v1 (`pending` / `pending-in-flight` / `approved` / `rejected`):

- **approved** subtext: `"Created on this canvas ✓"` if `landedOn === currentRef`, else `"Created on <initiative name> ↗"` linking via `?canvas=<landedOn>`. The existing `approvedSubtext` block already handles this once `resolveLandedOnName` returns the initiative name.
- **rejected**: faded, "Rejected" subtext.

## Prompt update

In `src/lib/constants/prompt.ts`, extend `getCanvasPromptSuffix()`:

1. **The "you CAN propose" sentence** (currently `**For Initiatives and Features, you CAN propose new ones via propose_initiative and propose_feature**`) → update to `**For Initiatives, Features, and Milestones, you CAN propose new ones via propose_initiative, propose_feature, and propose_milestone**`. Strike "Milestones" from the "no propose tool" list ("**For Workspaces and Repositories**, you have no propose tool").

2. **Add a milestone paragraph** to the tools section, right after the existing `propose_initiative / propose_feature` paragraph:

   > `propose_milestone` — Use this whenever the user asks you to add, create, draft, sketch, suggest, brainstorm, spin up, kick off, set up, plan, propose, or start a new milestone. Examples: *"propose a Q3 milestone for the dashboard work"*, *"draft a launch milestone for billing v2"*, *"suggest two milestones for the rest of this initiative."* This tool does NOT write to the DB — it emits a proposal card the user approves with a click. Approval is what creates the milestone (and attaches the listed features). Each call needs an `initiativeId` (the parent initiative this milestone lives under) and may include a `featureIds: string[]` list of features to attach on approval. **Before calling, ALWAYS call `read_canvas(ref: "initiative:<id>")` first** to see the existing milestones (don't duplicate) and to find candidate features. **Bias `featureIds` toward currently-unlinked features** — features on the initiative canvas with no synthetic edge to any milestone card. Attaching already-linked features is legal but moves them from their current milestone; only do that if the user explicitly asked. Do NOT pick a `sequence` number — the system assigns one. **When NOT to use:** if the user wants to file *existing* features under an *existing* milestone, use `assign_feature_to_initiative` instead.

3. **Tweak `propose_feature`'s "milestones are mostly for completed work" line** to acknowledge that there's now a way to *create* a milestone with new features via `propose_milestone`. Keep the default ("file new features under `initiativeId`, omit `milestoneId`") but soften the "milestones are primarily for grouping completed work" framing — it was true when there was no propose tool; now milestones are also a valid way to bundle a few new features into a logical/temporal unit. The decision rule remains: if the user wants a *grouping*, propose a milestone; if the user wants individual features filed under an initiative, propose features with `initiativeId`.

## Streaming flow (end-to-end)

1. User on `initiative:<id>`: *"propose a Q3 milestone for the dashboard work."*
2. Agent calls `read_canvas(ref: "initiative:<id>")`. Sees the existing milestones and feature anchors (with `synthetic:feature-milestone:` edges marking already-linked features).
3. Agent calls `propose_milestone({ proposalId, initiativeId, name: "Q3 Dashboard Push", featureIds: [unlinkedA, unlinkedB, unlinkedC], rationale })`. The tool validates, fetches `featureMeta`, returns the structured proposal.
4. Streaming reducer lifts the tool output into `message.toolCalls[i].output`. `<ProposalCard>` renders inline as the chunk arrives.
5. `useCanvasChatAutoSave` persists the message to `SharedConversation.messages`.
6. User unchecks one row, edits the title, clicks ✓. Card sends a user message via `useSendCanvasChatMessage` with `approval = { proposalId, payload: { name: editedName, featureIds: [unlinkedA, unlinkedB] }, currentRef, viewport }`.
7. POST `/api/ask/quick` → pre-LLM block sees `approval` → `handleApproval` → `approveMilestone` → transactional create + multi-feature reassign + Pusher fan-out.
8. Synthetic assistant message streams back with `approvalResult: { kind: "milestone", createdEntityId, landedOn: "initiative:<id>", landedOnName: "Onboarding Revamp" }`.
9. Card status scan finds `approvalResult` → flips to approved with "Created on this canvas ✓".
10. Pusher delivers `CANVAS_UPDATED` to every open canvas; the projector re-emits the new milestone card and the synthetic feature→milestone edges to the two newly-attached features.

The whole thing is fire-and-forget on the canvas side — the chat doesn't know the canvas refreshed, the canvas doesn't know the chat triggered the change. The store + Pusher are the boundary.

## Forks (unchanged behavior, worth re-stating)

A forked conversation inherits the milestone proposal's tool output and `featureMeta`. The fork can independently approve. Re-attaching already-attached features is idempotent at the SQL level (`updateMany` to the same `milestoneId`); the fan-out is wasted work but not incorrect. If the original conversation already approved the milestone, the fork's idempotency scan finds the prior `approvalResult` and short-circuits — no second milestone created. (Unless: the fork's user edited the title or feature list before clicking, in which case the proposalId is the same but the intent payload differs. The idempotency scan keys on `proposalId` only — the second click is treated as a duplicate, and the inline edits are silently dropped. This is the same trade-off the v1 plan accepts; multi-conversation editing is a future concern.)

## Future seams (intentionally not built)

These remain deferred — the design above keeps each path clean:

1. **`propose_feature_remove_from_milestone`.** Symmetric to attach — a milestone proposal could carry `featureIdsToDetach` for moving features *out*. Add a second array to the payload, mirror the reassign loop in the handler. UI: a "currently in this milestone" section with un-check-to-detach. Skipping in v1 because the canonical scenario is *creating* a milestone, not refactoring one.
2. **Reorder milestones.** A proposal could carry a target `sequence` and the handler could shuffle the others. The agent would need a `propose_milestone_reorder` tool (or the existing one widens with an optional `insertAfterMilestoneId`). Not needed in v1.
3. **Multiple milestones in one proposal.** The agent could `propose_milestone` thrice in a turn; the existing per-card UI handles this naturally. No code change needed — just prompt and exemplars.
4. **Drag features from chat onto milestone card.** Symmetric to the future feature-drag seam — the proposal card becomes a drag source, the milestone card becomes a drop target. Server logic doesn't change (the drag becomes an `assign_feature_to_initiative`-equivalent PATCH).
5. **Auto-detach orphans.** If the agent proposes attaching a feature already in milestone M_other, today the user gets a small warning. A future "smart cleanup" could surface a follow-up suggestion to delete M_other when its last feature is moved out. Cross-proposal coordination — defer.

## Implementation order (one PR)

Each step is independently sensible; together they're a single coherent PR. Numbered to mirror the v1 plan's order so reviewers can read them in parallel.

1. **Type extensions in `src/lib/proposals/types.ts`:**
   - Add `MilestoneProposalPayload` interface.
   - Add the `kind: "milestone"` arm to `ProposalOutput`.
   - Add `PROPOSE_MILESTONE_TOOL` constant; widen `ProposeToolName`.
   - Widen `ApprovalResult.kind` union.
   - No changes to `getProposalStatus` — it's already kind-agnostic. (Add a unit test asserting that fact.)
2. **Agent tool in `src/lib/ai/initiativeTools.ts`:**
   - Third entry in the `buildInitiativeTools` factory, keyed `[PROPOSE_MILESTONE_TOOL]`.
   - Validation: initiative-org ownership + per-feature workspace-org ownership + per-feature `initiativeId` invariant + soft-delete check.
   - Return `MilestoneProposalOutput` with `featureMeta` populated from the validation query.
3. **`approveMilestone` in `src/lib/proposals/handleApproval.ts`:**
   - Third arm of the `handleApproval` dispatcher.
   - Re-validation, transactional create + `featureIds` reassign, sequence retry on `P2002`.
   - Pusher fan-out: initiative ref + root + per-feature `notifyFeatureReassignmentRefresh` with prior-milestone snapshots.
4. **`<ProposalCard>` arm for milestones:**
   - Branch on `proposal.kind === "milestone"`.
   - Render the feature checklist using `featureMeta` (no fetch).
   - Build the `intent.payload` with `featureIds = [currently-checked rows]`.
5. **Prompt update in `getCanvasPromptSuffix()`:**
   - Move "Milestones" out of the "you have no propose tool" list.
   - Add the `propose_milestone` paragraph.
   - Soften the "milestones are for completed work" line on `propose_feature`.
6. **CANVAS.md gotcha bullet:** one line under the existing proposal bullet pointing at this doc and noting the multi-feature-attach side effect (so future readers don't re-derive it from the handler).
7. **Smoke tests:**
   - Propose a milestone with 0 features → row created, no fan-out for features.
   - Propose with 3 unlinked → row created, all 3 attached, synthetic edges appear after Pusher round-trip.
   - Propose with 1 already in M_other → row created, feature moved, both M_old and M_new canvases (well, the same initiative canvas they share) refresh and the synthetic edge re-points.
   - Propose, then race `+ Milestone` from a second tab during approval → one of the two retries on `P2002` and lands at `sequence + 1`.
   - Reject → no DB write, card fades.
   - Approve twice (re-click) → idempotency returns the same `createdEntityId`; no duplicate milestone, no double-attach.

Notably absent: no schema migration, no new REST routes, no new store slices, no new stream-reducer extensions. This plan is a strict additive extension of the v1 proposal infrastructure — the third propose tool the proposal pattern was designed to host.

## What we are deliberately not building

- A `Proposal` Prisma table (still no schema change).
- A "preview the synthetic edges before approval" canvas overlay. Future work; not blocking.
- Auto-suggesting milestone names from feature titles (e.g. clustering). The agent can do that; we don't need a deterministic helper.
- A way to express "propose multiple milestones with features partitioned across them" as a single atomic action. Multiple `propose_milestone` calls in one agent turn already handle this, with per-card approval. Bulk approve-all is a v1 card affordance that already covers the multi-card case.
- Milestone status transitions (NOT_STARTED → IN_PROGRESS → COMPLETED) as proposals. Handled by the existing milestone-status toolbar on the canvas card (CANVAS.md "side-channel DB writes" gotcha). No reason to surface that as chat.
- Cross-initiative milestones. Schema doesn't allow it; the propose tool's invariant locks the milestone to one initiative. If product wants this later, it's a schema change and a different plan.

Each is a real feature. None is needed for *agent suggests milestone with features → user approves → milestone appears with edges drawn*. Build the loop, watch usage, decide what's next from data.
