# Jamie prompt slim-down — concept handoff & audit

> **Update, 2026-10-10.** The `roadmap`, `planner` and `graph_walker`
> snippets are gone in both modes: those capabilities are now "tools only",
> and their rules — including the §2 safety strings — ride in the tool
> descriptions, pinned by `src/__tests__/unit/lib/ai/toolDescriptionRules.test.ts`.
> Only `concepts` and `strut` are core. The slim toggle now only swaps the
> `concepts` snippet. The rest of this file is the record of the original
> slim-prompt PR.

Companion record for the PR that adds the slim canvas-agent prompt
(concept-tree mode). The slim prompt is opt-in per browser via the
"Concept-tree prompt" switch in the agent settings cog (stored in
localStorage and sent as `slimPrompt` on each canvas chat request); with
it off, or on planner wake turns, Jamie gets the full prompt unchanged.

In slim mode the code-built capability sections are shorter, and Jamie
relies on the concept tree for how-to detail. Where to start the walk
(`Glimmer (gRLM)` → Stadeum → Jamie) is set in the Prompt Manager prompt
`CANVAS_AGENT_SYSTEM_PROMPT`, for every turn; the code adds no entry
section of its own. No concept is named in code.

For each section the slim prompt drops, this lists the exact text removed,
so a reviewer can check the concept tree carries it. It also carries the
safety-rule audit that `KEPT_SAFETY_STRINGS` in `prompt-slim.test.ts` is
built from, the prior FORM wording, and the size-test numbers.

## 1. Moved text, by destination concept

### Hive Roadmap and Canvas

Removed from `getRoadmapCapabilitySnippet` (the full "Projected nodes"
explanation, minus the id-kind table which moved to `read_canvas`'s tool
description, and minus the "never create/edit" rule which stays in the
prompt):

> Rules for projected nodes:
>
> - **Never create them directly via canvas tools.** Do not emit
>   `workspace`, `repository`, `initiative`, or `milestone` category nodes
>   via `update_canvas` or `add_node`. They appear automatically from the
>   DB and the tool schema's category enum already excludes them.
> - **Never edit their text, category, or customData** — those come from
>   the DB and will be silently discarded by the server on write. The DB
>   row itself is managed via the OrgInitiatives table UI or the canvas
>   `+` menu (which opens a real DB-create dialog).
> - **For Initiatives, Features, and Milestones, you CAN propose new ones
>   via `propose_initiative`, `propose_feature`, and `propose_milestone`**
>   (see the Tools section). Those don't write to the DB directly — they
>   emit a proposal card in chat that the user explicitly approves with a
>   click. The user's approval is what creates the row. **For Workspaces
>   and Repositories, you have no propose tool — direct the user to the
>   appropriate UI.**
> - **You CAN edit their position, draw edges to/from them, and hide
>   them.** Position changes are persisted as a per-canvas overlay; edges
>   are persisted verbatim; hiding works by omission from `update_canvas`.
>
> ### Drilling into sub-canvases
>
> Some projected nodes carry a `ref` field — clicking them in the UI opens
> that sub-canvas. You can address sub-canvases too:
>
> - A workspace's sub-canvas: `ref: "ws:<id>"` (shows that workspace's
>   repos and any loose features).
> - An initiative's sub-canvas: `ref: "initiative:<id>"` (shows that
>   initiative's milestones ordered by sequence, every feature anchored
>   to that initiative, and synthetic membership edges from each feature
>   to its milestone when one is set).
>
> There is **no milestone sub-canvas**. Milestones are leaf cards on the
> initiative canvas; their linked features sit on that same canvas with
> edges connecting them.

**Kept in the slim prompt:** "Never create or edit `<kind>:` nodes
directly via canvas tools... they're written by the DB side and any
direct edit is silently discarded on write."

### Jamie Roadmap Proposals

Removed from `getRoadmapCapabilitySnippet`'s "Cross-workspace initiatives
are first-class" section (seed-depth guidance and the worked example;
"never invent a contract" stays in the slim text):

> **This is the default for system-spanning work.** Don't collapse
> multi-workspace work into one workspace's feature with vague "we'll
> coordinate across teams later" language in the brief. If the user
> names multiple layers/systems, that's a signal to propose multiple
> features.
>
> Where the order matters (typical layering: schema/migrations → backend
> endpoints → frontend integration), set `dependsOnProposalIds` on the
> blocked feature to point at its blocker's `proposalId`.
>
> Worked example. *User: "Add user authentication to the platform —
> infra, backend, and web."*
>
> 1. `read_canvas` (root) to see existing workspace slugs and any related
>    existing initiatives.
> 2. `propose_initiative({ proposalId: "init-auth", name: "User
>    Authentication", ... })`.
> 3. `propose_feature({ proposalId: "f-infra", workspaceSlug: "infra",
>    parentProposalId: "init-auth", title: "Auth schema + migrations",
>    ... })`.
> 4. `propose_feature({ proposalId: "f-backend", workspaceSlug:
>    "backend", parentProposalId: "init-auth", dependsOnProposalIds:
>    ["f-infra"], title: "Auth API endpoints", ... })`.
> 5. `propose_feature({ proposalId: "f-web", workspaceSlug: "web",
>    parentProposalId: "init-auth", dependsOnProposalIds: ["f-backend"],
>    title: "Login + session UI", ... })`.
>
> **Seed depth on `propose_feature` (`initialMessage`) — follow the
> user's lead.** [full paragraph on matching seed richness to the
> conversation, not kicking off a research pass, and never guessing a
> contract — moved verbatim; see prior prompt.ts for the complete text.]

