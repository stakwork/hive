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
}

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

/**
 * All three `status-*` categories expose the same customData contract,
 * so we factor it out. Keeps the registry below scannable.
 */
const STATUS_CUSTOM_DATA: CategoryCustomDataKey[] = [
  {
    key: "primary",
    description:
      'progress percent — e.g. `"38%"` or `0.38`. Drives the progress bar and shows as the first footer number.',
  },
  {
    key: "secondary",
    description: 'footer text — e.g. `"4 blockers"` or `"6 ppl"`.',
  },
  {
    key: "secondaryAccent",
    description:
      "when `true`, render `secondary` in the status color (red/amber). Use for blockers or risks; leave off for neutral counts.",
  },
  {
    key: "count",
    description:
      "number on the notched tab badge in the top-right. Use for open blocker count.",
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
    promptGuidance: "Use one per workspace you want to show.",
  },
  {
    id: "objective",
    agentDescription: "top-level goal with a gradient title",
    promptGuidance:
      "Multi-line `text` renders with a gradient (use `\\n` to split lines). Usually one per workspace, or one shared org-wide north-star.",
  },
  {
    id: "status-ok",
    agentDescription: "initiative card, on-track (green pill)",
    customDataKeys: STATUS_CUSTOM_DATA,
  },
  {
    id: "status-attn",
    agentDescription: "initiative card, needs attention (amber pill)",
    customDataKeys: STATUS_CUSTOM_DATA,
  },
  {
    id: "status-risk",
    agentDescription: "initiative card, at risk (red pill)",
    customDataKeys: STATUS_CUSTOM_DATA,
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
];

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * One-line category vocabulary for the Zod `category` field's tool-schema
 * description. Kept deliberately compact — the agent pays tokens for
 * this on every tool call.
 */
export function buildCategoryDescription(): string {
  const parts = CATEGORY_REGISTRY.map(
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
