# Workspace IDOR Hardening Plan

## Background

An audit performed while reviewing the `feature/...-public-workspace-access-...`
branch surfaced **~25 pre-existing Insecure Direct Object Reference (IDOR)
vulnerabilities** in the `src/app/api/` routes — all of the form:

1. The handler authenticates the caller (via `requireAuth`, `getServerSession`,
   or `requireAuthOrApiToken`).
2. It then reads or writes workspace-scoped data keyed off a request-supplied
   `workspaceId`, `workspaceSlug`, `featureId`, `taskId`, `swarmId`, or
   `podId`.
3. It does **not** verify that the authenticated user is actually a member
   or owner of the workspace that the resource belongs to — neither
   directly (owner/member check) nor transitively (via
   `validateWorkspaceAccess` / `validateWorkspaceAccessById` /
   `validateFeatureAccess` / `resolveWorkspaceAccess`).

Net effect: any signed-in user can read, modify, or destroy data in any
other workspace whose id/slug they can discover or guess.

Five of these were introduced by PRs 1–3 of the public-workspace-access
branch and have already been fixed in PR 3.4 (commit on this branch). The
remaining findings pre-date this branch and are out of scope for the
current PR — this document captures a remediation plan so they can be
tackled in a follow-up effort.

## Guiding principles

- **Membership check must run before any DB write and before any
  credential decryption.** Several bugs below do work first and check
  access afterwards; the check has to move up.
- **Trust the server-derived workspaceId, not a body field.** When a
  request names both a `taskId` and a `workspaceId`, the `taskId` already
  implies a workspace — look it up, don't accept both independently.
- **`x-api-token` is a god token.** Keep using it for service-to-service
  calls, but only when the caller explicitly opts in. Session callers
  must always go through the membership check.
- **Return 404 "Workspace not found or access denied", not 401/403.**
  Matches the rest of the codebase's unified-error convention and avoids
  leaking workspace existence.
- **Prefer existing helpers over new code.** We have
  `resolveWorkspaceAccess` + `requireReadAccess` / `requireMemberAccess`
  (in `src/lib/auth/workspace-access.ts`) and
  `validateWorkspaceAccess` / `validateWorkspaceAccessById` (in
  `src/services/workspace.ts`). Use them.

## Remediation pattern

For routes that need to accept both session auth and `x-api-token`, the
pattern already applied to `/api/features/board`, `/api/features/[id]/chat`,
`/api/features/[id]/attachments`, `/api/features/[id]/attachments/count`,
and `/api/workspaces/[slug]/voice-signatures` is:

```ts
const apiTokenAuth =
  request.headers.get("x-api-token") === process.env.API_TOKEN;

if (apiTokenAuth) {
  const apiResult = await requireAuthOrApiToken(request, workspaceId);
  if (apiResult instanceof NextResponse) return apiResult;
  // apiResult.id = workspace owner (requireAuthOrApiToken's convention)
} else {
  const access = await resolveWorkspaceAccess(request, { workspaceId });
  if (!access || access.kind !== "member") { // or "public-viewer" ok for reads
    return NextResponse.json(
      { error: "Workspace not found or access denied" },
      { status: 404 },
    );
  }
}
```

For read-only endpoints that want public-viewer support (the workspace is
`isPublicViewable`), replace the `kind !== "member"` check with
`requireReadAccess(access)`.

For endpoints that only take session auth (no API-token escape hatch),
skip the `apiTokenAuth` branch and just call `resolveWorkspaceAccess`
directly.

## Findings

Ordered roughly by severity. Each entry lists the file, method, bug,
proof-of-exploit, and suggested fix.

---

### Critical

#### 1. `src/app/api/stakwork/create-customer/route.ts` — POST
- **Bug**: loads workspace by body-supplied `workspaceId` (line 37) with
  no membership check, then calls `stakworkService.createCustomer(...)`
  and writes `workspace.stakworkApiKey` (line 46).
