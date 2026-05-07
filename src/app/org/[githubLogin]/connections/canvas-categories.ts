/**
 * Canvas category registry — the SINGLE source of truth for what
 * categories exist on the org canvas and how the agent is taught about
 * them.
 *
 * The renderer (`canvas-theme.ts`) pairs each `id` here with a
 * `CategoryDefinition` that drives visual rendering. The agent-facing
 * docs (tool-input description + prompt Categories section) are
 * generated from this file so they can never drift.
 *
 * Adding a category is two edits:
 *   1. Append a `CategorySpec` entry to `CATEGORY_REGISTRY` below.
 *   2. Add the matching `CategoryDefinition` to the DEFINITIONS map in
 *      `canvas-theme.ts` (using the same `id`).
 *
 * This file is pure data — no React / system-canvas imports — so it can
 * be imported from server-side code (canvasTools, prompt) without
 * dragging renderer dependencies onto the server bundle.
 */

export interface CategoryCustomDataKey {
  /** `customData.<key>` name. */
  key: string;
  /** One-line meaning, rendered as a sub-bullet in the prompt. */
  description: string;
}

export interface CategorySpec {
  /** The category id — used in `node.category` and as the theme key. */
  id: string;
  /**
   * Short description used in the tool-input JSON schema AND as the
   * main sentence of the category's bullet in the prompt. Keep it to a
   * phrase; no trailing period.
   */
  agentDescription: string;
  /**
   * Optional extra guidance appended only to the prompt bullet — not to
   * the tool schema. Good place for "use one per X" / "multi-line text
   * renders with a gradient" kind of hints.
   */
  promptGuidance?: string;
  /**
   * Optional: the `customData` keys this category consumes. Rendered as
   * indented sub-bullets under the category in the prompt.
   */
  customDataKeys?: CategoryCustomDataKey[];
  /**
   * When `false`, this category's nodes are **projected from the DB**
   * and the agent should never create them. The renderer still accepts
   * them (they're normal nodes visually), but their text / category /
   * customData are server-owned; only the **position** is persisted
   * through the canvas write path. The agent can still draw edges
   * to/from them.
   *
   * Omit or set `true` for author-created categories (the default).
   */
  agentWritable?: boolean;
  /**
   * When `false`, this category is hidden from the user's `+` menu.
   * Used for entities the user cannot create from the canvas at all
   * (workspaces, repositories — those come from external integrations).
   *
   * When `true` AND `agentWritable: false`, the category IS shown in
   * the `+` menu but the client intercepts the click to open a creation
   * dialog that hits the appropriate REST API. Today: `initiative`
   * (root canvas) and `milestone` (initiative sub-canvas). See
   * `OrgCanvasBackground.tsx`'s `+` menu interception logic.
   *
   * Omit or set `true` for normal user-creatable categories (the default).
   */
  userCreatable?: boolean;
}

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

/**
 * `customData` keys used by the `initiative` category. Initiative
 * cards show progress (rolled up from completed milestones) but no
 * status pill — initiatives can be long-running or open-ended, so a
 * traffic-light would mislead.
 */
const INITIATIVE_CUSTOM_DATA: CategoryCustomDataKey[] = [
  {
    key: "primary",
    description:
      'progress percent — e.g. `"38%"` or `0.38`. Drives the progress bar and shows as the first footer number. Computed by the projector from completed-milestone count.',
  },
  {
    key: "secondary",
    description:
      'footer text — e.g. `"3/7 milestones"` or `"no milestones yet"`. Computed by the projector.',
  },
];

/**
 * `customData` keys used by the `milestone` category. Status maps
 * directly to the `MilestoneStatus` enum in Prisma — three values, no
 * traffic-light semantics layered on top.
 */
