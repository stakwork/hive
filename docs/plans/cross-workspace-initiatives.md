# Cross-Workspace Initiatives

Let the canvas agent compose Initiatives whose Features span multiple workspaces, keep the resulting Feature plans consistent as they evolve, and order them with a simple "depends on" relation so the agent can eventually build them in the right order. Clarifying questions ride the existing per-feature FORM artifact + `AttentionList` surface — the user jumps from feature to feature in new tabs to answer them, same as today.

This is a small extension on top of the existing proposal system. The infrastructure already supports cross-workspace features — what's missing is the agent prompt teaching it the pattern, one column on `Feature`, and one new tool.

> **Companion docs — read first.**
> - `src/app/org/[githubLogin]/CANVAS.md` — proposal lifecycle, `parentProposalId` cross-proposal links, `propose_feature(workspaceSlug, …)`, the synthetic-edge projector pattern, the `AttentionList` synthetic intro card, the "side-channel DB writes from canvas interactions" gotcha.
> - `docs/plans/agent-proposed-initiatives-features.md` — the foundational proposal pattern this builds on. Everything below assumes that vocabulary (`ProposalOutput`, `ApprovalIntent`, `handleApproval`, conversation-as-source-of-truth).
> - `docs/plans/propose-milestone.md` — the most recent extension of the propose pattern; the closest structural analog for the additions here.
> - `prisma/schema.prisma:475` (`Task.dependsOnTaskIds`) and `src/services/task-coordinator-cron.ts:39` (`checkDependencies`) — the existing simple dependency model this mirrors. Read both before adding any complexity to the design below.
>
> **Out of scope (deliberately):** an autonomous scheduler that kicks off the next dependency layer when blockers complete; per-feature plan-chat watchers that escalate FORM artifacts into canvas chat; a canvas-agent-emitted "question" primitive (the agent asks via plain text and the user answers per-feature via the existing AttentionList → new-tab flow); dependency *kinds* (`BLOCKS` vs `INFORMS` vs `SHARES_INTERFACE`); a thresholds enum (plan-approved vs merged vs deployed); shared "agent working memory" durable beyond the chat transcript. Each is reachable from this design without rewrites — see "Future seams."

## Goal

Three canonical scenarios this plan unlocks:

1. **Cross-workspace authoring.** *"Spin up an auth refactor across infra, backend, and web — propose one feature per workspace."* Today the agent has every tool needed but isn't taught this is a first-class pattern; it tends to file everything under a single workspace.
2. **Consistency editing.** *"The backend just renamed `user_id` to `userId` — fix the other two feature plans."* Today the agent can rename a feature's *title* (canvas card text edit → PATCH) but can't edit `brief` / `requirements` / `architecture` — the durable plan text on each feature.
3. **Dependency-ordered execution (data only in v1).** *"The frontend feature can't start until the backend API merges."* Today the canvas can have authored edges between feature cards, but they have no semantics — the projector can't show "A blocks B" as a first-class relation, and there's no way for the agent or a future scheduler to walk the order.

## The animating principle

**Don't invent new infrastructure for what the existing pieces already do.**

- `propose_feature` already takes `workspaceSlug` and `parentProposalId`. N features across N workspaces under one not-yet-approved Initiative is **already supported** by the approval handler. The first half of this plan is a prompt change.
- Task dependencies (`Task.dependsOnTaskIds: String[]`) are a Postgres string array on the Task row itself. No join table, no enum, no threshold field. A coordinator cron walks them with a three-state check (`SATISFIED` / `PENDING` / `PERMANENTLY_BLOCKED`). We mirror this verbatim on `Feature` — same column shape, same semantics.
- Clarifying questions already have a UX: per-feature planners emit FORM artifacts on each feature's chat; the synthetic `AttentionList` card at the top of the canvas chat fans signal queries across the user's accessible workspaces and surfaces "features awaiting your feedback" + "tasks with FORM artifact" as one-click rows that `window.open` the feature/task page in a new tab. The cross-workspace authoring agent inherits this surface for free — the user jumps to each feature, answers the FORM in place, comes back. **No new question primitive is needed in v1.**

## What gets added vs. unchanged