- **Exploit**: signed-in non-member consumes victim workspace's
  Stakwork allocation and replaces its `stakworkApiKey` with an
  attacker-known token — full Stakwork takeover.
- **Fix**: `validateWorkspaceAccessById(workspaceId, userId)` with
  `canAdmin: true` before the customer create or the `stakworkApiKey`
  write.

#### 2. `src/app/api/pool-manager/delete-pool/route.ts` — DELETE
- **Bug**: only `getServerSession` is checked; `poolManagerService().deletePool({ name })`
  is called with a body-supplied pool name.
- **Exploit**: any signed-in user deletes any workspace's pool
  (pool name = `swarm.id`, discoverable via other routes) → full
  cross-tenant compute DoS.
- **Fix**: look up the swarm whose id matches `name`, then
  `validateWorkspaceAccessById(swarm.workspaceId, userId)` requiring
  admin. Reject otherwise.

#### 3. `src/app/api/upload/presigned-url/route.ts` — POST, GET
- **Bug (POST)**: returns a presigned upload URL scoped to the victim's
  task S3 prefix with only a task lookup (`db.task.findFirst({ where: { id: taskId } })`).
- **Bug (GET)**: returns a presigned download redirect for any
  caller-supplied `s3Key` with no workspace binding.
- **Exploit**: cross-workspace attachment / artifact / feature-image
  exfiltration (GET) and upload (POST).
- **Fix (POST)**: `validateWorkspaceAccessById(task.workspaceId, userId)`
  with `canWrite`.
- **Fix (GET)**: resolve `s3Key` → owning workspace (e.g. via
  `Attachment` / `Artifact` / `Feature` row carrying `workspaceId`),
  then require membership. Alternative: restrict to a user-specific
  prefix (e.g. `users/<userId>/*`).

#### 4. `src/app/api/livekit-token/route.ts` — POST
- **Bug**: signs a 4-hour JWT containing body-supplied `slug` which
  `src/lib/mcp/handler.ts:420` later trusts as workspace authorization,
  exposing `workspaceId`, `swarmUrl`, `swarmApiKey` to the MCP caller.
- **Exploit**: any signed-in user mints a JWT for any workspace slug and
  drives MCP actions against it.
- **Fix**: before signing, `validateWorkspaceAccess(slug, userId)` → 403
  on failure. Embed `userId` in the JWT claims and have `verifyJwt`
  re-validate membership at use time.

#### 5. `src/app/api/swarm/stakgraph/agent-stream/route.ts` — GET
- **Bug**: loads swarm by body/query `swarmId` with no membership check,
  then uses decrypted `swarmApiKey` to poll, and writes
  `db.swarm.update`, `db.environmentVariable.deleteMany/createMany`,
  `saveOrUpdateSwarm`.
- **Exploit**: signed-in non-member streams victim's stakgraph via
  victim credentials and overwrites victim's swarm env vars.
- **Fix**: `validateWorkspaceAccessById(swarm.workspaceId, userId)` with
  `canAdmin` before the poll and writes.

---

### High

#### 6. `src/app/api/tasks/create-from-transcript/route.ts` — POST
- **Bug**: loads workspace by body-supplied `workspaceSlug` with no
  membership check, then calls `createTaskWithStakworkWorkflow` (mode:
  `"live"`).
- **Exploit**: non-member creates tasks in any workspace and fires live
  Stakwork workflows against victim's swarm (burning credits); leaks the
  transcript to the victim's AI pipeline.
- **Fix**: `validateWorkspaceAccess(workspaceSlug, userId)` (or
  `resolveWorkspaceAccess` + `requireMemberAccess`) before
  `extractTaskFromTranscript` / `createTaskWithStakworkWorkflow`.

#### 7. `src/app/api/features/[featureId]/invite/route.ts` — POST
- **Bug**: loads feature + workspace (with Sphinx creds) by `featureId`
  with no membership check, then `sendToSphinx(sphinxConfig, message)`
  using victim's Sphinx bot credentials.
- **Exploit**: broadcast attacker-controlled invite messages into victim
  Sphinx channel; can name arbitrary user ids as invitees.
