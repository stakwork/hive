/**
 * Leaf module of small shared prompt-rule constants.
 *
 * Kept separate from `src/lib/constants/prompt.ts` on purpose: these
 * constants are referenced from `prompt.ts` — and about 15 tests mock `@/lib/constants/prompt`
 * wholesale. If this module lived inside `prompt.ts`, every one of those
 * mocks would see `undefined` for these exports. This file imports
 * nothing from `prompt.ts`, so it is safe to import directly wherever
 * `prompt.ts` is mocked.
 */

/**
 * A GitHub org/repo owner is not necessarily a Hive workspace, even
 * when the names match. Added to the workspace guidance in the
 * multi-workspace system prompt.
 */
export const GITHUB_ORG_RULE =
  "**A GitHub org or repo owner is not a workspace**, even when its " +
  "name matches a workspace slug. Pick the workspace from this list " +
  "or the repo card.";