| Layer | New | Unchanged |
| --- | --- | --- |
| `prisma/schema.prisma` | One column on `Feature`: `dependsOnFeatureIds String[] @default([]) @map("depends_on_feature_ids")` | Everything else. No new model, no new enum, no relation. |
| `src/lib/proposals/types.ts` | `dependsOnFeatureIds?: string[]` and `dependsOnProposalIds?: string[]` on `FeatureProposalPayload` | All other proposal types; `ApprovalIntent` / `ApprovalResult` / `getProposalStatus` |
| `src/lib/ai/initiativeTools.ts` | One new tool: `update_feature_plan`. Extend `propose_feature` input schema with the two new optional dependency fields. | `propose_initiative`, `propose_milestone`, `assign_feature_to_*`, `read_*` |
| `src/lib/proposals/handleApproval.ts` | `approveFeature` resolves `dependsOnProposalIds` (sibling-proposal ids) → feature ids, merges with `dependsOnFeatureIds`, writes the array on create. | The rest of the dispatcher; idempotency scan; landed-on resolution |
| `src/lib/constants/prompt.ts` | New paragraphs in `getCanvasPromptSuffix()` teaching cross-workspace initiatives, the dependency vocabulary, the `update_feature_plan` tool, and the clarification loop (read open FORM artifacts via per-workspace `<slug>__read_feature`; auto-answer or summarize and let the user click through AttentionList). | Existing initiative/feature/milestone guidance |
| `src/lib/canvas/projectors.ts` | On the initiative sub-canvas, emit a synthetic edge `synthetic:feature-blocks:<blockerId>:<blockedId>` for every `dependsOnFeatureIds` entry where both ends are on this canvas. | All other projector logic; geometry; theme; the existing `AttentionList` signal queries and renderer. |
| New REST endpoints | None. `update_feature_plan` is a tool that reuses `updateFeature`/`updateFeatureContent` services. | — |

## Phase 1 — prompt: cross-workspace initiatives as a first-class pattern

The single highest-leverage change in this whole plan. Zero code, just `getCanvasPromptSuffix()`.

Today the prompt teaches the agent that features can name any workspace, but the worked examples all live in a single workspace. The result: when a user says "spin up auth across the stack," the agent files all three features under whichever workspace the user is sitting in.

Add a paragraph to the **Your role: propose, organize, annotate** section, immediately after the bullet that introduces `propose_feature`:

> **Cross-workspace initiatives are first-class.** When the user describes work that spans systems ("auth across infra, backend, and frontend," "a new entity model end-to-end," "ship X to web and mobile"), propose one Initiative and *N* sibling features — one per workspace involved. Each feature's `workspaceSlug` names its workspace; every feature carries `parentProposalId` pointing at the same initiative proposal. The approval handler wires them all to the new Initiative at create time. This is the default for system-spanning work — don't collapse multi-workspace work into one workspace's feature with vague "we'll coordinate later" language in the brief.
>
> When proposing the features, draw `dependsOnProposalIds` between them where the order matters (see the **Feature dependencies** section below). Typical layering: schema/migrations → backend endpoints → frontend integration. Each blocker proposal id goes on the blocked feature's `dependsOnProposalIds` array.

And a concrete example in the **Workflow** section:

> *User: "Add user authentication to the platform — infra, backend, and web."*
>
> 1. `read_canvas` (root) to see workspace slugs and any existing related initiatives.
> 2. `propose_initiative({ proposalId: "init-auth", name: "User Authentication" })`.
> 3. `propose_feature({ proposalId: "f-infra", workspaceSlug: "infra", parentProposalId: "init-auth", title: "Auth schema + migrations", … })`.
> 4. `propose_feature({ proposalId: "f-backend", workspaceSlug: "backend", parentProposalId: "init-auth", dependsOnProposalIds: ["f-infra"], title: "Auth API endpoints", … })`.
> 5. `propose_feature({ proposalId: "f-web", workspaceSlug: "web", parentProposalId: "init-auth", dependsOnProposalIds: ["f-backend"], title: "Login + session UI", … })`.
>
> Approval of the initiative followed by approval of each feature creates four rows: one `Initiative` and three `Feature`s in three different workspaces, with `dependsOnFeatureIds` pointing the right direction.

Validate empirically: write a handful of representative prompts in `src/__tests__/unit/ai/`, run the canvas agent against them, eyeball the tool-call sequence. The fix here is iterating the prompt until the agent reliably picks the multi-workspace pattern when it's appropriate.

## Phase 2 — schema: `Feature.dependsOnFeatureIds`

One column. Mirror `Task.dependsOnTaskIds` exactly.

```prisma
model Feature {
  // …existing fields…
  dependsOnFeatureIds String[] @default([]) @map("depends_on_feature_ids")

  @@index([workspaceId])
  // (no new index needed; we never query "all features that depend on X" in any hot path —
  //  when we do (e.g. delete cleanup), a sequential scan with `has:` filter is fine for the
  //  cardinality we expect per initiative)
}
```

Why a string array on the row, not a join table:

- That's what `Task.dependsOnTaskIds` is. The pattern works; copy it.
- Cross-workspace dependencies have no foreign-key advantage to gain — both endpoints are `Feature` rows. No relation table needs to carry a `kind` or `threshold` because we don't model those (Tasks don't either).
- Deletion cleanup is identical to Tasks: when a feature is deleted, scan for `{ dependsOnFeatureIds: { has: id } }`, remove the id from each. See `src/services/roadmap/tickets.ts:745-762` for the pattern; copy into `src/services/roadmap/features.ts` (or wherever the feature delete path lives — confirm during implementation).
- Cycle detection on update: walk the graph BFS, reject if the new edge would create a cycle. Tasks already do this — `src/services/roadmap/tickets.ts:564-580` shows the pattern. Copy.

What this column intentionally does **not** model:

- A dependency *kind* (`BLOCKS` vs `INFORMS` vs `SHARES_INTERFACE`). Tasks don't have one; Features don't need one. A dependency means "the blocker is done before the blocked starts." Done.
- A *threshold* (plan-approved vs PR-merged vs deployed). Tasks use PR-merged or `status: DONE`; we'll do the analogous thing on Feature (`status: COMPLETED` — see `FeatureStatus` enum) when the time comes for a scheduler. For v1, this column is data-only; no scheduler walks it.

Migration:

```sql
ALTER TABLE features ADD COLUMN depends_on_feature_ids TEXT[] DEFAULT '{}'::TEXT[];
```

Prisma generates the migration; no manual SQL needed beyond reviewing it.

## Phase 3 — `propose_feature` learns about dependencies

### First, how proposal ids work (foundational — read before the rest of this section)

Every proposal already carries an agent-generated `proposalId`. Look at the existing `propose_feature` tool input (`src/lib/ai/initiativeTools.ts:670`):

```ts
inputSchema: z.object({
  proposalId: z.string().min(1),    // ← the agent invents this per call
  title: z.string().min(1),
  // …
})
```

The agent picks something short like `"f-infra"` or `"abc123"`. It lands in the chat transcript as `message.toolCalls[i].output.proposalId` and lives there for the life of the conversation. **It is not a DB id.** No row exists yet.

The existing `parentProposalId` field on `propose_feature` (`initiativeTools.ts:723-730`) already exploits this: the agent emits `propose_initiative({ proposalId: "init-auth", … })`, then `propose_feature({ parentProposalId: "init-auth", … })`. At approval time, `approveFeature` scans the chat transcript for the `approvalResult` matching `"init-auth"`, pulls its `createdEntityId` (the cuid of the freshly-created Initiative row), and uses that as the new feature's `initiativeId`. See `handleApproval.ts:389-405` for the mechanism.

**The transcript is a lookup table from proposal-id → created-entity-id.** Status-derivation (`getProposalStatus` in `types.ts:350`) already walks it; the dependency resolver walks the same way.

### Two fields, one for each source of the blocker

Extend `FeatureProposalPayload` in `src/lib/proposals/types.ts` with **two** optional arrays, distinguished by what the agent points at:

```ts
export interface FeatureProposalPayload {
  // …existing fields…

  /**
   * Cuids of features that ALREADY EXIST in the DB. The agent
   * discovered them via `read_canvas` (live ids like `feature:cmpqr…`,
   * pass just the cuid part) or `<slug>__list_features`. Validated at
   * propose time: every id must exist and belong to this org. Copied
   * verbatim into `Feature.dependsOnFeatureIds` at approval time.
   */
  dependsOnFeatureIds?: string[];

  /**
   * `proposalId`s of OTHER PROPOSALS in this same chat conversation
   * (typically sibling `propose_feature` calls under the same
   * initiative). NOT cuids — these ids only exist in the transcript.
   * At approval time the handler scans the conversation for each id's
   * `approvalResult.createdEntityId` (the cuid created by approving
   * that proposal), and unions the results with `dependsOnFeatureIds`
   * before writing the final cuid array.
   *
   * If a referenced proposal hasn't been approved yet, approval of
   * THIS proposal fails with a clear message: "Approve the blocker
   * first." Same UX as the existing `parentProposalId` ordering error.
   */
  dependsOnProposalIds?: string[];
}
```

### Worked example