- **Fix**: after loading the feature,
  `validateWorkspaceAccessById(feature.workspace.id, userId)` with
  `canWrite`; also verify each `inviteeUserId` is a member of the same
  workspace.

#### 8. `src/app/api/agent/route.ts` — POST
- **Bug**: loads `db.task.findUnique({ where: { id: taskId } })` with
  no workspace membership check, then `claimPodForTask`, `db.task.update`
  (sets `podId`, `agentUrl`, `agentPassword`, `agentWebhookSecret`),
  `db.chatMessage.create`.
- **Exploit**: signed-in non-member claims a pod on victim's pool,
  overwrites task agent credentials, injects chat messages into victim
  task thread.
- **Fix**: load the task with `workspace.ownerId` + `workspace.members { where: { userId } }`
  and reject non-members. Pattern exists already on `prototype-push`.

#### 9. `src/app/api/agent/commit/route.ts` — POST
- **Bug**: body carries both `taskId` and `workspaceId` independently;
  ownership check validates `workspaceId` but `podId` comes from the
  (victim's) task.
- **Exploit**: attacker passes victim `taskId` + attacker's own
  `workspaceId`; membership check passes against attacker's workspace
  but writes to the victim's pod using attacker-supplied commit
  message/branch and attacker's GitHub App token.
- **Fix**: derive `workspaceId` from `task.workspaceId` — never trust
  two independent body fields. Or at minimum assert
  `task.workspaceId === workspaceId`.

#### 10. `src/app/api/agent/diff/route.ts` — POST
- **Bug**: identical task↔workspace decoupling to #9; calls
  `generateAndSaveDiff({ taskId, podId })` which queries the victim's
  pod and writes an assistant `ChatMessage` + `DIFF` `Artifact` onto
  the victim's task.
- **Fix**: same as #9 — tie `workspaceId` to `task.workspaceId`.

#### 11. `src/app/api/agent/branch/route.ts` — POST
- **Bug**: `generateCommitMessage(taskId, ...)` queries the task's full
  chat history and returns an AI summary, with no membership check.
- **Exploit**: any signed-in user exfiltrates any task's private chat
  history as an AI-generated summary.
- **Fix**: verify caller is owner/member of `task.workspaceId` before
  calling `generateCommitMessage`.

#### 12. `src/app/api/agent-logs/route.ts` — GET
- **Bug**: `db.agentLog.findMany({ where: { workspaceId, ... } })` and
  `fetchBlobContent(log.blobUrl)` (when `search` is supplied) with
  query-supplied `workspaceId` and no membership check.
- **Exploit**: read agent log metadata + (indirectly via `search`) blob
  contents for any workspace.
- **Fix**: `validateWorkspaceAccessById(workspaceId, userId)` with
  `canRead` before the query.

#### 13. `src/app/api/swarm/stakgraph/ingest/route.ts` — POST, GET
- **Bug**: loads swarm by `workspaceId` with no membership check; POST
  runs `db.swarm.updateMany({ ingestRequestInProgress })`,
  `db.repository.update({ status: PENDING })`, `saveOrUpdateSwarm`.
  GET reads `db.swarm.findUnique`.
- **Exploit**: DoS victim's ingest (flip repos to PENDING), trigger a
  real stakgraph ingest of victim's repos using attacker's GitHub PAT,
  exfiltrate ingest progress.
- **Fix**: `validateWorkspaceAccessById(workspaceId, userId)` — write
  for POST, read for GET.

#### 14. `src/app/api/swarm/stakgraph/services/route.ts` — GET
- **Bug**: loads swarm by body `swarmId` / `workspaceId` with no
  membership check; decrypts `swarmApiKey`, runs services agent against
  victim's repo with attacker's GitHub PAT, writes `swarm.agentRequestId`
  / `agentStatus` / `services` / `environmentVariables`.
- **Fix**: `validateWorkspaceAccessById(swarm.workspaceId, userId)`
  after loading the swarm.

#### 15. `src/app/api/swarm/stakgraph/sync/route.ts` — POST
- **Bug**: loads swarm by body `swarmId` / `workspaceId` with no
  membership check, then forces a sync, flips repo status to
  `PENDING` / `FAILED`, overwrites `swarm.ingestRefId`, registers a
  webhook callback URL pointing at an attacker-controlled host.
- **Fix**: `validateWorkspaceAccessById(swarm.workspaceId, userId)`
  with `canWrite` before the writes.

#### 16. `src/app/api/swarm/jarvis/search-by-types/route.ts` — POST
- **Bug**: `db.swarm.findFirst({ where: { workspaceId } })` with
  query-supplied `workspaceId` and no membership check; uses victim's
  decrypted `swarmApiKey` to run arbitrary graph queries.
- **Exploit**: exfiltrates victim's code-graph (functions, files,
  presigned S3 media URLs).
