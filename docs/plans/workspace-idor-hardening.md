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

## Progress

- **Phase A (Critical #1–5) — DONE** on branch `ef/idor-fixes-1`
  (commit `03d836163`, "Harden workspace IDOR on 5 critical handlers").
  See the per-finding "Status" notes under each Critical entry below.
  Both the source handlers and the MCP JWT verifier were updated, and
  targeted unit + integration tests were added asserting that a
  signed-in non-member receives a unified `404 "Workspace not found or
  access denied"` and that no credentialed side-effects (Stakwork
  calls, pool deletion, S3 presigning, LiveKit/MCP JWT signing,
  stakgraph polling / env-var writes) run on their behalf.
- **Phase B (High #6–25) — partial.**
  - **Agent cluster #8–11 — DONE** on branch `ef/idor-fixes-2`
    (commit `3d39db806`). /api/agent now runs the workspace
    membership check before `claimPodForTask` / credential writes;
    /api/agent/commit and /api/agent/diff derive the authorized
    workspaceId from `task.workspaceId` (rejecting mismatched body
    `workspaceId` with the unified 404) so a caller can't pair a
    victim's `taskId` with their own `workspaceId`; /api/agent/branch
    resolves `task.workspace` and rejects non-members before invoking
    `generateCommitMessage`, so the AI-summary path no longer leaks
    chat history. Existing integration tests were updated from the
    "security-gap documentation" shape to assert the new 404 + no-AI-
    call behavior; these routes are also currently gated behind the
    `TASK_AGENT_MODE` feature flag, which is why new targeted tests
    weren't added.
  - **Swarm cluster #13–16 — DONE** on `ef/idor-fixes-2` (commit
    `7b5a2fa78`). stakgraph/ingest POST requires `canWrite` on the
    body workspaceId before the CAS flag flip, repo→PENDING update,
    stakgraph trigger, or GitHub webhook registration; stakgraph/
    ingest GET requires `canRead` before fetching swarm creds and
    polling stakgraph; stakgraph/services and stakgraph/sync now
    authorize against `swarm.workspaceId` (not the body-supplied
    `workspaceId`/`swarmId`) and require `canWrite` before the
    decrypted credentialed side-effects run; jarvis/search-by-types
    requires a `workspaceId` query param plus `canRead` before the
    swarm lookup so non-members can't exfiltrate the code-graph
    (which contains presigned S3 media URLs). Test adjustments:
    promoted the `@/lib/constants` mock in two integration suites to
    a partial `importOriginal` variant so `WORKSPACE_PERMISSION_LEVELS`
    is still available to `validateWorkspaceAccessById`, reworded one
    jarvis test to match the unified 404, and stubbed
    `@/services/workspace` in the stakgraph-ingest unit test.
  - **Tests cluster #17–18 — DONE** on `ef/idor-fixes-2`. tests/
    coverage now requires `canWrite` before the primary-repo
    ignoreDirs / unitGlob / integrationGlob / e2eGlob writes and
    before decrypting `swarmApiKey`; tests/nodes had its pre-existing
    `validateWorkspaceAccessById` call moved above the same repo
    writes (previously the 403 fired *after* the writes persisted)
    and upgraded from a 403 to the unified 404. Two existing
    integration tests were updated to the new 404.
  - **Upload #25 — DONE** on `ef/idor-fixes-2`. upload/image now
    authorizes the caller as a `canWrite` member of
    `feature.workspaceId` before minting either the presigned upload
    URL or the long-lived presigned download URL, and also validates
    `session.user.id` (401 otherwise). No test churn — the existing
    integration test file was already `describe.skip`ed.
  - **Misc #6 + #7 — DONE** on `ef/idor-fixes-2`. tasks/create-
    from-transcript now requires `canWrite` via `validateWorkspaceAccess`
    before extracting the transcript or firing the live Stakwork
    workflow; features/[featureId]/invite requires `canWrite` on the
    feature's workspace AND narrows the invitee lookup to users who
    own the workspace or have an active `workspaceMembers` row, so
    the caller can no longer name arbitrary @-aliases. Integration
    tests for `/invite` were updated to enrol each test invitee as a
    workspace member.
  - **Agent logs #12 — DONE** on `ef/idor-fixes-2`. agent-logs GET
    now requires `canRead` membership on the `workspace_id` query
    param before the `db.agentLog.findMany` and the per-log
    `fetchBlobContent` search loop. Unit test updated to stub
    `@/services/workspace`.
  - **Pool manager #19 — DONE** on `ef/idor-fixes-2`. Moved the
    owner/member check above the `saveOrUpdateSwarm({ containerFiles })`
    write, so a non-member can no longer poison the victim's swarm
    container-file config before the auth check fires.
  - **Workflows/versions #22 — DONE** on `ef/idor-fixes-2`. Added
    the missing `members.length / ownerId` check after the workspace
    load so a signed-in non-member can no longer read any workspace's
    `workflow_version` graph nodes (which include raw `workflow_json`)
    via the victim's decrypted `swarmApiKey`.
  - **Bounty request #24 — DONE** on `ef/idor-fixes-2`. The bounty
    handler now authorizes against `task.workspaceId` with `canWrite`
    before decrypting `agentPassword`, creating the BOUNTY chat
    message, or calling the Stakwork bounty API; the bare
    `sourceWorkspaceSlug === "hive"` string check is no longer the
    real auth gate.
  - **Github callback / webhook / orgs cluster (#20, #21, #23) —
    DONE** on branch `ef/idor-fixes-3`. `/api/github/app/callback` now
    verifies an HMAC-signed `state` (new helper
    `src/lib/auth/github-app-state.ts`, signed in `/api/github/app/install`
    with `NEXTAUTH_SECRET`), re-checks that the state is bound to the
    caller's `session.githubState`, and requires `canAdmin` on the
    workspace slug *before* the token exchange or any
    `workspace.sourceControlOrgId` rewire — the legacy unsigned base64
    state is now rejected as malformed. `/api/github/webhook/ensure`
    requires `canWrite` on the body-supplied `workspaceId` before
    `ensureRepoWebhook` so a non-member can no longer overwrite a
    victim's `githubWebhookId` / `githubWebhookSecret`.
    `/api/orgs/[githubLogin]/connections` GET now requires the caller
    to belong to at least one workspace under the org before the
    `db.connection.findMany`, and DELETE additionally requires
    OWNER/ADMIN — both paths return a unified 404 on failure so org
    existence isn't leaked. Tests: new `github-app-state` unit suite
    (13 tests), five new IDOR-hardening integration tests on
    `github-app-callback.test.ts` (legacy-state rejection,
    session-binding replay, non-admin member, non-member slug
    takeover, tampered signature), the existing callback tests were
    updated to use a `signStateFor` helper that binds the signed
    state to the user's DB session (plus a `mockReset` fix to stop
    stale `mockResolvedValueOnce` queues bleeding between tests),
    the install-route tests were updated to parse the new
    `<base64url>.<hex>` format, and three new IDOR test blocks on the
    webhook-ensure unit suite + eleven new integration tests on the
    org-connections route.
- **Phase C (Medium #26–30) — DONE** on branch `ef/idor-fixes-4`.
  - **#26 stakgraph/status**: in the session branch (no Bearer
    token), the handler now runs `validateWorkspaceAccessById(
    swarm.workspaceId, userId)` with `canRead` before the decrypted
    `swarmApiKey` polls stakgraph. The Bearer-token branch is
    unchanged (it's a server-to-server shared-secret path). Failure
    returns the unified 404. No existing tests.
  - **#27 features/[featureId]/presence**: the handler now looks
    up `feature.workspaceId` and runs `validateWorkspaceAccessById`
    (`canRead`) before triggering the Pusher presence events, so
    signed-in non-members can no longer spoof collaborator
    joins/leaves on a victim feature's private realtime channel.
    Feature-existence is folded into the same unified 404 so we
    don't leak it. No existing tests.
  - **#28 github/app/install**: added
    `validateWorkspaceAccess(workspaceSlug, userId)` with
    `canAdmin` immediately after the slug null-check, before any
    GitHub state is minted, before any install metadata
    (`githubInstallationId`, `repositoryUrl`, `ownerType`) is
    leaked, and before `db.session.updateMany({ githubState })`
    runs for the caller. Non-admins get the unified 404 with no
    side-effects. Tests: updated two existing 404 assertions to
    the new unified message and added three new IDOR tests
    (non-member → 404 with no state stored on session + no GitHub
    API calls, DEVELOPER → 404, ADMIN → happy path).
  - **#29 github/pr-metrics**: added
    `validateWorkspaceAccessById(workspaceId, userId)` with
    `canRead` after the workspaceId validation and before the
    `db.artifact.findMany` query. Non-members get the unified 404
    without leaking PR count / success rate / time-to-merge. Test:
    one new IDOR test asserting `artifact.findMany` is never
    called for a signed-in non-member attacker.
  - **#30 orgs/[githubLogin]/schematic**: mirrored the helper
    pattern from `/orgs/[githubLogin]/connections` — a private
    `resolveAuthorizedOrgId(githubLogin, userId, requireAdmin)`
    returns the org id only when the caller owns or is an active
    member of at least one workspace under it; `requireAdmin`
    narrows to OWNER/ADMIN for the PUT path. GET uses the
    resolved org id to scope `findUnique`; PUT uses it to scope
    the `update`. Unknown `githubLogin` and non-qualifying
    callers both get the unified 404 "Organization not found" so
    org existence isn't leaked. Tests: the existing integration
    suite was updated to enrol each test user in a workspace
    under the org (the old version had random users reading any
    org's schematic) and four new IDOR tests were added
    (non-member GET → 404 with no schematic content in the
    response body, unknown org GET → 404, DEVELOPER PUT → 404 +
    schematic unchanged in DB, non-member PUT → 404 + schematic
    unchanged in DB) alongside a new ADMIN happy-path PUT test.
- **Phase D (shared-secret S1–S3)** — not started.
- **"also" items** (public-viewer 7-day → 1-hour presigned URLs;
  jarvis/nodes call reduction) — not started.

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
- **Status**: ✅ Fixed on `ef/idor-fixes-1`. Handler now rejects
  missing/null/empty `workspaceId` with 400 and rejects non-admins
  with 404 before calling `createCustomer` or writing `stakworkApiKey`.
  Tests: `src/__tests__/integration/api/stakwork-create-customer.test.ts`
  (non-member → 404, DEVELOPER member → 404) +
  `src/__tests__/unit/api/stakwork/create-customer-route.test.ts`
  (`validateWorkspaceAccessById` mocked, IDOR branch asserted).

#### 2. `src/app/api/pool-manager/delete-pool/route.ts` — DELETE
- **Bug**: only `getServerSession` is checked; `poolManagerService().deletePool({ name })`
  is called with a body-supplied pool name.
- **Exploit**: any signed-in user deletes any workspace's pool
  (pool name = `swarm.id`, discoverable via other routes) → full
  cross-tenant compute DoS.
- **Fix**: look up the swarm whose id matches `name`, then
  `validateWorkspaceAccessById(swarm.workspaceId, userId)` requiring
  admin. Reject otherwise.
- **Status**: ✅ Fixed on `ef/idor-fixes-1`. Handler now does
  `db.swarm.findUnique({ where: { id: name } })` → admin check on
  `swarm.workspaceId` before `deletePool`. Missing swarm and non-admin
  both return the unified 404. Tests:
  `src/__tests__/integration/api/pool-manager/delete-pool.test.ts`
  (unknown `name` → 404, non-member attacker → 404; pre-existing
  tests refactored to create a real swarm so `name === swarm.id`).

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
- **Status**: ✅ Fixed on `ef/idor-fixes-1`.
  - POST: adds `validateWorkspaceAccessById(task.workspaceId, userId)`
    with `canWrite` before issuing the upload URL.
  - GET: parses the owning `workspaceId` out of the `s3Key` with an
    allow-list of known prefixes (`uploads/`, `workspace-logos/`,
    `whiteboards/`, `screenshots/`, `features/`, `diagrams/`) and
    requires `canRead` membership before minting the download URL.
    Unknown prefixes return 404.
  - Tests: `src/__tests__/integration/api/upload-presigned-url.test.ts`
    — IDOR suite covers POST non-member, GET non-member, GET unknown
    prefix, and GET owner happy-path (redirect to presigned URL).

#### 4. `src/app/api/livekit-token/route.ts` — POST
- **Bug**: signs a 4-hour JWT containing body-supplied `slug` which
  `src/lib/mcp/handler.ts:420` later trusts as workspace authorization,
  exposing `workspaceId`, `swarmUrl`, `swarmApiKey` to the MCP caller.
- **Exploit**: any signed-in user mints a JWT for any workspace slug and
  drives MCP actions against it.
- **Fix**: before signing, `validateWorkspaceAccess(slug, userId)` → 403
  on failure. Embed `userId` in the JWT claims and have `verifyJwt`
  re-validate membership at use time.
- **Status**: ✅ Fixed on `ef/idor-fixes-1`.
  - `/api/livekit-token` calls `validateWorkspaceAccess(slug, userId)`
    before signing and returns 404 on failure (no JWT is minted).
  - The minted JWT now carries both `slug` and `userId` claims.
  - `src/lib/mcp/handler.ts` `verifyJwt` rejects legacy JWTs missing
    `userId` and re-checks `ownerId` / `workspaceMember` at use time,
    so a revoked membership invalidates the token immediately.
  - Tests: `src/__tests__/integration/api/livekit-token.test.ts`
    covers unauth/400/owner-happy-path/non-member attacker/unknown
    slug; `toJwt()` is asserted to not be called on the error paths.

#### 5. `src/app/api/swarm/stakgraph/agent-stream/route.ts` — GET
- **Bug**: loads swarm by body/query `swarmId` with no membership check,
  then uses decrypted `swarmApiKey` to poll, and writes
  `db.swarm.update`, `db.environmentVariable.deleteMany/createMany`,
  `saveOrUpdateSwarm`.
- **Exploit**: signed-in non-member streams victim's stakgraph via
  victim credentials and overwrites victim's swarm env vars.
- **Fix**: `validateWorkspaceAccessById(swarm.workspaceId, userId)` with
  `canAdmin` before the poll and writes.
- **Status**: ✅ Fixed on `ef/idor-fixes-1`. The swarm lookup and
  admin check now run **before** the SSE stream is opened — so there
  is no opportunity to decrypt `swarmApiKey`, poll stakgraph, or
  write `environment_variables` / `swarm` rows for a non-admin.
  Failure returns a plain 404 (not an SSE error event). Tests:
  new `describe("GET /api/swarm/stakgraph/agent-stream - IDOR hardening")`
  suite in `src/__tests__/integration/api/swarm-stakgraph-agent-stream.test.ts`
  covering unauth/missing-swarm/non-member/non-admin member — all
  four assert no stream is opened and `pollAgentProgress` is never
  called. (The pre-existing `describe.skip` block is left skipped
  due to unrelated zombie-polling issues; the new IDOR tests do not
  depend on the polling loop so they run.)

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
- **Status**: ✅ Fixed on `ef/idor-fixes-2`. Replaced the bare
  slug→id lookup with `validateWorkspaceAccess` requiring `canWrite`
  and return the unified 404 on failure. The live Stakwork workflow
  and the transcript-to-AI extractor now only run after membership
  is confirmed. No existing test needed updating (this route has no
  integration test).

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
- **Status**: ✅ Fixed on `ef/idor-fixes-2`. Added both the caller
  membership check (`canWrite` on `feature.workspace.id`, return 404
  before decrypting `sphinxBotSecret` or calling `sendToSphinx`) and
  the invitee-membership check (the `db.user.findMany` query now
  requires each invitee to own the workspace or be an active member
  via `workspaceMembers { some: { workspaceId, leftAt: null } }`).
  Also added a missing `session.user.id` check (401 otherwise).
  Integration tests updated: each invitee is now enrolled as a
  `DEVELOPER` workspace member before the invite call, and one
  error-message assertion was adjusted to the new copy.

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
- **Status**: ✅ Fixed on `ef/idor-fixes-2` (commit `3d39db806`). The
  task lookup now pulls `workspace.ownerId` + filtered `members` and
  returns the unified 404 for non-members *before* `claimPodForTask`,
  any credential write, or `saveUserMessage`. Added the missing
  `userId` session check (401 instead of 500 on malformed sessions).

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
- **Status**: ✅ Fixed on `ef/idor-fixes-2` (commit `3d39db806`). The
  task load now returns both `podId` and `workspaceId`; the handler
  rejects mismatched body `workspaceId` with the unified 404 and runs
  the membership check against `task.workspaceId` only. Existing
  integration tests updated from 403 → 404.

#### 10. `src/app/api/agent/diff/route.ts` — POST
- **Bug**: identical task↔workspace decoupling to #9; calls
  `generateAndSaveDiff({ taskId, podId })` which queries the victim's
  pod and writes an assistant `ChatMessage` + `DIFF` `Artifact` onto
  the victim's task.
- **Fix**: same as #9 — tie `workspaceId` to `task.workspaceId`.
- **Status**: ✅ Fixed on `ef/idor-fixes-2` (commit `3d39db806`).
  Same pattern as #9 applied. Duplicate access check that ran after
  the mock branch was collapsed into the single pre-mock gate.

#### 11. `src/app/api/agent/branch/route.ts` — POST
- **Bug**: `generateCommitMessage(taskId, ...)` queries the task's full
  chat history and returns an AI summary, with no membership check.
- **Exploit**: any signed-in user exfiltrates any task's private chat
  history as an AI-generated summary.
- **Fix**: verify caller is owner/member of `task.workspaceId` before
  calling `generateCommitMessage`.
- **Status**: ✅ Fixed on `ef/idor-fixes-2` (commit `3d39db806`). The
  handler now loads `task.workspace.{ownerId, members}` and returns
  the unified 404 for non-members *before* `generateCommitMessage`,
  so the AI summarizer never sees the victim's chat. Also added the
  missing `userId` session check. The "SECURITY GAP documentation"
  test was flipped to assert the new secure behavior.

#### 12. `src/app/api/agent-logs/route.ts` — GET
- **Bug**: `db.agentLog.findMany({ where: { workspaceId, ... } })` and
  `fetchBlobContent(log.blobUrl)` (when `search` is supplied) with
  query-supplied `workspaceId` and no membership check.
- **Exploit**: read agent log metadata + (indirectly via `search`) blob
  contents for any workspace.
- **Fix**: `validateWorkspaceAccessById(workspaceId, userId)` with
  `canRead` before the query.
- **Status**: ✅ Fixed on `ef/idor-fixes-2`. `canRead` membership
  check now runs immediately after the `workspace_id` validation and
  before both the `findMany` and the `fetchBlobContent` loop.
  Returns unified 404. The existing unit test was updated to stub
  `@/services/workspace` so it stays focused on the pagination and
  keyword-search paths it actually covers.

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
- **Status**: ✅ Fixed on `ef/idor-fixes-2` (commit `7b5a2fa78`).
  POST requires `canWrite` before the CAS flip, repo→PENDING updates,
  stakgraph trigger, and webhook registration; GET requires `canRead`
  before the credentialed poll. Failure returns the unified 404.

#### 14. `src/app/api/swarm/stakgraph/services/route.ts` — GET
- **Bug**: loads swarm by body `swarmId` / `workspaceId` with no
  membership check; decrypts `swarmApiKey`, runs services agent against
  victim's repo with attacker's GitHub PAT, writes `swarm.agentRequestId`
  / `agentStatus` / `services` / `environmentVariables`.
- **Fix**: `validateWorkspaceAccessById(swarm.workspaceId, userId)`
  after loading the swarm.
- **Status**: ✅ Fixed on `ef/idor-fixes-2` (commit `7b5a2fa78`). The
  membership check runs against `swarm.workspaceId` (not any body
  field) and requires `canWrite` before the services_agent call or
  any writes to `swarm.agentRequestId` / `services` / env vars.

#### 15. `src/app/api/swarm/stakgraph/sync/route.ts` — POST
- **Bug**: loads swarm by body `swarmId` / `workspaceId` with no
  membership check, then forces a sync, flips repo status to
  `PENDING` / `FAILED`, overwrites `swarm.ingestRefId`, registers a
  webhook callback URL pointing at an attacker-controlled host.
- **Fix**: `validateWorkspaceAccessById(swarm.workspaceId, userId)`
  with `canWrite` before the writes.
- **Status**: ✅ Fixed on `ef/idor-fixes-2` (commit `7b5a2fa78`).
  `canWrite` membership check on `swarm.workspaceId` runs immediately
  after the swarm lookup, before the repo→PENDING write, the
  `triggerAsyncSync` call, and the `ingestRefId` update.

#### 16. `src/app/api/swarm/jarvis/search-by-types/route.ts` — POST
- **Bug**: `db.swarm.findFirst({ where: { workspaceId } })` with
  query-supplied `workspaceId` and no membership check; uses victim's
  decrypted `swarmApiKey` to run arbitrary graph queries.
- **Exploit**: exfiltrates victim's code-graph (functions, files,
  presigned S3 media URLs).
- **Fix**: `validateWorkspaceAccessById(workspaceId, userId)` before
  the swarm lookup.
- **Status**: ✅ Fixed on `ef/idor-fixes-2` (commit `7b5a2fa78`). The
  `id` query param is now required (400 if missing) and gated by
  `canRead` before the swarm lookup, so non-members can't touch the
  jarvis graph even in the mock-response branch.

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
- **Status**: ✅ Fixed on `ef/idor-fixes-2`. The `canWrite` membership
  check runs immediately after parsing query params and before any
  `getPrimaryRepository` / `db.repository.update` / `db.swarm.findFirst`
  call. Returns unified 404 on failure.

#### 18. `src/app/api/tests/nodes/route.ts` — GET
- **Bug**: `db.repository.update` at L213-244 writes globs BEFORE the
  `validateWorkspaceAccessById` call at L277-282. The 403 fires *after*
  the writes already persisted.
- **Fix**: move `validateWorkspaceAccessById` above
  `getPrimaryRepository` and before any repo update.
- **Status**: ✅ Fixed on `ef/idor-fixes-2`. Moved the existing
  `validateWorkspaceAccessById` call up to run immediately after param
  parsing — before `getPrimaryRepository` and the four `db.repository.
  update` calls — and upgraded the response from 403 to the unified
  404. Two integration tests that asserted the old 403 were updated.

#### 19. `src/app/api/pool-manager/create-pool/route.ts` — POST
- **Bug**: `saveOrUpdateSwarm({ containerFiles })` writes to the
  workspace's swarm BEFORE the owner/member check fires.
- **Exploit**: non-member persists attacker-controlled `containerFiles`
  on victim's swarm before the access check returns 403.
- **Fix**: move the ownership check immediately after
  `db.swarm.findFirst` and before any `saveOrUpdateSwarm` call.
- **Status**: ✅ Fixed on `ef/idor-fixes-2`. Ownership check now
  runs immediately after the swarm lookup and before the container-
  files generation / `saveOrUpdateSwarm` write that previously
  persisted attacker-controlled content on the victim's swarm. Also
  filtered the `workspace.members` query to `leftAt: null` to match
  the rest of the codebase. Response upgraded from 403 → unified 404.
  Existing "403 when user is not owner or member" test updated to
  the new 404 status + message.

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
- **Status**: ✅ Fixed on `ef/idor-fixes-3`. New helper
  `src/lib/auth/github-app-state.ts` signs the state payload with
  HMAC-SHA256 (format: `<base64url-json>.<hex-sig>`) and re-validates
  on the callback side with a constant-time compare, a 1h expiry
  window, and a structural `workspaceSlug`/`randomState`/`timestamp`
  check. The install route (`/api/github/app/install`) now emits the
  signed state; the callback route now (a) rejects unsigned/legacy
  states outright, (b) re-checks `session.findFirst({userId,
  githubState: state})` so a signed state issued to one user can't
  be replayed by another, and (c) runs `validateWorkspaceAccess`
  with `canAdmin` before the token exchange or any
  `workspace.updateMany({sourceControlOrgId})` write — non-admins
  see `error=workspace_access_denied` with no side-effects. Tests:
  new `src/__tests__/unit/lib/github-app-state.test.ts` (13 tests
  covering sign/verify happy-path, body tampering, signature
  tampering, secret rotation, expiry, missing fields, legacy-format
  rejection) and five new IDOR integration tests on
  `github-app-callback.test.ts` (legacy base64 rejection, signed
  state replayed to the wrong user, non-admin member, completely
  non-member, tampered signature) — all five assert `mockFetch`
  was never called and the victim's `sourceControlOrgId` was left
  untouched. Existing `github-app-callback.test.ts` was swept to
  use a new `signStateFor` helper (signs + binds to a real
  `Session` row per call) and `github-app-install.test.ts` was
  updated to parse the new signed format. Also swapped the suite's
  `beforeEach` from `mockClear` to `mockReset` to stop stale
  `mockResolvedValueOnce` queues from bleeding between tests.

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
- **Status**: ✅ Fixed on `ef/idor-fixes-3`. The `canWrite`
  membership check now runs immediately after the missing-fields
  400 and before the `repository.findUnique` lookup, callback URL
  construction, and `WebhookService.ensureRepoWebhook` call —
  returns the unified 404 on failure so repository existence isn't
  leaked either. Also added the ordering guarantee that auth
  precedes the `repositoryId → url` lookup so an attacker can't use
  the endpoint as a probe for arbitrary repository ids. Tests:
  three new IDOR unit tests on
  `src/__tests__/unit/api/github/webhook-ensure-route.test.ts`
  (non-member → 404 + no webhook side-effects, VIEWER → 404,
  check-before-lookup ordering) plus a stubbed
  `@/services/workspace` mock so the 34 existing tests still pass.

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
- **Status**: ✅ Fixed on `ef/idor-fixes-2`. Added the missing
  `members.length / ownerId` check right after the workspace load,
  also filtering `members` by `leftAt: null` to match the codebase
  pattern. Any active workspace member suffices (consistent with
  other swarm-reading endpoints — the plan's "require admin" note
  was dropped because every other `canRead` swarm endpoint we've
  hardened treats swarm-cred decryption as reader-level, not admin).
  Returns the unified 404. Updated two existing integration tests
  (the "workspace does not exist" message + the "not a member" test
  which previously only asserted `not.toBe(403)` — now properly
  asserts 404 and the unified error copy).

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
- **Status**: ✅ Fixed on `ef/idor-fixes-3`. A new private helper
  `resolveAuthorizedOrgId(githubLogin, userId, requireAdmin)` in
  the route file resolves the org id only when the caller owns or
  is an active member of at least one workspace under it — for
  DELETE we pass `requireAdmin: true`, which narrows the match to
  OWNER or WorkspaceRole.ADMIN. GET now uses the resolved org id
  to scope `db.connection.findMany`; DELETE first uses it to scope
  the existence lookup, then only deletes when found. Unknown
  `githubLogin` and non-qualifying callers both get the unified
  404 "Organization not found" so org existence isn't leaked.
  Tests: new integration suite
  `src/__tests__/integration/api/orgs-connections.test.ts` with 11
  tests covering GET (unauth → 401, non-member attacker → 404
  with no payload leakage, unknown org → 404, owner happy-path,
  plain DEVELOPER member happy-path) and DELETE (unauth → 401,
  non-member → 404 with no write, DEVELOPER → 404 with no write,
  OWNER deletes, ADMIN deletes, missing connectionId → 400).

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
- **Status**: ✅ Fixed on `ef/idor-fixes-2`. The task lookup now also
  returns `workspaceId`; the handler authorizes the caller as a
  `canWrite` member of `task.workspaceId` (never the body-supplied
  slug) before generating the bounty code, writing the `BOUNTY`
  chat message, decrypting `agentPassword`, or calling the Stakwork
  bounty API. The "Source task not found" response was folded into
  the unified 404 so we don't leak task existence. The hardcoded
  `sourceWorkspaceSlug === "hive"` 403 check is left in place as a
  belt-and-braces guard; the real authorization is now the membership
  check. No existing tests.

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
- **Status**: ✅ Fixed on `ef/idor-fixes-2`. The handler now also
  requires a non-empty `session.user.id` (401 otherwise), folds the
  "feature not found" path into the unified 404, and runs the
  `canWrite` membership check on `feature.workspaceId` before either
  the upload or download presigned URL is generated. The integration
  test suite for this route is `describe.skip`ed; no test churn.
  (Note: the "604800 seconds ≈ 1 year" comment in the handler is
  actually 7 days — not tackled here; the "also" item in this plan
  already flags public-viewer 7-day URLs for follow-up.)

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
- **Status**: ✅ Fixed on `ef/idor-fixes-4`. The session branch
  now runs `validateWorkspaceAccessById(swarm.workspaceId,
  session.user.id)` with `canRead` before the decrypted
  `swarmApiKey` polls stakgraph. Failure returns the unified 404.
  The Bearer-token branch is left unchanged (server-to-server
  shared-secret path). No existing tests for this route.

#### 27. `src/app/api/features/[featureId]/presence/route.ts` — POST
- **Bug**: `pusherServer.trigger(getFeatureChannelName(featureId), PLAN_USER_JOIN/LEAVE, ...)`
  with no membership check.
- **Exploit**: non-member spoofs collaborator presence on any feature's
  realtime channel; leaks session identity into private workspace
  channels.
- **Fix**: resolve `feature.workspaceId` then
  `resolveWorkspaceAccess(request, { workspaceId })` +
  `requireMemberAccess`.
- **Status**: ✅ Fixed on `ef/idor-fixes-4`. The handler now
  loads `feature.workspaceId` and runs
  `validateWorkspaceAccessById` with `canRead` before
  `pusherServer.trigger`, so signed-in non-members can no longer
  broadcast fake join/leave events onto a victim feature's
  realtime channel. Missing feature and non-member both return a
  unified 404 so feature existence isn't leaked either.

#### 28. `src/app/api/github/app/install/route.ts` — POST
- **Bug**: no membership check on `workspaceSlug` from body; reads
  install metadata (`githubInstallationId`) for any workspace and
  mints a state bound to the victim workspace.
- **Fix**: `validateWorkspaceAccess(workspaceSlug, userId)` with
  `canAdmin` before generating state or returning install info.
- **Status**: ✅ Fixed on `ef/idor-fixes-4`. The `canAdmin`
  access check runs immediately after the slug null-check, so the
  handler never mints a signed state, never writes
  `session.githubState`, never calls the GitHub API, and never
  returns install metadata for non-admins. Note that even without
  the install-route fix, `/api/github/app/callback` already
  re-validates admin access on the workspaceSlug (see #20), so
  the pre-fix impact here was primarily install-metadata
  disclosure + state pollution on the caller's own session
  row rather than a direct cross-tenant write. Tests: updated
  two existing 404 message assertions and added three new IDOR
  tests (non-member attacker → 404 + no GitHub fetch + no
  githubState stored, DEVELOPER → 404, ADMIN happy path).

#### 29. `src/app/api/github/pr-metrics/route.ts` — GET
- **Bug**: `db.artifact.findMany({ where: { message: { task: { workspaceId } } } })`
  with query-supplied `workspaceId` and no membership check.
- **Exploit**: read PR metrics (PR count, merged count, success rate,
  time-to-merge) for any workspace.
- **Fix**: `validateWorkspaceAccessById(workspaceId, userId)` before
  the query.
- **Status**: ✅ Fixed on `ef/idor-fixes-4`. Added the `canRead`
  check between the `workspaceId` null-check and the
  `artifact.findMany` query. Returns the unified 404. Tests: one
  new IDOR test asserts the attacker gets 404 and
  `db.artifact.findMany` is never called.

#### 30. `src/app/api/orgs/[githubLogin]/schematic/route.ts` — GET, PUT
- **Bug**: `db.sourceControlOrg.findUnique({ where: { githubLogin }, select: { schematic } })`
  on GET, `db.sourceControlOrg.update(... { schematic })` on PUT — no
  membership check.
- **Exploit**: any signed-in user reads or overwrites any org's
  `schematic`.
- **Fix**: same pattern as #23; admin required for PUT.
- **Status**: ✅ Fixed on `ef/idor-fixes-4`. Added a private
  `resolveAuthorizedOrgId(githubLogin, userId, requireAdmin)`
  helper (mirror of the one in the sibling connections route)
  that returns the org id only when the caller owns or is an
  active member of at least one workspace under it, with the
  `requireAdmin` branch narrowing to OWNER / WorkspaceRole.ADMIN.
  GET uses the resolved id to scope `findUnique`; PUT uses it to
  scope the `update`. Unknown `githubLogin` and non-qualifying
  callers both return "Organization not found" at 404 so org
  existence isn't leaked. Tests: the existing 3 GET + 3 PUT
  tests were updated to enrol each test user in a workspace
  under the org, and 5 new IDOR tests were added (GET non-
  member → 404 with no schematic content in the body, GET
  unknown org → 404, PUT DEVELOPER → 404 + no DB write, PUT
  non-member → 404 + no DB write, PUT ADMIN → happy path).

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

1. **Phase A — critical handlers (#1–5)**: ✅ landed on
   `ef/idor-fixes-1` (commit `03d836163`). Unit + integration tests
   assert non-members get 404 and that no credentialed side-effects
   run on their behalf.
2. **Phase B — high-severity (#6–25)**: group by area (agent, swarm,
   github, upload, misc). 3–4 follow-up PRs. Consider factoring the
   `apiTokenAuth ? requireAuthOrApiToken(...) : resolveWorkspaceAccess(...)`
   pattern into a shared helper to keep new handlers honest.
   - Agent cluster (#8–11) ✅ on `ef/idor-fixes-2` (commit
     `3d39db806`).
   - Swarm cluster (#13–16) ✅ on `ef/idor-fixes-2` (commit
     `7b5a2fa78`).
   - Tests cluster (#17–18) ✅ on `ef/idor-fixes-2`.
   - Upload (#25) ✅ on `ef/idor-fixes-2`.
   - Misc (#6, #7) ✅ on `ef/idor-fixes-2`.
   - Agent logs (#12) ✅ on `ef/idor-fixes-2`.
   - Pool manager (#19) ✅ on `ef/idor-fixes-2`.
   - Workflows/versions (#22) ✅ on `ef/idor-fixes-2`.
   - Bounty request (#24) ✅ on `ef/idor-fixes-2`.
   - Github cluster (#20, #21, #23) ✅ on `ef/idor-fixes-3`.
3. **Phase C — medium (#26–30)**: ✅ landed on `ef/idor-fixes-4`.
   All five medium-severity handlers now gate their reads/writes
   behind workspace membership (or org-scoped workspace membership
   for the /orgs paths). Integration tests added/updated for each
   handler that had an existing suite.
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