```ts
// Agent's tool calls — all four hit the same chat transcript.
propose_initiative({ proposalId: "init-auth", name: "User Auth" })

propose_feature({
  proposalId:        "f-infra",
  parentProposalId:  "init-auth",
  workspaceSlug:     "infra",
  title:             "Auth schema",
})

propose_feature({
  proposalId:           "f-backend",
  parentProposalId:     "init-auth",
  workspaceSlug:        "backend",
  dependsOnProposalIds: ["f-infra"],     // ← sibling proposal, not in DB yet
  title:                "Auth API",
})

propose_feature({
  proposalId:           "f-web",
  parentProposalId:     "init-auth",
  workspaceSlug:        "web",
  dependsOnProposalIds: ["f-backend"],   // ← sibling
  dependsOnFeatureIds:  ["cmpqr123…"],   // ← also depends on an existing
                                         //   feature already in the DB
  title:                "Login UI",
})
```

Approval walk:

1. User approves `init-auth` → Initiative created with cuid `cmA`. Synthetic assistant message lands with `approvalResult: { proposalId: "init-auth", createdEntityId: "cmA" }`.
2. User approves `f-infra` → handler reads transcript, finds `init-auth → cmA`, creates feature row `cmB` with `initiativeId: cmA`. No dependencies.
3. User approves `f-backend` → handler finds `init-auth → cmA` and `f-infra → cmB`, creates row `cmC` with `initiativeId: cmA` and `dependsOnFeatureIds: ["cmB"]`.
4. User approves `f-web` → handler finds `init-auth → cmA` and `f-backend → cmC`. Unions `["cmC"]` (resolved from `dependsOnProposalIds`) with `["cmpqr123…"]` (already-cuid array, copied through). Creates row `cmD` with `dependsOnFeatureIds: ["cmC", "cmpqr123…"]`.

`Feature.dependsOnFeatureIds` is always a clean array of real cuids. Proposal-ids never touch the DB.

### Implementation

Update `propose_feature` in `src/lib/ai/initiativeTools.ts`:

1. Add both fields to the zod input schema. The descriptions must spell out the cuid-vs-proposal-id distinction (this is the #1 way an LLM gets it wrong).
2. Validate `dependsOnFeatureIds` at propose-time: each cuid must exist and belong to this org. Same query pattern as the existing `initiativeId` / `milestoneId` org-ownership checks. Self-edge check: `featureId !== blockerId` for each — mirrors the Task self-edge check.
3. Don't validate `dependsOnProposalIds` at propose-time (the transcript isn't available to the tool). Approval-time handles it.
4. Pass both fields through to the `ProposalOutput`.

Update `approveFeature` in `src/lib/proposals/handleApproval.ts`:

1. After the existing `parentProposalId` resolution, resolve each id in `dependsOnProposalIds`: scan the conversation for the matching `approvalResult`, pull `createdEntityId`. If any id has no `approvalResult` yet, return an error in the synthetic stream: *"Cannot approve this feature yet — blocker proposal `f-infra` hasn't been approved."* Mirror the existing parent-not-approved error path.
2. Reject if any resolved `approvalResult.kind !== "feature"` — symmetric with the existing parent-must-be-initiative check.
3. Union the resolved cuids with `dependsOnFeatureIds`. De-dup. Self-edge check against the new feature (defensive — propose-time also checks but the inline-edit override could have changed `dependsOnFeatureIds`).
4. Cycle check the union against the existing DB graph before creating the row.
5. Pass the final array through to `createFeature(…)`.

Wire the new param through `createFeature` in `src/services/roadmap/features.ts:253` so it lands on the Prisma create call.

## Phase 4 — projector: render dependencies as synthetic edges

On the initiative sub-canvas (`ref: "initiative:<id>"`), every `dependsOnFeatureIds` entry where **both** endpoints are anchored to this initiative becomes a projector-emitted synthetic edge.

In `src/lib/canvas/projectors.ts`, extend the existing initiative projector (the one that already emits `synthetic:feature-milestone:<featureId>` edges for `Feature.milestoneId`):

```ts
// pseudo-shape — confirm exact projector return type during implementation
for (const feature of anchoredFeatures) {
  for (const blockerId of feature.dependsOnFeatureIds) {
    if (anchoredFeatureIds.has(blockerId)) {
      edges.push({
        id: `synthetic:feature-blocks:${blockerId}:${feature.id}`,
        fromNode: `feature:${blockerId}`,
        toNode: `feature:${feature.id}`,
        customData: { kind: "blocks" },
        // styling carried by the canvas-theme.ts category — see below
      });
    }
  }
}
```

Symmetric handling at write time, identical to `synthetic:feature-milestone:`:

- `splitCanvas` (`src/lib/canvas/io.ts`) filters out anything matching `synthetic:feature-blocks:` so the authored blob never carries the synthetic edge.
- `OrgCanvasBackground.handleEdgeAdd` intercepts user-drawn edges between two `feature:` cards on the initiative canvas — if the source feature isn't already in the target's `dependsOnFeatureIds`, PATCH the target feature with the appended array. The library's optimistic write gets undone via `applyMutation(removeEdge)`, identical to the feature↔milestone interception today.
- `OrgCanvasBackground.handleEdgeDelete` intercepts the `synthetic:feature-blocks:` prefix and PATCHes the array with the id removed.
- `notifyFeatureDependencyRefresh(featureId, { workspaceId, initiativeId })` (new pusher helper in `src/lib/canvas/feature-pusher.ts`) fans `CANVAS_UPDATED` on root + the initiative ref + the two workspace refs. Same pattern as `notifyFeatureReassignmentRefresh`.

What this does **not** include:

- Cross-initiative dependencies (a feature in initiative A blocks one in initiative B). The data column supports it; the projector just doesn't render it as an edge on either canvas. Acceptable for v1 — the rare cross-initiative case is visible via `read_feature` on either side and via a future "open initiative graph" view if it ever matters.
- Loose-feature dependencies (a feature with no initiative blocks one with). Same — data supports it, no projector edge in v1.
- Cycle-detection at edge-draw time on the canvas. Server returns 400 from the PATCH; the canvas reverts. Polish later.

Theme: add a `customData.kind === "blocks"` arm in `canvas-theme.ts`'s edge renderer for a distinct visual (e.g. dashed line + arrowhead + tooltip "blocks") so it reads differently from authored edges and from feature→milestone synthetic edges.

## Phase 5 — `update_feature_plan` tool: consistency editing

Add one tool to `src/lib/ai/initiativeTools.ts`.

```ts
update_feature_plan: tool({
  description:
    "Edit a feature's durable plan text — any combination of `brief`, " +
    "`requirements`, and `architecture`. Use this when the cross-" +
    "workspace agent needs to keep multiple features consistent — e.g. " +
    "the backend feature renamed a field from `user_id` to `userId`, " +
    "so the web and mobile features need their briefs and requirements " +
    "updated to match. Direct DB write (no proposal flow) — same posture " +
    "as `assign_feature_to_workspace`. Validates org ownership. Each " +
    "field is replace-only on this call; to extend rather than overwrite, " +
    "call `<slug>__read_feature` first and send back the combined text. " +
    "Fields not passed are left untouched. Edits fan out via " +
    "`notifyFeatureContentRefresh` so every open canvas refetches.",
  inputSchema: z.object({
    featureId: z.string().min(1),
    brief: z.string().optional(),
    requirements: z.string().optional(),
    architecture: z.string().optional(),
  }),
  execute: async (input) => { /* validate org ownership, updateFeature, notify */ },
}),
```

Scope is deliberately narrow — three text fields. Excluded by design:

- **`userStories`** — user stories live in a separate `UserStory` model with their own CRUD path, and the conversational plan chat is where they're typically managed. The cross-workspace consistency loop doesn't need to touch them in v1. If it turns out the agent needs to align user stories across features later, it can ask the user in chat or coordinate via the per-feature plan chat. Future seam.
- **`personas`** — not in scope.
- **`title`** — already editable via the canvas card rename → PATCH path; orthogonal mechanism.
- **`status`, `assigneeId`, `milestoneId`, `initiativeId`** — workflow/assignment fields owned by other tools (`assign_feature_to_initiative`, etc.).

Why no proposal flow:

- The risk profile matches the existing `assign_feature_to_workspace` and the canvas-rename PATCH path: these are reversible content edits the user can review on the feature page. Asking for explicit approval per-field would make the cross-workspace consistency loop unusable — the agent would need to surface 3+ approval cards every time it propagates a field rename.
- The user's recourse for a bad edit: open the feature page or ask the agent to revert. This matches how feature plan-chat edits work today.

Why "plan" not "brief":

- The tool edits more than just `brief` — `requirements` and `architecture` are durable plan text too. "Brief" lies about scope.
- "Plan" matches existing vocabulary in this codebase: `<FeaturePlanChat>`, the `planUpdatedAt` column, the "plan_mode" Stakwork workflow. The fields edited here are exactly the text the per-feature planner produces. The name tells the agent "this is the per-feature plan; you're allowed to overwrite it from the canvas-level vantage point."

Discovery surface for the agent: the existing `<slug>__read_feature` tool returns the full feature shape including `brief` / `requirements` / `architecture`. The cross-workspace consistency loop is:

1. User says "the backend feature renamed `user_id` to `userId` — fix the others."
2. Agent calls `<slug>__read_feature` on each feature in the initiative (or just the affected ones).
3. Agent diffs in its head, drafts updated text for each affected feature.
4. Agent calls `update_feature_plan` once per feature.
5. Agent posts a short summary in chat: *"Updated `brief` and `requirements` on Web Login and Mobile Login to use `userId`. The Backend Auth feature already uses it."*

Implementation: `updateFeature` in `src/services/roadmap/features.ts:431` already handles all three fields — the tool wrapper validates org ownership, calls it, and fans `CANVAS_UPDATED` via `notifyFeatureContentRefresh` from `src/lib/canvas/feature-pusher.ts` (which already covers root + parent initiative canvas; see CANVAS.md's "side-channel DB writes from canvas interactions" gotcha for why the workspace canvas is intentionally not in this fan-out — rare enough that a `CANVAS_UPDATED` miss is acceptable).

## Phase 6 — clarifications: prompt + AttentionList, no new primitive

The user's original framing was *"the canvas agent can be the 1 single place where clarifying questions are shown."* On closer look, **two surfaces already cover this** and a new agent-emitted "question card" would be redundant infrastructure:

1. **The canvas agent's own questions are just text.** When the orchestrating agent hits genuine cross-feature ambiguity ("should `user_id` or `userId` be the canonical name?"), it should pause its tool-call sequence and write a plain assistant message. The user replies as normal text. No structured primitive earns its keep here — assistant messages and the chat input already do the job.
2. **Per-feature planner questions ride the existing `AttentionList`.** The synthetic intro card already fans signal queries across the user's accessible workspaces and surfaces "features awaiting your feedback" and "tasks with FORM artifact." Each item `window.open`s the feature/task page in a new tab, where the existing `<FormArtifact>` component renders the structured question and the user answers in place. That IS the cross-workspace question inbox — it just isn't yet integrated with the canvas-agent loop.

What this phase actually adds is **prompt awareness of the clarification loop**, with zero new tools:

- Teach the agent that when it begins coordinating an in-flight initiative, it should call `<slug>__read_feature` on each feature to spot open FORM artifacts in the chat history.
- Teach it to recognize when multiple features have analogous open questions (e.g. all three features have a FORM about session timeout). The right response: write a one-paragraph summary in canvas chat — *"Web Login, Mobile Login, and Backend Auth all have an open FORM about session timeout. If you tell me one answer here, I can fold it into the three feature briefs via `update_feature_plan`. You'll still need to answer the FORM on each feature page (they're in the AttentionList at the top of this chat) — but the briefs will already reflect the decision when you get there."*
- Teach it that if the user gives a one-shot answer in canvas chat, the agent calls `update_feature_plan` on each affected feature to fold the decision into `brief` / `requirements` / `architecture`. The user still answers the FORM artifacts on the individual feature pages (the per-feature planner is waiting on those) — the canvas-agent edit just makes the plan text consistent so when the user gets there, the new context is in place.

What this phase intentionally does **not** add:

- A canvas-agent "question card" primitive (the rejected `ask_user` tool). The agent can ask via plain text; the user can answer via plain text. Inventing a structured tool would only matter if we needed to halt the agent's stream or route an answer to a specific question id mechanically — neither is true in v1.
- A `forward_feature_question` tool that re-renders FORM artifacts in canvas chat. The AttentionList → new-tab flow already gets the user to the right place; building a parallel inline-render path duplicates UI surface for a small UX win.
- Anything that watches per-feature plan chats in the background to push notifications to the canvas. Inferred friction, not observed friction — see Future seams.

The honest scope here is: **a single prompt paragraph, no code.** The leverage is real because the agent today is unaware that the FORM-artifact + AttentionList loop exists; teaching it unlocks the cross-workspace consistency play even though no new tool is shipped.

## Phase 7 — prompt updates

`getCanvasPromptSuffix()` gets a new **Cross-workspace initiatives** section (the Phase 1 wording, expanded), plus tool entries for `update_feature_plan` and the two new `propose_feature` dependency fields, plus the clarification-loop guidance from Phase 6.

Key prompt principles:

- **Default to multi-workspace for system-spanning work.** "Add auth," "build a notification system," "ship a new entity end-to-end" — these are multi-feature, multi-workspace by default. Single-workspace features are for genuinely isolated work.
- **Use `dependsOnProposalIds` deliberately, not exhaustively.** A typical 3-feature stack has 2 edges (infra → backend, backend → frontend), not 6. Over-edged graphs are noisy and constrain the user's flexibility.
- **`update_feature_plan` is for cross-feature consistency.** It edits `brief` / `requirements` / `architecture` on an existing feature. A single-feature edit goes through the feature's own plan chat. The canvas-level tool exists because the per-feature planner can't see siblings. Don't reach for it to edit user stories, status, or assignment — wrong tool.
- **Clarifying questions: ask in plain text, then propagate.** If you hit genuine cross-feature ambiguity, write a plain assistant message asking the user. If you discover analogous FORM artifacts open on multiple features, summarize them in chat and offer a one-shot answer that propagates via `update_feature_plan`. Don't reach for a structured primitive — there isn't one.

## Approval flow (sequence)

```
User: "Add user auth across infra, backend, and web."

Agent:
  propose_initiative({ id: "i", name: "User Auth" })
  propose_feature({ id: "a", workspaceSlug: "infra",   parentProposalId: "i", … })
  propose_feature({ id: "b", workspaceSlug: "backend", parentProposalId: "i",
                    dependsOnProposalIds: ["a"], … })
  propose_feature({ id: "c", workspaceSlug: "web",     parentProposalId: "i",
                    dependsOnProposalIds: ["b"], … })

Chat renders 4 proposal cards.

User clicks Approve on initiative card.
  → handleApproval creates Initiative; appends approvalResult.

User clicks Approve on feature-a card.
  → handleApproval resolves parentProposalId "i" → initiativeId.
  → No dependsOnProposalIds. Creates Feature a.

User clicks Approve on feature-b card.
  → handleApproval resolves parentProposalId "i" → initiativeId.
  → Resolves dependsOnProposalIds ["a"] → [feature-a-id].
  → Creates Feature b with dependsOnFeatureIds: [feature-a-id].

User clicks Approve on feature-c card.
  → Same as b, with dependsOnFeatureIds: [feature-b-id].

Projector emits two synthetic edges on the initiative sub-canvas:
  synthetic:feature-blocks:<a-id>:<b-id>
  synthetic:feature-blocks:<b-id>:<c-id>
```

If the user approves out of order (e.g. tries to approve feature-b before feature-a), the handler returns a clear synthetic assistant message: *"Cannot approve **Auth API endpoints** yet — blocker **Auth schema + migrations** hasn't been approved. Approve that one first."* Mirrors the existing `parentProposalId` ordering error.

## Idempotency, ordering, forks

All inherited from the existing proposal pattern; no new logic needed.

- Re-clicking Approve on any of the four cards: the route's idempotency scan finds the prior `approvalResult` and short-circuits. Cross-proposal links don't change this — the scan returns the existing `createdEntityId` and the dependency resolution sees a stable answer.
- Forks (share-fork via `?chat=<shareId>`): the fork's conversation transcript carries every proposal AND every `approvalResult` from the original chat up to the fork point. The forker can approve any still-pending proposal independently; dependency resolution works in the forked conversation because the resolved ids are already in `approvalResult`.
- Conversation truncation / context windows: the `parentProposalId` and `dependsOnProposalIds` resolvers scan the full message list, not a window. The list lives in `SharedConversation.messages` as one JSON blob — no truncation issue at the persistence layer. If the LLM context window forces the agent to forget what it proposed, the human approval path is unaffected because the handler runs server-side over the full transcript.

## Cycle prevention

Two layers:

1. **At proposal time.** The agent's prompt instructs that `dependsOnProposalIds` express *layering* (infra → backend → frontend), not bidirectional links. If the agent emits a cycle in proposals, the user can simply reject one and re-prompt.
2. **At approval time.** Before writing `dependsOnFeatureIds`, walk the existing graph (proposed + already-DB) and refuse the create if the new edges would close a cycle. Return a clear error in the synthetic stream. Same algorithm `src/services/roadmap/tickets.ts:564-580` uses for tasks; lift it into a shared `cycleDetect(graph, newEdges)` helper.

Cross-initiative cycles: trivially impossible if dependencies stay within an initiative (the policy choice for v1). When we relax that later, the same cycle check still works — it's graph-global, not initiative-scoped.

## Testing

- **Unit:** `cycleDetect` (steal the existing Task test fixtures and rename); `approveFeature` with `dependsOnProposalIds` resolving against a fixture conversation; `propose_feature` zod schema rejecting cycles in the proposed array against existing DB.
- **Integration:** end-to-end "approve initiative + 3 features with proposal-id deps" through `/api/ask/quick`; cross-workspace `propose_feature` with an unresolvable `workspaceSlug`; deletion cleanup (`Feature.delete` strips the deleted id from every dependent's `dependsOnFeatureIds`).
- **Prompt evals:** a small fixture of multi-workspace prompts (auth, notifications, billing) and an assertion that the agent emits one Initiative + N features with at least one `dependsOnProposalIds` link. Iterate the prompt until it's reliable.
- **Manual:** propose a 4-feature initiative across 3 workspaces with a dependency diamond, approve in different orders, confirm the synthetic edges render correctly on the initiative canvas and that the data column matches the visual graph.

## Phasing

The plan is structured to ship in five independent, user-visible increments:

1. **Phase 1 (prompt only).** Cross-workspace initiatives work today; we're just teaching the agent. Validate with prompt evals. **Risk: none. Effort: ~half a day.**
2. **Phase 2 + 3 (column + `propose_feature` extension).** Schema migration, type changes, `approveFeature` resolves the new ids, `createFeature` writes the array. No projector yet — the data is stored but invisible. **Risk: low (mirrors `Task.dependsOnTaskIds` exactly). Effort: ~1–2 days.**
3. **Phase 4 (projector + canvas gestures).** Synthetic edge rendering on the initiative canvas; click-to-add and click-to-delete intercepts; cycle check on PATCH. **Risk: low (mirrors the feature↔milestone interception pattern exactly). Effort: ~2 days.**
4. **Phase 5 (`update_feature_plan`).** New tool, no schema, reuse existing `updateFeature` service. **Risk: low. Effort: ~1 day.**
5. **Phases 6 + 7 (prompt).** Clarification-loop guidance and the consolidated `getCanvasPromptSuffix()` additions for everything in this plan. No code beyond the prompt string. **Risk: none. Effort: ~half a day.**

You can ship 1–3 alone and have a useful demo: multi-workspace initiatives with visible dependency edges. 4 unlocks the "fix divergent briefs" loop. 5 closes the loop by teaching the agent to coordinate clarifications through the existing FORM-artifact + AttentionList surface.

## Future seams

- **Autonomous scheduler.** Mirror `task-coordinator-cron.ts` for features: walk `dependsOnFeatureIds`, find features whose blockers have reached the threshold (likely `FeatureStatus.COMPLETED` or "latest PR merged" via the feature's task list), surface them as *"Ready to start — kick off the planning workflow?"* in canvas chat. Build this only after the data layer (phases 2–3) is being used and you can see the actual scheduling patterns.
- **Per-feature plan-chat watcher + canvas-chat-native FORM rendering.** If the AttentionList → new-tab loop proves too friction-heavy when users have many open FORMs across an initiative, build the inline-render path: a background job subscribes to each feature's Pusher channel and pushes new FORM artifacts into the canvas chat store; a new `forward_feature_question(artifactId, contextFeatureIds[])` tool reuses the existing `<FormArtifact>` component to render the question inline in canvas chat; clicking an option POSTs to `/api/chat/message` against the originating feature with `replyId` set (the same path the feature page uses). The canvas agent layers triage on top: auto-answer if the conversation has already decided, deduplicate when N features ask the same question, escalate the residual. No schema change. Build only after Phase 6's prompt-only loop is in use and you've seen where it falls short — friction-driven, not anticipated.
- **Structured canvas-agent question primitive.** If observed usage shows the canvas agent's own plain-text questions are hard to route (e.g. the user replies hours later with no thread context and the agent can't tell which question is being answered), add an `ask_user`-style tool that emits a structured question with a stable `questionId` and an `answer` reply field on the user message. Same persistence trick as proposals — `question?` / `answer?` fields on `CanvasChatMessage`, status derived by scanning the transcript, no DB tables. Defer until the plain-text flow is actually too ambiguous in practice.
- **Dependency kinds and thresholds.** If the simple "blocker must be `COMPLETED`" rule turns out to be too rigid (e.g. some teams want "blocker's brief is signed off" as the threshold), extend the column to a small JSON shape or split into a join table. We have not yet seen a user need this, and adding it now would slow the rest of the plan down for no observed benefit — that's the lesson from the Task model, which has lived with a flat string array for a while.
- **Cross-initiative dependency edges.** The data column supports it today; we just don't render. When this becomes a real workflow, extend the projector to emit cross-canvas edges on each side that link to the other initiative's canvas via `?canvas=` deep links. No schema change required.
- **Loose-feature dependencies.** Same posture: data supports, projector doesn't render in v1. The workspace canvas projector could emit `synthetic:feature-blocks:` edges between pinned features when both are pinned on the same workspace canvas — straightforward addition once the initiative projector pattern is settled.
- **Dependency-aware approval bundling.** Instead of clicking Approve four times in order, the user clicks "Approve all" on the initiative card and the handler walks the proposal DAG in topological order, creating rows in the right sequence. Same `cycleDetect` helper, plus a small `topoSortProposals(messages)` utility. Add only if the per-card-approval flow proves tedious in practice.