- **Fix**: `validateWorkspaceAccessById(workspaceId, userId)` before
  the swarm lookup.

#### 17. `src/app/api/tests/coverage/route.ts` — GET
- **Bug**: `getPrimaryRepository(workspaceId)` and then
  `db.repository.update` writing `ignoreDirs` / `unitGlob` /
  `integrationGlob` / `e2eGlob`; `db.swarm.findFirst` uses decrypted
  `swarmApiKey` — all with no membership check.
- **Exploit**: non-member overwrites victim's primary repo's test
  glob/ignore configuration (poisoning future test runs) and reads
  data through victim's decrypted API key.
- **Fix**: `validateWorkspaceAccessById(workspaceId, userId)` with
  `canWrite` before any repo update or swarm fetch.

#### 18. `src/app/api/tests/nodes/route.ts` — GET
- **Bug**: `db.repository.update` at L213-244 writes globs BEFORE the
  `validateWorkspaceAccessById` call at L277-282. The 403 fires *after*
  the writes already persisted.
- **Fix**: move `validateWorkspaceAccessById` above
  `getPrimaryRepository` and before any repo update.

#### 19. `src/app/api/pool-manager/create-pool/route.ts` — POST
- **Bug**: `saveOrUpdateSwarm({ containerFiles })` writes to the
  workspace's swarm BEFORE the owner/member check fires.
- **Exploit**: non-member persists attacker-controlled `containerFiles`
  on victim's swarm before the access check returns 403.
- **Fix**: move the ownership check immediately after
  `db.swarm.findFirst` and before any `saveOrUpdateSwarm` call.

#### 20. `src/app/api/github/app/callback/route.ts` — GET
- **Bug**: `state` is base64-encoded JSON, NOT signed. Caller-supplied
  `workspaceSlug` is trusted; `db.workspace.updateMany({ where: { slug }, data: { sourceControlOrgId } })`
  rewires the victim's workspace to an attacker-controlled
  `SourceControlOrg` (or unlinks it on `setup_action=uninstall`).
- **Exploit**: subsequent GitHub App webhooks / PR flows for the
  victim's workspace route through the attacker's org.
- **Fix**: sign `state` with `NEXTAUTH_SECRET` and verify the signature
  before trusting `workspaceSlug`; verify `session.githubState` matches
  incoming state; and require
  `validateWorkspaceAccess(workspaceSlug, userId)` with `canAdmin`
  before mutating `workspace.sourceControlOrgId`.

#### 21. `src/app/api/github/webhook/ensure/route.ts` — POST
- **Bug**: `db.repository.findUnique({ where: { id: repositoryId } })`
  with no membership check; `ensureRepoWebhook` writes
  `githubWebhookId` + `githubWebhookSecret` on the repository.
- **Exploit**: a signed-in user with their own GitHub App tokens
  authorized for the target repo's owner (e.g. a public repo) can
  overwrite a victim workspace's webhook secret, then forge webhook
  callbacks under the new attacker-known secret.
- **Fix**: `validateWorkspaceAccessById(workspaceId, userId)` with
  `canWrite` before `ensureRepoWebhook`.

