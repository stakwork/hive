/**
 * Leaf module of small shared prompt-rule constants.
 *
 * Kept separate from `src/lib/constants/prompt.ts` on purpose: these
 * constants are referenced from `prompt.ts` (the planner capability
 * snippet), `src/lib/ai/initiativeTools.ts` (the `send_to_feature_planner`
 * tool description), and `src/services/canvas-agent-autoturn.ts` (the
 * `form` wake message) — and about 15 tests mock `@/lib/constants/prompt`
 * wholesale. If this module lived inside `prompt.ts`, every one of those
 * mocks would see `undefined` for these exports. This file imports
 * nothing from `prompt.ts`, so it is safe to import directly wherever
 * `prompt.ts` is mocked.
 */

/**
 * The FORM rule: Jamie may answer a plain-text procedural question, but
 * never answers a structured FORM on its own — a FORM means a human
 * must choose. Used verbatim in the planner capability snippet, the
 * `send_to_feature_planner` tool description, and the autoturn wake
 * message.
 */
export const PLANNER_FORM_RULE =
  "You may answer a plain-text procedural question (e.g. 'ready for " +
  "architecture?'). Never answer a FORM on your own: bring it to the " +
  "user. Answer it only when the user tells you to, or gives you the " +
  "answer. 'Manage this feature' alone is not permission.";

/**
 * Wake-turn override: no user is present when a planner wakes Jamie, so
 * this rule wins over any earlier instruction in the conversation —
 * including a standing "answer FORMs for me" from the user.
 */
export const PLANNER_FORM_WAKE_RULE =
  "No user is present in a wake turn, so this rule wins over any " +
  "earlier instruction in this conversation, including one to answer " +
  "FORMs. NEVER auto-answer a FORM here: escalate it or stay silent.";

/**
 * A GitHub org/repo owner is not necessarily a Hive workspace, even
 * when the names match. Added to the workspace guidance in the
 * multi-workspace system prompt.
 */
export const GITHUB_ORG_RULE =
  "**A GitHub org or repo owner is not a workspace**, even when its " +
  "name matches a workspace slug. Pick the workspace from this list " +
  "or the repo card.";
