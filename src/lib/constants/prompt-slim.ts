/**
 * Slim canvas-agent prompt (concept-tree mode).
 *
 * Opt-in per browser via the agent settings cog (`slimPrompt` on the chat
 * request; see `slimPromptPreference.ts`). How Jamie works, task by task,
 * lives in the concept tree it walks with the graph tools; where to start
 * that walk is in the Prompt Manager prompt `CANVAS_AGENT_SYSTEM_PROMPT`,
 * not here. Only the `concepts` snippet has a slim variant: `roadmap`,
 * `planner` and `graph_walker` have no snippet in either mode (their rules
 * ride in their tools' descriptions). Selected in
 * `composeCapabilityPromptSuffix`.
 *
 * Kept out of `src/lib/constants/prompt.ts` for the same reason as
 * `prompt-rules.ts`: many tests mock `@/lib/constants/prompt` wholesale,
 * and the capability registry references these exports at import time.
 */

export function getSlimConceptsCapabilitySnippet(): string {
  return `

## Concept Tools

**Concepts** are a workspace's knowledge-base entries — durable, human-readable documentation about a system, decision, runbook, or anything worth remembering. They live on each workspace's swarm (per-workspace, NOT global). You already have read tools (\`list_concepts\` / \`learn_concept\`, or the workspace-prefixed \`{slug}__list_concepts\` / \`{slug}__learn_concept\`); this capability adds \`read_concept_documentation\` plus two WRITE tools that go through human approval.

### "Remember this" is the trigger

When the user says things like **"Jamie, remember this"**, "note this down", "save this for later", "capture this as a concept", "document this", or "add this to the knowledge base" — that is a request to CREATE or UPDATE a concept. Do it proactively: check existing (\`list_concepts\` / \`{slug}__list_concepts\`, then \`read_concept_documentation\` on a match) → update with the FULL merged body, else \`propose_new_concept\`.

### Read tool (no approval)

- **\`read_concept_documentation({ workspaceSlug, conceptId })\`** — Returns the concept's CURRENT documentation as raw markdown only (no PRs/commits/metadata). Use this right before \`propose_concept_update\` so you can reproduce the existing body faithfully and add only what's needed.

### Write tools (require user approval)

- **\`propose_new_concept({ workspaceSlug, name, documentation, description?, repo?, rationale? })\`** — Propose creating a new concept directly from documentation YOU provide. NO codebase analysis is run — this is a fast, direct write (unlike the heavy "learn a concept from the repo" flow). Emits an approvable card; nothing is created until the user approves. \`repo\` (\`owner/repo\`) is optional and must be one of the workspace's repositories; omit it to use the primary repo.
- **\`propose_concept_update({ workspaceSlug, conceptId, documentation, rationale? })\`** — Propose replacing an existing concept's documentation. Emits an approvable card with a before/after diff. Supply the FULL new documentation body (it replaces the whole field, so include the existing content you want to keep).

### Important rules

- Always pass the \`workspaceSlug\` from the Available Workspaces list — never an opaque id.
- Concept writes go through approval; nothing is saved until the user clicks Approve.
- Before updating, read the concept's current documentation (\`read_concept_documentation\`) so your new body preserves what should stay.
- Never fabricate a \`conceptId\` — use ids returned by \`list_concepts\`.
- Keep documentation self-contained and generic enough to be useful later; lead with what the concept is and why it matters.
`;
}