#### 22. `src/app/api/workspaces/[slug]/workflows/[workflowId]/versions/route.ts` — GET
- **Bug**: fetches workspace with `members: { where: { userId } }` but
  only null-checks `workspace`, never consults
  `workspace.members.length` or `workspace.ownerId`. Then decrypts
  `swarm.swarmApiKey` and reads `workflow_version` nodes (including
  raw `workflow_json`).
- **Exploit**: any signed-in user reads workflow versions for any
  workspace slug.
- **Fix**: replace with `resolveWorkspaceAccess(request, { slug })` +
  `requireMemberAccess` (require admin since swarm creds are used).

#### 23. `src/app/api/orgs/[githubLogin]/connections/route.ts` — GET, DELETE
- **Bug**: `db.sourceControlOrg.findUnique` by path-supplied
  `githubLogin`, then `db.connection.findMany` / `db.connection.delete`
  with no membership check on any workspace under that org.
- **Exploit**: any signed-in user reads (and can delete) every
  `Connection` record (`summary`, `diagram`, `architecture`,
  `openApiSpec`) for any GitHub org login.
- **Fix**: require caller to own or be an active member of at least one
  workspace under `org.id` (pattern used in
  `orgs/[githubLogin]/workspaces/route.ts`). DELETE additionally
  requires ADMIN/OWNER.

#### 24. `src/app/api/bounty-request/route.ts` — POST
- **Bug**: only a `sourceWorkspaceSlug === "hive"` string check — no
  membership check. Then `db.task.findUnique({ select: { podId, agentPassword } })`,
  `db.chatMessage.create({ artifacts: BOUNTY })`, decrypts
  `agentPassword`.
- **Exploit**: non-member decrypts any `"hive"`-workspace task's
  `agentPassword`, injects a `BOUNTY`-artifact chat message (broadcast
  via Pusher), records attacker as `sourceUserId`.
- **Fix**: `validateWorkspaceAccessById(task.workspaceId, userId)`
  with `canWrite`; tighten or remove the hard-coded slug check.

#### 25. `src/app/api/upload/image/route.ts` — POST
- **Bug**: `db.feature.findFirst({ where: { id: featureId } })` with
  no membership check; returns a 1-year presigned GET under
  `features/${workspaceId}/${swarmId}/${featureId}/...` and a
  presigned PUT.
- **Exploit**: any signed-in user obtains long-lived download URLs for
  any other workspace's feature images and can upload images into
  victim's S3 prefix.
- **Fix**: `validateWorkspaceAccessById(feature.workspaceId, userId)`
  with `canWrite` before issuing any presigned URL.

---

### Medium

#### 26. `src/app/api/swarm/stakgraph/status/route.ts` — GET
- **Bug**: when no Bearer is supplied, only `getServerSession` is
  checked; `db.swarm.findFirst` by query-supplied
  `swarmId` / `workspaceId` and reads stakgraph status using decrypted
  `swarmApiKey`.
- **Fix**: in the session branch,
  `validateWorkspaceAccessById(swarm.workspaceId, userId)` after
  loading the swarm.

#### 27. `src/app/api/features/[featureId]/presence/route.ts` — POST
- **Bug**: `pusherServer.trigger(getFeatureChannelName(featureId), PLAN_USER_JOIN/LEAVE, ...)`
  with no membership check.
- **Exploit**: non-member spoofs collaborator presence on any feature's
  realtime channel; leaks session identity into private workspace
  channels.
- **Fix**: resolve `feature.workspaceId` then
  `resolveWorkspaceAccess(request, { workspaceId })` +
  `requireMemberAccess`.

#### 28. `src/app/api/github/app/install/route.ts` — POST
- **Bug**: no membership check on `workspaceSlug` from body; reads
  install metadata (`githubInstallationId`) for any workspace and
  mints a state bound to the victim workspace.
- **Fix**: `validateWorkspaceAccess(workspaceSlug, userId)` with
  `canAdmin` before generating state or returning install info.