**Kept:** "Never invent a contract" (now phrased as "Never invent a
contract a sibling feature depends on; name it and tell the planner to
confirm it.").

### Jamie Managing Feature Planners (merge, don't overwrite)

Removed from `getPlannerCapabilitySnippet`'s "When a planner wakes you"
and "cross-feature ambiguity" sections:

> #### When the user expresses cross-feature ambiguity in an in-flight
> initiative
>
> (e.g. *"should we call this `user_id` or `userId` across all three?"*)
>
> 1. **Read each affected feature** with `<slug>__read_feature` — returns
>    current plan + `workflowStatus` + full chat history.
> 2. **Ask the user** for the decision in one line, or state the
>    divergence you found in one line.
> 3. **Delegate to each planner** with `send_to_feature_planner` — one
>    message per feature with the decision. Fire-and-forget; planners
>    reply async (30–120s).
> 4. **On the next turn**, re-read each feature to see replies; summarize
>    across features in one short paragraph.
>
> #### When a planner wakes you (not the user)
>
> Sometimes you'll be invoked not because the user typed a message, but
> because a planner you're managing just posted one. A synthetic system
> message at the start of your context will tell you when this is the
> case — it names the feature and the wake reason (a FORM, a question,
> or a workflow transition like "completed" / "failed" / "halted"). In
> those cases your job is the same as always: read the conversation,
> follow the user's standing instructions, and pick exactly one of three
> responses:
>
> - **Respond to the planner** with `send_to_feature_planner` when the
>   user's instructions (or plain procedural sense) let you answer — e.g.
>   they said "manage this for me" or the planner just asked "ready for
>   architecture?". Don't also write a chat message.
> - **Write a brief note to the user** (one short paragraph) when their
>   actual judgment is needed and you shouldn't decide for them.
> - **Do nothing** by calling the `stay_silent` tool — for pure status
>   updates, or when answering would just be inbox noise. Don't narrate
>   your non-action as a chat message; `stay_silent` is the clean way to
>   stay quiet.

**Merge note:** this concept already exists and holds a FORM rule —
merge the above into it; don't overwrite the existing content.

**Kept:** the one-line send / note / `stay_silent` choice, folded into
the slim prompt's bullet list under "When the user asks you to read a
feature".

### The Knowledge Graph on Stadeum

Removed from `getGraphWalkerCapabilitySnippet`:

> ### URN format
>
> URNs follow a variable-arity canonical format. Never construct URN
> strings by hand — use `formatUrn` from the URN utilities:
>
> ```
> canvas  →  urn:{org}:canvas:{type}:{id}
> kg      →  urn:{org}:kg:{workspace}:{type}:{id}
> ```
>
> Realms: `kg` (the swarm knowledge-graph — HiveFeature/HiveTask/
> HiveChatMessage plus code concepts, files, functions, data models) and
> `canvas` (canvas nodes). `pg` is disabled.
>
> ### kg realm workflow
>
> 1. Call `graph_ontology({ workspace })` → get the list of valid node
>    types for the workspace's KG.
> 2. Pick the relevant `type` values from the returned list (e.g.
>    `HiveFeature`, `HiveTask`, `HiveChatMessage`, `File`, `Function`).
> 3. Call `graph_search({ query, realm: "kg", workspace, type: "<chosen
>    type>" })` with the exact type string from step 2.

**Kept (verbatim, shortened):** "Never construct URN strings by hand —
use `formatUrn`" stays inline, plus the roadmap→code chain line (1 line,
must stay per the classification table).

### Jamie Knowledge Capture

Removed from `getGraphWalkerCapabilitySnippet`'s graph-write rules 5 and
8:

> 5. **`"Warning"` / already-existed is a success.** If an approval
>    result says `alreadyExisted: true`, the node or edge already
>    existed — no duplicate was created. Report this to the user as a
>    success ("already existed, no duplicate created"), not as a
>    failure.
>
> 8. **Edges are addressed by their ends, never by an edge id.**
>    `propose_delete_edge({ workspaceSlug, edge_type, source_ref_id,
>    target_ref_id })` names the relationship as
>    `(source)-[:edge_type]->(target)` with both ends' `ref_id`s from
>    `graph_get` / `graph_neighbors` / `graph_search` (a
>    `graph_neighbors` result gives you the neighbor's `ref_id`, the
>    `edgeType`, and the `direction` — `forward` means the queried node
>    is the source). The tool confirms the edge exists when you propose;
>    the card is refused if it doesn't. Remove one relationship at a
>    time, and say in `rationale` why it is wrong.

