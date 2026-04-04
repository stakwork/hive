## Overview
Add `@workspace-slug` mention resolution to the diagram create and edit routes by calling the existing `resolveExtraSwarms` utility and forwarding the result as `subAgents` into `repoAgent`.

## Mock Data Requirements
No mock data required — no new models or data structures introduced; mentions resolve against existing workspace/swarm/repository records.

## Mock Endpoint Requirements
No mock endpoints required — `repoAgent` is already mocked in the existing test suite via `vi.mock("@/lib/ai/askTools")`.

## Changes Required

### 1. `src/app/api/learnings/diagrams/create/route.ts`
- Add import: `import { resolveExtraSwarms } from "@/services/roadmap/feature-chat";`
- After the GitHub PAT check, call:
  ```ts
  const subAgents = await resolveExtraSwarms(prompt, userOrResponse.id);
  ```
- Add `subAgents` (spread conditionally — only when non-empty, or pass directly since `repoAgent` accepts `undefined`) to the existing `repoAgent` call:
  ```ts
  subAgents: subAgents.length ? subAgents : undefined,
  ```

### 2. `src/app/api/learnings/diagrams/edit/route.ts`
- Same import and pattern as above.
- Call `resolveExtraSwarms(prompt, userOrResponse.id)` (use the **raw** `prompt`, before it gets wrapped in the `<current-diagram>` augmented string — mentions live in the user-facing prompt).
- Pass `subAgents` into the existing `repoAgent` call the same way.

### 3. `src/__tests__/integration/api/learnings/diagrams/create.test.ts`
- Add a test: `"should pass resolved subAgents to repoAgent when prompt contains @mentions"`.
- Set up a second workspace with a swarm + repository, add the owner as a member.
- Send a prompt containing `@<second-workspace-slug>`.
- Assert `vi.mocked(repoAgent).mock.calls[0][2].subAgents` contains one entry matching the second workspace's swarm URL and repo URL.
- Add a test: `"should call repoAgent without subAgents when mentions don't match any accessible workspace"`.

### 4. `src/__tests__/integration/api/learnings/diagrams/edit.test.ts`
- Same two new test cases mirroring the create tests above.

## Testing Considerations
- No new fixtures needed — reuse `createTestWorkspaceScenario`, `createTestSwarm`, `createTestRepository`, and the existing `EncryptionService` pattern already present in both test files.
- `resolveExtraSwarms` silently skips unresolvable slugs — tests for inaccessible workspaces should assert `subAgents` is `undefined` or empty, not an error response.