#### 29. `src/app/api/github/pr-metrics/route.ts` — GET
- **Bug**: `db.artifact.findMany({ where: { message: { task: { workspaceId } } } })`
  with query-supplied `workspaceId` and no membership check.
- **Exploit**: read PR metrics (PR count, merged count, success rate,
  time-to-merge) for any workspace.
- **Fix**: `validateWorkspaceAccessById(workspaceId, userId)` before
  the query.

#### 30. `src/app/api/orgs/[githubLogin]/schematic/route.ts` — GET, PUT
- **Bug**: `db.sourceControlOrg.findUnique({ where: { githubLogin }, select: { schematic } })`
  on GET, `db.sourceControlOrg.update(... { schematic })` on PUT — no
  membership check.
- **Exploit**: any signed-in user reads or overwrites any org's
  `schematic`.
- **Fix**: same pattern as #23; admin required for PUT.

---

### Shared-secret ("god token") endpoints

These don't fit the signed-in-user IDOR pattern strictly — they accept a
single global `API_TOKEN` and then mutate any workspace's data by id.
Any breach of the token (or any internal caller granted it) grants
cross-tenant write access. Worth hardening in the same sweep.

#### S1. `src/app/api/features/[featureId]/title/route.ts` — PUT
- `x-api-token` only → `db.feature.update({ where: { id: featureId }, data: { title } })`
  + Pusher broadcast.

#### S2. `src/app/api/tasks/[taskId]/title/route.ts` — PUT
- Same shape — `db.task.update({ where: { id: taskId }, data: { title } })`.

#### S3. `src/app/api/tasks/[taskId]/webhook/route.ts` — PUT
- `db.task.update({ where: { id: taskId }, data: { branch, summary } })`
  — can poison PR metadata / redirect CI branches.

**Fix (all three)**: replace the shared global token with a
per-workspace or per-swarm token stored on the workspace/swarm row, OR
require session auth + workspace admin.

## Suggested rollout

1. **Phase A — critical handlers (#1–5)**: single focused PR. Include
   integration tests that sign in as a non-member and assert 403/404.
2. **Phase B — high-severity (#6–25)**: group by area (agent, swarm,
   github, upload, misc). 3–4 follow-up PRs. Consider factoring the
   `apiTokenAuth ? requireAuthOrApiToken(...) : resolveWorkspaceAccess(...)`
   pattern into a shared helper to keep new handlers honest.
3. **Phase C — medium (#26–30)**: one cleanup PR.
4. **Phase D — shared-secret endpoints (S1–S3)**: design work on
   per-resource tokens, then migrate webhooks to the new scheme.

For each PR:
- Add a targeted integration test per fixed handler: sign in as a
  non-member, hit the endpoint against a victim workspace, assert the
  expected error response.
- Grep for the handler's response shape in the UI before changing it —
  the unified 404 convention is good, but some clients may still expect
  401/403 and need updating.

## Related prior work

- `feature/...-public-workspace-access-...` PR 3.3:
  [`src/app/api/features/[featureId]/route.ts`](../../src/app/api/features/[featureId]/route.ts)
  — feature detail GET.
- `feature/...-public-workspace-access-...` PR 3.4:
  [`src/app/api/features/board/route.ts`](../../src/app/api/features/board/route.ts),
  [`src/app/api/features/[featureId]/chat/route.ts`](../../src/app/api/features/[featureId]/chat/route.ts),
  [`src/app/api/features/[featureId]/attachments/route.ts`](../../src/app/api/features/[featureId]/attachments/route.ts),
  [`src/app/api/features/[featureId]/attachments/count/route.ts`](../../src/app/api/features/[featureId]/attachments/count/route.ts),
  [`src/app/api/workspaces/[slug]/voice-signatures/route.ts`](../../src/app/api/workspaces/[slug]/voice-signatures/route.ts)
  — the five regressions introduced by PRs 1–3 of this branch.

### also

Public viewers get **7-day presigned S3 URLs** on feature attachments... make that 1 hour for unauthenticated users

### also

cut down jarvis/nodes calls, it will crash swarm