const MILESTONE_CUSTOM_DATA: CategoryCustomDataKey[] = [
  {
    key: "status",
    description:
      'one of `"NOT_STARTED"` | `"IN_PROGRESS"` | `"COMPLETED"` (mirrors the `MilestoneStatus` Prisma enum). Drives the card color: muted gray, blue, green respectively.',
  },
  {
    key: "progress",
    description:
      "fraction (0..1) of linked features whose `Feature.status === COMPLETED`. Drives the bodyTop progress bar. Computed by the projector; never authored.",
  },
  {
    key: "featureCount",
    description:
      "total non-deleted linked features. The progress bar is hidden when this is 0 (a 0% bar on an empty milestone reads as 'behind' rather than 'no work yet').",
  },
  {
    key: "featureDone",
    description:
      "count of linked features whose `Feature.status === COMPLETED`. Exposed for slots that want the raw counter without re-deriving it from `progress * featureCount`.",
  },
  {
    key: "secondary",
    description:
      'footer text — e.g. `"Due Mar 4 · 2/3 features"`. Composed by the projector from `dueDate` + linked-feature progress.',
  },
  {
    key: "agentCount",
    description:
      'count of tasks under any linked feature with `Task.workflowStatus ∈ {PENDING, IN_PROGRESS}` (the kanban definition of "in flight"). Drives the topRightOuter agent badge; hidden when 0.',
  },
  {
    key: "team",
    description:
      "array of distinct involved users — the union of each linked feature's `assignee` and `createdBy`, capped at 3 visible. Drives the topRight avatar stack.",
  },
  {
    key: "teamOverflow",
    description:
      'count of involved users beyond the 3 visible avatars. Renders as a "+N" pill to the left of the stack when > 0.',
  },
  {
    key: "sequence",
    description:
      "ordering integer within the parent initiative. The projector uses this for default x-axis placement on the timeline.",
  },
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const CATEGORY_REGISTRY: CategorySpec[] = [
  {
    id: "workspace",
    agentDescription:
      "teal container card representing a single workspace / repo in the org — the top layer",
    // Workspaces are projected live from the DB (id prefix `ws:`). The
    // agent never authors a workspace card directly; it edges OTHER
    // nodes to the existing `ws:<id>` nodes. Humans don't create
    // workspaces from the canvas either — they come from the workspace
    // creation flow elsewhere.
    agentWritable: false,
    userCreatable: false,
    promptGuidance:
      "Projected from the database — one `ws:<id>` node per live workspace. Do NOT create these yourself. Draw edges from initiatives or notes to them to show which workspace something belongs to.",
  },
  {
    id: "repository",
    agentDescription:
      "slate-indigo card representing a GitHub repository inside a workspace",
    // Repositories are projected live from the DB (id prefix `repo:`)
    // on a workspace's sub-canvas. Like workspaces, neither the agent
    // nor the user creates them from the canvas — they sync from
    // GitHub.
    agentWritable: false,
    userCreatable: false,
    promptGuidance:
      "Projected from the database — one `repo:<id>` node per repository on a workspace sub-canvas. Do NOT create these yourself.",
  },
  {
    id: "initiative",
    agentDescription:
      "a strategic initiative on the org root canvas — title, milestone-completion progress bar, and a footer like `3/7 milestones`",
    // Initiatives are projected from the DB (id prefix `initiative:`)
    // BUT the user can add new ones from the `+` menu — selecting
    // `initiative` opens a dialog and hits POST /api/.../initiatives.
    // The agent must not author initiative nodes directly.
    agentWritable: false,
    userCreatable: true,
    promptGuidance:
      "Projected from the `Initiative` Prisma model — one `initiative:<id>` node per row. Carries `ref: \"initiative:<id>\"` so clicking drills into the milestone timeline. Humans create initiatives via the canvas `+` menu (which opens a dialog) or the OrgInitiatives table UI; the agent must NEVER create or edit them. The agent's job around initiatives is annotation: edge them to the workspaces they belong to, leave notes about dependencies, draw blockers.",
    customDataKeys: INITIATIVE_CUSTOM_DATA,
  },
  {
    id: "milestone",
    agentDescription:
      "a milestone on an initiative's sub-canvas — small card with a status color (gray / blue / green) and a due-date footer",
    // Milestones are projected from the DB (id prefix `milestone:`) on
    // the initiative sub-canvas. Same `+ menu opens a dialog` pattern
    // as initiative. NOT drillable — they're leaf cards; their linked
    // features render alongside them on the same initiative canvas
    // with synthetic edges expressing membership.
    agentWritable: false,
    userCreatable: true,
    promptGuidance:
      "Projected from the `Milestone` Prisma model on an initiative sub-canvas. Laid out left-to-right by `sequence`. NOT drillable — there is no milestone sub-canvas; linked features render on the same initiative canvas with synthetic feature→milestone edges. Humans create milestones via the canvas `+` menu (which opens a dialog) or the OrgInitiatives table UI; the agent must NEVER create or edit them. Same annotation-only role as initiatives.",
    customDataKeys: MILESTONE_CUSTOM_DATA,
  },
  {
    id: "feature",
    agentDescription:
      "a feature card — sits on the workspace sub-canvas (loose) or the initiative sub-canvas (anchored)",
    // Features are projected from the DB (id prefix `feature:`). They
    // can be created by the user from any canvas via the `+` menu
    // (the dialog hits POST /api/features); the agent must never
    // author one. Where the new feature renders is the "most specific
    // place" by anchor: initiativeId set (with or without
    // milestoneId) → initiative sub-canvas; neither set → workspace
    // sub-canvas. Milestone membership is shown by a projector-emitted
    // synthetic edge to the milestone card on the same canvas.
    agentWritable: false,
    userCreatable: true,
    promptGuidance:
      "Projected from the `Feature` Prisma model. Renders on the workspace sub-canvas (loose) or the initiative sub-canvas (anchored). When the feature has a `milestoneId`, the projector emits a synthetic edge from the feature card to the milestone card on the same initiative canvas — that edge is DB-derived (cannot be authored or deleted by you). Humans create features via the canvas `+` menu (which opens a dialog) or the workspace plan page; the agent must NEVER create or edit them. Annotation-only.",
    customDataKeys: [
      {
        key: "status",
        description:
          'one of `"BACKLOG"` | `"PLANNED"` | `"IN_PROGRESS"` | `"COMPLETED"` | `"CANCELLED"` | `"ERROR"` | `"BLOCKED"` (mirrors the `FeatureStatus` Prisma enum). Drives the card color.',
      },
      {
        key: "workflowStatus",
        description:
          "the planning-workflow status (`PENDING | IN_PROGRESS | COMPLETED | ERROR | HALTED | FAILED`). Set when an AI plan-mode run is active for this feature.",
      },
      {
        key: "taskCount",
        description: "total non-deleted/archived tasks under this feature.",
      },
      {
        key: "taskDone",
        description: 'count of tasks where `Task.status === "DONE"`.',
      },
      {
        key: "secondary",
        description: 'footer text — e.g. `"2/3 tasks"`. Hidden when `taskCount === 0`.',
      },
    ],
  },
  {
    id: "task",
    agentDescription:
      "a task — compact card colored by workflow status; not currently projected on the org canvas",
    // Tasks are NOT projected on the org canvas today (they were
    // emitted by the now-removed milestone sub-canvas projector). The
    // category and `task:` id prefix are kept registered so the
    // splitter strips authored fields off any task nodes that might
    // arrive from a stale chat artifact, and so future surfaces can
    // reuse the visual treatment. Creation happens from a feature's
    // chat; neither the agent nor a `+` menu pick creates them.
    agentWritable: false,
    userCreatable: false,
    promptGuidance:
      "Projected from the `Task` Prisma model. Not currently emitted on any org canvas — task progress is rolled into the parent feature's footer (`X/Y tasks`). The agent must NEVER create or edit tasks. Annotation-only.",
    customDataKeys: [
      {
        key: "status",
        description:
          'one of `"TODO"` | `"IN_PROGRESS"` | `"DONE"` | `"CANCELLED"` | `"BLOCKED"` (the `TaskStatus` Prisma enum).',
      },
      {
        key: "workflowStatus",
        description:
          'one of `"PENDING"` | `"IN_PROGRESS"` | `"COMPLETED"` | `"ERROR"` | `"HALTED"` | `"FAILED"` (the `WorkflowStatus` Prisma enum). Drives the card color band — kanban-style: blue, green, red, amber.',
      },
      {
        key: "assigneeId",
        description: "the assigned user's id, when set. Drives any future avatar slot.",
      },
    ],
  },
  {
    id: "note",
    agentDescription:
      'amber free-floating callout — "Remember to...", "Heads up...", "Open question..."',
  },
  {
    id: "decision",
    agentDescription:
      'purple free-floating callout — "Shared vs dedicated pools?", "Adopt X or Y?"',
  },
  {
    id: "research",
    agentDescription:
      "an emerald research card — kicks off a web-research sub-agent that fills in a markdown doc",
    // Research nodes are projected from the `Research` Prisma table
    // (id prefix `research:`) BUT the user can drop a fresh one on
    // the canvas from the `+` menu. The `+` click is intercepted by
    // `OrgCanvasBackground`: it drops a temporary AUTHORED `research`
    // node (no `research:` prefix) so the user can type the topic
    // inline; on Enter/blur the topic kicks off the canvas-chat
    // agent's `save_research` tool, which creates the live row.
    // The authored node then gets swapped for the live `research:<id>`
    // node carrying the user's topic verbatim as the on-card label.
    //
    // The agent can also create research rows on its own initiative
    // (e.g. mid-conversation it decides external research would help).
    // Both paths flow through the same `save_research` tool; the chat
    // is the single source of truth for the research run.
    agentWritable: false,
    userCreatable: true,
    promptGuidance:
      "Projected from the `Research` Prisma model. Lives on root canvas (`initiativeId IS NULL`) or on an initiative sub-canvas (`initiativeId` set to that initiative). Two-phase lifecycle: `save_research` creates the row immediately with topic + title + summary so the node lands on the canvas, then `update_research` fills in `customData.content` (markdown) once web_search has gathered findings. Use the `research` category for any external/web research the user asks for, or when you decide unprompted that web research would meaningfully improve your answer. Do NOT emit `research` category nodes via `update_canvas` / `patch_canvas` — go through `save_research` instead so the DB row exists.",
    customDataKeys: [
      {
        key: "status",
        description:
          'one of `"researching"` (agent is searching the web / writing) | `"ready"` (markdown content is in). Drives the pulsing border + spinner badge.',
      },
      {
        key: "summary",
        description:
          "1-sentence overview set by `save_research`. Shown above the markdown body in the right-panel viewer.",
      },
      {
        key: "title",
        description:
          "agent-polished title set by `save_research`. Used as the right-panel viewer header. The on-canvas card label is the user's original `topic` (carried in `node.text`), not this title.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * One-line category vocabulary for the Zod `category` field's tool-schema
 * description. Kept deliberately compact — the agent pays tokens for
 * this on every tool call. Projected categories (`agentWritable: false`)
 * are omitted so the agent never tries to author one from scratch.
 */
export function buildCategoryDescription(): string {
  const parts = CATEGORY_REGISTRY.filter((c) => c.agentWritable !== false).map(
    (c) => `\`${c.id}\` (${c.agentDescription})`,
  );
  return `One of: ${parts.join(", ")}.`;
}

/**
 * Multi-line bulleted section for the prompt suffix. Includes the
 * `promptGuidance` sentence per category (when set) and a nested
 * sub-bullet per `customData` key.
 */
export function buildPromptCategorySection(): string {
  return CATEGORY_REGISTRY.map((c) => {
    const headline = c.promptGuidance
      ? `- \`${c.id}\` — ${c.agentDescription}. ${c.promptGuidance}`
      : `- \`${c.id}\` — ${c.agentDescription}.`;
    if (!c.customDataKeys?.length) return headline;
    const sub = c.customDataKeys
      .map((k) => `  - \`customData.${k.key}\` — ${k.description}`)
      .join("\n");
    return `${headline}\n${sub}`;
  }).join("\n");
}

// ---------------------------------------------------------------------------
// Scope-aware category rules
// ---------------------------------------------------------------------------

/**
 * Decide whether a given category should be offered for user creation
 * on the given canvas scope. A single rule consulted by both:
 *   - The `+` menu filter in `OrgCanvasBackground.renderAddNodeButton`
 *     (so only valid options appear).
 *   - The defensive dispatch in `OrgCanvasBackground.handleNodeAdd`
 *     (so a stray pick from a stale menu can't create something at
 *     the wrong scope).
 *
 * `ref` follows the canvas scope convention: `""` for root, `"ws:<id>"`
 * for a workspace sub-canvas, `"initiative:<id>"` for an initiative
 * timeline. Anything else (opaque scopes, future kinds) takes the
 * permissive default — only `userCreatable: false` is enforced.
 *
 * Hard rules (always enforced regardless of scope):
 *   - Categories with `userCreatable: false` (workspaces, repositories
 *     today) never appear in any `+` menu.
 *
 * Scope-specific rules:
 *   - `initiative` is only offered on root. It's an org-level entity;
 *     creating one inside a workspace or another initiative makes no
 *     ownership sense.
 *   - `milestone` is only offered on an initiative's sub-canvas. A
 *     milestone always belongs to a specific initiative, so anywhere
 *     else has no parent to attach to.
 *   - `feature` is allowed on every scope (root, workspace,
 *     initiative, milestone). Where the new feature renders depends
 *     on which anchors the dialog captured — see the "most specific
 *     place wins" rule in `services/roadmap/createFeature` and the
 *     workspace/initiative/milestone projectors. The dialog itself
 *     is responsible for resolving the right `(workspaceId,
 *     initiativeId, milestoneId)` triple per scope.
 *   - Authored categories (`note`, `decision`, plus the library's
 *     base `text` kind) are always allowed. They're free annotation
 *     primitives with no DB anchor.
 */
export function categoryAllowedOnScope(
  categoryId: string,
  ref: string,
): boolean {
  // Hard rule: hidden from menus on every scope.
  const spec = CATEGORY_REGISTRY.find((c) => c.id === categoryId);
  if (spec && spec.userCreatable === false) return false;

  // Scope-specific rules.
  if (categoryId === "initiative") return ref === "";
  if (categoryId === "milestone") return ref.startsWith("initiative:");
  // `research` lives on root (org-wide research) or on an initiative
  // sub-canvas (research scoped to that initiative). Workspace and
  // other sub-canvases don't host research today — keep the surface
  // small until there's a demand for it.
  if (categoryId === "research") {
    return ref === "" || ref.startsWith("initiative:");
  }

  // `feature` falls through to the default branch — allowed on every
  // scope. The dialog handles per-scope field locking (workspace
  // dropdown locked on `ws:`, initiative locked on `initiative:`,
  // both locked on `milestone:`, both required on root).

  // Default: allow. Covers `feature`, `note`, `decision`, future
  // authored categories, and any opaque scope we don't recognize.
  return true;
}