Removed from `getConceptsCapabilitySnippet`'s "Remember this" flow (the
numbered steps; the trigger phrase list and the "check existing → update
with full body, else propose new" summary stay):

> 1. First call `list_concepts` (or `{slug}__list_concepts`) to see
>    whether a relevant concept already exists.
> 2. If a good match exists → read its current documentation with
>    `read_concept_documentation` first, then `propose_concept_update`
>    with the FULL merged body.
> 3. If nothing fits → `propose_new_concept` to create a new one.

**Kept:** the "remember this" trigger phrase list, plus "check existing →
update with the full body, else propose new" (one line).

## 2. Seed-list audit — "Hard safety rules" (Jamie concept)

Quoting the Jamie concept's "Hard safety rules" bullet list, mapped to
the exact string that keeps each rule alive in the slim prompt. This
table is the source for `KEPT_SAFETY_STRINGS` in `prompt-slim.test.ts`.

| # | Seed-list rule (as audited in the Jamie concept) | Kept via |
|---|---|---|
| 1 | Propose, do not write. | "You are not a coding agent. You never make code changes yourself." / "Propose, don't write." (graph-write rule 1) — both verbatim in the slim prompt. |
| 2 | `repo_agent` is read-only. | "`repo_agent` is **STRICTLY READ-ONLY investigation**" — verbatim, must-stay. |
| 3 | Never answer a planner FORM on its own; bring it to the user; answer only when told to or given the answer. | `PLANNER_FORM_RULE` (deliberate wording change — see below). |
| 4 | `graph_query` is scoped to workspace membership, not admin-only. | "Callable by any member of the named workspace" in the slim `graph_query` bullet; stale "admin-only" claim removed. |
| 5 | Never invent a contract. | "**Never invent a contract** a sibling feature depends on; name it and tell the planner to confirm it." (roadmap snippet, kept inline). |
| 6 | Never construct URNs by hand. | "Never construct URN strings by hand — use `formatUrn`" (graph_walker snippet, kept inline). |
| 7 | Mirror-owned graph node types are not editable. | Graph-write rule 7, kept verbatim (one line). |
| 8 | Cycles in dependencies/moves are rejected. | `dependsOn*` `.describe()` text in `initiativeTools.ts` + graph-write rule 9 (move, not delete-plus-create). |
| 9 | A GitHub org/repo owner is not a workspace. | `GITHUB_ORG_RULE`, added to the workspace guidance section. |

**Deliberate change in meaning:** the FORM entry (#3) maps to
`PLANNER_FORM_RULE` rather than the longer prior wording quoted below —
this is the change requirement 3 calls for ("New: `send_to_feature_planner`
and the planner rules state one FORM rule").

## 3. Prior wording, for rollback

**Jamie concept, "Hard safety rules" (FORM entry), prior wording:**

> Never answer a planner FORM on your own. A FORM means a human must
> choose. Bring it to the user. Answer it only when the user tells you
> to, or gives you the answer. "Manage this feature" alone is not
> permission. In a wake turn no user is present, so never answer a FORM
> there.

**Driving the Planning Agent concept, FORM entry, prior wording:**

> **Never answer a FORM on your own.** A FORM means a human must choose.
> Bring it to the user. Answer it only when the user tells you to, or
> gives you the answer. "Manage this feature" alone is not permission. In
> a wake turn no user is present, so never answer a FORM there.

If the slim prompt is dropped, restore both of the above verbatim
alongside the code revert, since the restored prompt says "never" while
the (unreverted) concepts would otherwise still read as allowing a
user-authorised answer via `PLANNER_FORM_RULE`.

## 4. Size-test numbers

"Code-built part" = `getMultiWorkspaceSystemPrompt` rendered with an
**empty** `canvasSystemPrompt` (persona excluded), a fixed 3-workspace
fixture (one-line descriptions, 3-person roster), plus
`composeCapabilityPromptSuffix(["roadmap", "planner", "graph_walker",
"concepts"])` for the core capabilities.

| Commit | System prompt | Capability suffix (core) | Total |
|---|---|---|---|
| Before (commit 1, pre-edit) | 9,552 | 55,844 | **65,396** |
| Slim mode (measured with the earlier per-section pointers, since removed) | 9,701 | 25,905 | **35,606** |

The after-total is higher than the plan's 22–28k estimate (mostly because
the roadmap snippet's Tools list and the graph-walker Read-tools list are
denser than first estimated, and because `getConceptsCapabilitySnippet`
and `getPlannerCapabilitySnippet` keep more must-stay prose than the
estimate assumed). The size test's cap is set at the measured value
(35,606) rounded up with ~10% headroom (39,200), not the original 22–28k
estimate — see `prompt-slim.test.ts`.
