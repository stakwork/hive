# Code-Change Approval: Async Delivery + Write-Path Confinement

## Implementation status — 2026-08-19

**Part 2 (stakgraph) is SHIPPED and verified end-to-end against a live local
swarm** (real Anthropic runs, real PR opened and closed against stakwork/hive —
PR #5066). **Parts 1, 3, and 4 (Hive) are now IMPLEMENTED** — see the Hive
status section directly below. Everything below these sections is the
original plan, annotated where reality diverged.

### Hive-side implementation status — 2026-08-19

All seven hand-off items are implemented (no auto-redispatch on
`retryable: true` — deliberate; the reconcile cron + manual abandon are the
recovery paths). Key decisions where the plan under-specified:

| Item | Implementation |
| --- | --- |
| 1. Webhook receiver | `POST /api/code-change/webhook` (registered `access: "webhook"` in middleware config). Per-claim secret (`Task.codeChangeWebhookSecret`, new column + migration, encrypted via `FieldEncryptionService`) generated at approval; a 30-day JWT over `{ taskId }` rides the `webhookUrl` query (`createCodeChangeWebhookToken`). The payload binds to the receipt: `request_id` must equal `claim.requestId`. Both statuses handled; `retryable` failures mark the card and KEEP the claim. |
| Completion path | New `src/lib/proposals/codeChangeCompletion.ts` — the single completion module for webhook AND cron. Runs the shared `_processCompletedResult` → `hardenPrResult` hardening (exported, not forked), then: success → `Task.branch` + PULL_REQUEST artifact (idempotent) + labels; deletable failure → claim deleted; ambiguous (`create_pr_not_called`, …) → claim kept. `DELETABLE_FAILURE_CODES` and `parseCreatePrClaim` moved here. |
| Card flip (transcript rewrite) | Proposal status is derived from the stored transcript, so the terminal outcome patches the stored `approvalResult` row IN PLACE: `patchStoredCodeChangeResult` (canvas-turn-persistence, same row lock as every other writer, matched by `approvalResult.proposalId`) + a new `code-change-pr-update` Pusher reason. Client side: the merge is append-only, so a new `reconcileApprovalResults` step (canvasChatPersistence) swaps in changed codeChange results by proposalId — covering both viewer tabs (same row id) and the authoring tab (optimistic row, different id, `${turnId}-` rows filtered from merge). |
| 2. Dispatch-and-return | `createPr` no longer polls: it sends `webhookUrl`, parses `pr_branch` from the dispatch response, persists the claim via `onDispatch` (enriched by the caller with `conversationId`/`proposalId`/`approvedPaths`), and returns `CreatePrDispatched`. Approval returns `codeChange: { prPending: true }` immediately. Timeouts on dispatch (30s) and all GitHub/progress fetches (15s). `publicBaseUrl` is captured in `/api/ask/quick` (route level — the documented `getBaseUrl` trap) and threaded through `runProposalIntent` → `handleApproval`; a codeChange approval REFUSES before claiming if it is absent. |
| 3. Card state | `codeChange.prPending` on `ApprovalResult`; `CodeChangeMeta` renders a spinner line, `approvedSubtext` says "PR in progress…", and the terminal patch flips it live. |
| 4. Reconcile cron | `/api/cron/code-change-reconcile` (vercel.json, every 10 min, enabled unless `CODE_CHANGE_RECONCILE_CRON_ENABLED=false`). Sweeps claims 10 min–7 days old with a receipt and no PULL_REQUEST artifact, resolves via `reconcilePr` — which now uses the stored `pr_branch` VERBATIM in the GitHub `head` filter (legacy `runIdPrefix` claims skip that channel; it never matched anyway). |
| 5. `create_pr_not_called` | Added to `classify()` with an honest message naming the possible unpushed branch; NOT deletable. `_processCompletedResult` logs the payload shape (`rawKeys`, `landResultKeys`, `tool_use` names) on every non-success branch. |
| 6. Preview isolation | `ephemeral: true` on the preview dispatch in `codeChangeTools.ts` (`repoAgent` params type documents the flag). |
| 7. Small fixes | 4.2: mock stores/serves the FLAT `result.pr`, returns `pr_branch` derived from an independent mock runId (`slice(0, 8)`), adds `webhookMode: "not_called"`; a contract test pins the mock envelope against the real `hardenPrResult`. 4.3: `POST /api/code-change/claims/[taskId]/abandon` (creator or workspace admin; runs a final reconcile first and adopts a found PR instead of deleting) + an "Abandon claim" affordance on failed cards with ambiguous codes. 4.4: workspace rate-limit bucket fixed to `codechange:ws:<id>`; `unapprovedPaths` now actually reaches the UI (webhook patch) and the previously-unreachable `cc.failureCode` card branches are now the live failure path. 4.5: `validatePrArgs` enforced at the approval boundary (normalized title/body are what gets dispatched). 4.6: `CODE_CHANGE_CAPABILITY_ORG_LOGINS` + the cron flag documented in `env.example`. |

Tests: `codeChangeCompletion.test.ts`, `code-change-webhook.test.ts`,
`stakgraph-repo-agent-contract.test.ts` (mock↔contract pin), new
`reconcileApprovalResults` cases in `canvasChatPersistence.test.ts`;
`handleApproval-code-change.test.ts` and `createPr.test.ts` updated for the
async contract. Full unit suite green (842 files / 15,362 tests).

Still open: the orphaned PR + claim from the 2026-08-19 incident (manual
decision — the new abandon endpoint can clear the claim once the PR is
dispositioned). Auto-redispatch on `retryable: true` deliberately not
implemented.

### What shipped in stakgraph (`mcp/src/repo/`)

| Plan item | Implementation |
| --- | --- |
| 2.1 bash confinement | `confinedBashRejection()` in `tools.ts`: on confined runs, blocks `git push`, `git commit`, `git remote`, and `gh pr\|api\|repo\|release`, plus the existing shared-checkout path guard. `GH_TOKEN`/`GITHUB_TOKEN` are **blanked** (`""`) in bash env — blanking, not omission, because `executeBashCommand` spreads `process.env` under the overlay, so only an empty override also masks ambient container tokens. |
| 2.3 fail closed | Both arming sites in `index.ts` and a belt-and-braces throw in `agent.ts#prepareAgent`: `create_pr` enabled without resolved identity/worktree now errors the run instead of silently proceeding unconfined. |
| 2.4 preview isolation | New `ephemeral: true` request-body flag → `acquireEphemeralWorktree()` (`git_pr.ts`): throwaway detached worktree at the shared checkout's HEAD (no fetch, no credentials, no branch), same bash/editor confinement as prMode, released on every exit path. **Hive's preview dispatch must add `ephemeral: true`** (one-line change in `codeChangeTools.ts`). Rejected combinations 400 at admission: `ephemeral` + `create_pr`, `ephemeral` without exactly one `repo_url`. |
| 2.5 pr sentinel | `terminalPrResult()` in `agent.ts`: when `create_pr` was enabled and the tool never ran, the terminal result (webhook and `/progress` alike) carries `pr: { ok: false, failure: "create_pr_not_called", diff: "", error: "...names the unpushed branch..." }` instead of `pr: undefined`. New failure code added to the `LandChangeFailure` union in `git_pr.ts`. |
| Diagnostics | Logs at every hinge: `prMode armed` / `ephemeral worktree armed` (with runId, worktree path, branch), `[create_pr] invoked/landed/failed`, `[bash-guard] rejected`. |
| Extra fix (found in testing) | `releaseWorktree` now deletes the run's `swarm/swarm-change-*` branch ref from the base repo — previously every PR run leaked one. |
| Extra fix (found in testing) | Confined runs get a worktree-specific prompt preamble (`prependWorktreeInfo`). The standard repo-info block advertises `/tmp/{owner}/{repo}` — in the first live test the model dutifully `cd`'d into the shared checkout for *every* command and was blocked each time, including reads. |

Tests: `mcp/src/repo/__tests__/confinement.test.ts` (guard patterns, token
blanking through the real bash tool, sentinel, ephemeral + branch-cleanup
lifecycle against real git fixtures). Full repo suite green.

### New swarm contract surface (what Hive integrates against)

1. **Dispatch response** for `create_pr` runs now includes
   `pr_branch: "swarm/swarm-change-<runId8>"` — the exact branch the run will
   push. **The claim must store this instead of deriving anything from
   `requestId`** (see the answered open question below).
2. **Webhook payload** (`webhookUrl` body field, non-streaming path only):
   `{ request_id, status: "completed", result }` or
   `{ request_id, status: "failed", error, retryable }`. `result` is the same
   envelope `/progress` serves; `result.pr` is always present on
   `create_pr` runs (success, failure, or the `create_pr_not_called`
   sentinel). Delivery: 3 attempts (0s/5s/30s), 15s timeout each; boot-time
   orphan sweep and graceful-shutdown drain both deliver
   `failed`/`retryable: true`. The swarm sends **no custom headers**, so the
   per-claim secret must ride the webhook URL itself (query param or path).
3. **`ephemeral: true`** body flag for preview runs (see 2.4 row above).
4. **`create_pr_not_called`** as a possible `result.pr.failure` value.

### Answered open questions

- **`runId === request_id`? NO.** `repo_agent` generates `runId` (a fresh
  UUID) independently of `request_id`. The branch is derived from `runId`, so
  Hive's `runIdPrefix: requestId` could NEVER have matched — with or without
  the `.slice(0, 8)` fix. §4.1's fix is now: store the dispatch response's
  `pr_branch` in the claim and use it verbatim in the GitHub `head` filter.
- **Why was prMode absent (2.2)?** Not reproducible from current source — the
  admission gate and the arming gate read the same normalized config, and
  Hive demonstrably sends `toolsConfig: { create_pr: true }`. Most likely the
  incident container ran a build predating the worktree gating. Moot going
  forward: 2.3 makes the degradation impossible (the run errors), and the
  live sentinel test reproduced the incident scenario with a clean,
  diagnosable payload.

### New findings from implementation/testing

- **The shared clone's `origin` remote embeds the PAT** (`clone.ts` inlines
  `https://user:pat@github.com/...`), and worktrees share the base repo's
  remote config. Two consequences: (a) `git push origin` works from bash with
  no env token — which is why the 2.1 blocklist exists and also covers
  `git remote` (`git remote get-url origin` prints the PAT to the model on
  ANY unconfined run — pre-existing leak, worth its own fix: clone with a
  clean URL + per-invocation `http.extraheader`). (b) This is a standing
  credential-exfiltration surface outside confined runs.
- **`gitleaks` must be on the swarm container PATH.** `landChange` fails
  closed without it (`secrets_detected: "gitleaks binary not found"`).
  Verify production images ship it — a missing binary blocks all PR landings.
- **Fine-grained PATs pass admission but can fail at push.** The admission
  check reads `GET /repos/.../` `permissions`, which reports the *user's*
  permission, not the *token's* effective grant (and reads on public repos
  succeed with any token). Verified live: a personal-resource-owner
  fine-grained PAT sailed through admission and 403'd at push
  (`push_rejected`, handled cleanly). Irrelevant for production (GitHub App
  installation tokens), but the check is optimistic by nature.
- **Dirty shared checkouts don't self-heal.** `ephemeral` prevents future
  dirtying, but any checkout already dirtied by past preview runs stays dirty
  until a manual `git reset --hard` (and `git pull` in `cloneOrUpdateRepo`
  can fail on it). One-time container cleanup needed at deploy.

### Hand-off: Hive-side work list (none started)

In plan order — Part 1 items renumbered for the executor:

1. **Webhook receiver** — `POST /api/code-change/webhook` (Part 1). Secret in
   the URL (swarm sends no headers): generate a per-claim secret at approval
   time, store it (new field on the claim receipt, encrypted like
   `agentWebhookSecret`), put it in the `webhookUrl` query, verify on
   receipt. Handle both `status: "completed"` (run `result.pr` through the
   SAME `_processCompletedResult`/`_hardenAndBuild` path as today — export
   it, don't fork it) and `status: "failed"` (mark the claim; `retryable:
   true` means a swarm restart orphaned it and re-dispatch is safe).
   Idempotent: reuse `attachPrArtifact`.
2. **Dispatch-and-return** — `createPr.ts`: send `webhookUrl`, drop the 600s
   poll, return after the claim is persisted. Store `pr_branch` from the
   dispatch response in the claim (replaces `runIdPrefix` — §4.1). Add fetch
   timeouts (Part 3.4).
3. **Card state** — third proposal-card state "dispatched, PR pending" +
   Pusher event on webhook completion (Part 1 UI).
4. **Reconcile cron** — sweep claims with a receipt, no PULL_REQUEST
   artifact, age past threshold → `reconcilePr` using the stored `pr_branch`
   (Part 1 fallback; completes #5055).
5. **`create_pr_not_called` classification** — add to `classify()` in
   `createPr.ts` with an honest message; NOT deletable (Part 3.2). Log shape
   on every non-success branch (Part 3.1); keep `tool_use`/`content` for
   create_pr runs (Part 3.3).
6. **Preview isolation** — add `ephemeral: true` to the preview dispatch in
   `codeChangeTools.ts` (pairs with swarm 2.4, already shipped).
7. **Part 4 small fixes** — 4.2 mock alignment (flat `result.pr`, and mock
   the new `pr_branch` dispatch field), 4.3 stuck-claim escape hatch, 4.4
   leftovers, 4.5 `validatePrArgs`, 4.6 env.example.

Rollout note: with Part 2 shipped, the plan's recommendation to keep
`CODE_CHANGE_CAPABILITY_ORG_LOGINS` empty can lift once the deployed swarm
containers carry the new stakgraph build (and gitleaks) — Hive Part 1 improves
UX/durability but is no longer load-bearing for safety.

---

## Background

The `propose_code_change` → approve → PR flow shipped across #5053, #5055, and
#5056. The first real end-to-end run on 2026-08-19 exposed two independent
classes of problem, one on each side of the swarm boundary.

**What the user saw.** Approving the proposal spun for ~25s, then the card
reported:

```
I couldn't create that: Swarm result missing `ok` field.
```

**What actually happened.** A PR *was* created — but not by the `create_pr`
tool. From the swarm's own run log:

```
tool_call: bash {"command":"find / -type d -name \"hive\" 2>/dev/null | grep -v node_modules"}
tool_call: bash {"command":"cd /tmp/stakwork/hive && git status && git branch --show-current"}
tool_call: bash {"command":"cd /tmp/stakwork/hive && git diff src/app/auth/signin/page.tsx"}
text: The diff is already applied and matches exactly. Now let's create a branch, commit, and open the PR....
tool_call: bash {"command":"cd /tmp/stakwork/hive && git checkout -b jamie/mock-login-button-blue && git add … && git commit -m \"[Jamie] Make mock l…"}
tool_call: bash {"command":"cd /tmp/stakwork/hive && gh pr create --title \"[Jamie] Make mock login button blue\" --body \"\" --head jamie/mock-login-button-blue --base master …"}
[session] end status=success tokens=80401 duration_ms=22577
```

The agent hand-rolled the PR with `bash` + `gh`, in the **shared checkout**
(`/tmp/stakwork/hive`), on a branch of its own naming. `create_pr` was never
invoked, so `prCollector.result` stayed `undefined`, `result.pr` serialized
away, and Hive's `_processCompletedResult` fell into its `!("ok" in landResult)`
branch.

The result envelope itself was never the problem. `stakgraph`'s
`repo/index.ts` sets `pr: result.pr` to a flat `LandChangeResult`, which is
exactly the shape `createPr.ts` expects. This was a *tool that did not run*,
misreported as a *shape that did not parse* — which is itself a finding
(see Part 3).

### Everything that PR bypassed

Because `landChange()` never executed, the PR skipped, swarm-side: the
gitleaks secret scan, the file/byte caps, base-dirty detection, and the
`already_landed` idempotency record.

And Hive-side, everything downstream of a `CreatePrSuccess`:

| Guard | Consequence of skipping |
| --- | --- |
| `hardenPrResult` → `validatePrUrl` | Nothing confirmed the PR is even in the approved repo |
| `pathSetVerified` / `unapprovedPaths` | Nothing compared the landed diff to the reviewed one |
| `PULLREQUEST` artifact | `pr-monitor` is blind to the PR; no CI tracking, no auto-fix |
| `Task.branch` | No link from the claim Task to the branch |
| `addPrLabels` | No `jamie` label |
| Approved `body` | Dropped entirely — the agent passed `--body ""` |

The claim Task also survives (`failureCode: "unknown"` is deliberately
non-deletable), so that proposal can never be re-approved: the
`@@unique([workspaceId, proposalId])` insert will 409 forever, and
`reconcilePr` cannot resolve it because the branch is `jamie/…` rather than
`swarm/swarm-change-*`.

---

## Part 1 — Hive: replace the blocking poll with webhook delivery

### Current behavior

`createPr` dispatches to `POST /repo/agent` and then long-polls `/progress`
**in-process**:

```ts
const maxAttempts = 120;
const pollInterval = 5000;
for (let attempt = 0; attempt < maxAttempts; attempt++) {
  await new Promise((r) => setTimeout(r, pollInterval));
  // …
}
```

`approveCodeChange` awaits that inline, `runProposalIntent` awaits
`handleApproval`, and `/api/ask/quick` only responds once the whole chain
resolves. The request body carries **no `webhookUrl`** — the string `webhook`
does not appear in `createPr.ts` at all.

Consequences:

- The approval HTTP request is held open for the entire PR creation: a 5s
  sleep before the first check, then up to **600s** of polling, inside a
  route declaring `maxDuration = 800`.
- The proposal card sits in `pending-in-flight` ("✓/✗ disabled, spinner")
  for the duration. The conversation cannot continue.
- Past ~800s the platform kills the function and the user gets **nothing** —
  no success, no error. The `Task.codeChangeClaim` receipt added in #5055 is
  the only surviving trace, which is why its write is fatal-on-failure rather
  than best-effort.
- The 600s poll ceiling and the 800s route budget are uncoordinated. A run
  that exhausts the poll returns `"PR creation timed out. Use reconcilePr()
  to check the outcome."` with `failureCode: "unknown"` — non-deletable, so
  the proposal is permanently blocked.

### Proposed shape

```
approve → claim Task (as today)
        → dispatch to swarm WITH webhookUrl + per-claim secret
        → persist codeChangeClaim receipt (as today)
        → return immediately; card shows "PR in progress"
                ↓
  swarm posts terminal result to /api/code-change/webhook
                ↓
  verify → harden → attach PULL_REQUEST artifact + Task.branch + label
        → Pusher event flips the card to "PR opened ✓"
```

### What already exists

- **Swarm side.** `postTerminalWebhook` fires whenever `body.webhookUrl` is
  set, with retries, and delivers the same `terminalResult` envelope that
  `/progress` serves. The mock at `src/app/api/mock/stakgraph/repo/agent/route.ts`
  already simulates this fan-back.
- **Hive side.** `Task.codeChangeClaim` (the receipt), `ArtifactType.PULL_REQUEST`,
  the Pusher channel the canvas already listens on, and a per-task webhook
  auth precedent in `src/app/api/agent/webhook/route.ts` (encrypted
  per-task secret + JWT via `verifyWebhookToken`).
- **The swarm-reachable base URL.** `CapabilityContext.publicBaseUrl` exists
  for exactly this purpose and documents the trap: it is captured from the
  request `host` header at the route level and must never be derived inside
  a tool closure via `getBaseUrl()`, which yields `localhost:3000` when
  there is no host header. It is currently threaded to
  `buildWorkflowExplorerTools`; the code-change path will need the same.

### What has to be built

1. `POST /api/code-change/webhook`, modeled on the agent webhook: resolve the
   claim Task, decrypt a per-claim secret, verify the token, reject on
   mismatch. Add a `codeChangeWebhookSecret` field (or reuse
   `agentWebhookSecret`, whose name would then be misleading — prefer a new
   field).
2. Move `hardenPrResult` / `_buildSuccess` behind an exported entry point the
   webhook handler can call, so the *webhook* path runs the identical
   hardening the poll path does today. Every path that persists a PR URL must
   clear the same shape / URL / cap / secret checks — this is the invariant
   `_hardenAndBuild` was written to protect, and it must not be forked.
3. Idempotency. The webhook can be delivered more than once (it retries).
   Attaching the artifact must be a no-op the second time; `attachPrArtifact`
   in `handleApproval.ts` is already written this way and can be reused.
4. A fallback for a webhook that never arrives. Keep `reconcilePr` as the
   backstop, driven by a cron sweep over claim Tasks that have a
   `codeChangeClaim` receipt, no `PULL_REQUEST` artifact, and an age past
   some threshold. This is the missing half of #5055: reconcile is currently
   reachable only when a user happens to re-approve.
5. UI: a third card state between `pending-in-flight` and `approved` —
   "dispatched, PR pending" — so the spinner is not overloaded to mean both
   "waiting on HTTP" and "waiting on a PR".

### Ordering note

This is worth doing regardless of Part 2, but it does not fix the incident
above on its own. A webhook carrying `pr: undefined` still tells us nothing;
Part 2 is what makes the payload trustworthy.

---

## Part 2 — stakgraph: the write path is not actually confined

> **✅ SHIPPED 2026-08-19 and verified live** — see the status section at the
> top for what was actually built (it goes further than proposed in places:
> `git remote` and `gh` writes are also blocked, tokens are blanked rather
> than withheld, and preview isolation became an `ephemeral` worktree flag
> rather than a checkout reset).

These are `stakgraph` changes (`mcp/src/repo/`), not Hive changes. They are
the prerequisite for trusting any approval outcome.

### 2.1 `bash` holds a live push token, and the guard is a substring check

Every `bash` invocation runs with the request's PAT injected:

```ts
// tools.ts:686
const ghEnv: NodeJS.ProcessEnv | undefined = pat
  ? { GH_TOKEN: pat, GITHUB_TOKEN: pat }
  : undefined;
```

`bash` is registered unconditionally ("Always register bash tool"). The only
confinement on the `create_pr` path is:

```ts
// tools.ts:702 — and the comment concedes the point
// Bash confinement (create_pr path): reject commands referencing the
// shared checkout — a guard, not a sandbox; base-dirty detection is
// the backstop for anything that slips through.
if (options?.baseCheckoutPath && command.includes(options.baseCheckoutPath)) { … }
```

A path-substring check cannot confine a tool that holds a push token: the
agent does not need the shared checkout to open a PR, it only needs `gh`.
**Proposal:** when `prMode` is armed, refuse `git push`, `git commit`, and
`gh pr create` in `bash` outright, so `create_pr` is the only path to a
remote write. Consider withholding `GH_TOKEN`/`GITHUB_TOKEN` from `bash`
entirely on `create_pr` runs — `landChange()` supplies its own env via
`gitEnv(identity, pat, handle.runHome)` and does not need the ambient token.

### 2.2 `prMode` was not armed for a run that asked for `create_pr`

The worktree is gated on:

```ts
// index.ts:862
if (toolConfigEnabled(body.toolsConfig?.create_pr) && prResolvedIdentity?.ok) { … }
```

When that is false, `nonStreamPrMode` stays `undefined`, `effectiveRepoDir`
remains the shared checkout, `create_pr` has no handle, and
`baseCheckoutPath` is never passed — so the bash guard is not armed either.
That matches the log exactly: the agent worked in `/tmp/stakwork/hive`, and
nothing rejected it.

A real `create_pr` run has cwd `/tmp/.swarm-work/<runId>/<owner>/<repo>`
(`git_pr.ts:413`), which shares no prefix with `baseCheckoutPath`
(`/tmp/${owner}/${repo}`) — the guard is coherent when armed. So it was not
armed.

This is unresolved. Hive sent `toolsConfig: { create_pr: true }`,
`toolConfigEnabled(true)` returns `true`, and every admission failure in the
`create_pr` block returns non-200 early — yet Hive received a `request_id`
and a completed run, which means admission passed. **To settle it:** read
`.reqs/<request_id>.json` on the container for the persisted record, and
`GET /repo/agent/tools` for the resolved tool list.

### 2.3 Fail closed when `create_pr` is requested but cannot be armed

Whatever the answer to 2.2, the degradation mode is wrong. A run that asked
for `create_pr` and could not get a worktree should **error**, not silently
proceed as an unconfined shared-checkout run with a live push token. Today
`create_pr` would return the string `"create_pr is not available: no worktree
handle was resolved for this run"` *if the model called it* — and the model
is free not to.

### 2.4 Preview runs leave the shared checkout dirty

`The diff is already applied and matches exactly` is the agent observing the
**preview** run's leftovers. Hive's preview prompt instructs the agent to
apply the diff locally and emit `git diff HEAD`; nothing reverts it. The next
run in that container inherits the dirty tree — and here it committed that
pre-existing state instead of applying the approved diff to a clean base.

Preview runs should either use a throwaway worktree or reset the checkout on
completion. Note this also means a preview run can currently open a PR
(unconfined bash, ambient token) despite its prompt saying `READ-ONLY`.

### 2.5 Make a missing `pr` field impossible to confuse with a shape error

For a run with `toolsConfig.create_pr` enabled, the terminal result should
always carry a `pr` field — either the `LandChangeResult` or an explicit
sentinel (`{ ok: false, failure: "create_pr_not_called" }`). Today its
absence is indistinguishable from a malformed payload, which is precisely
how this incident presented.

---

## Part 3 — Diagnosability

Establishing the above required reading swarm source and a hand-pasted server
log. Hive logged nothing useful, because every failure branch in
`_processCompletedResult` discards the payload:

```ts
if (!("ok" in landResult)) {
  return { ok: false, failureCode: "unknown", message: "Swarm result missing `ok` field." };
}
```

Fixes:

1. **Log the shape on every non-success branch.** `Object.keys(raw)`,
   `Object.keys(landResult)`, `requestId`, `sessionId`, and — most valuable —
   `raw.tool_use`, which would have named `bash` immediately. None of this is
   sensitive; `pr.diff` and `error` stay discarded at the adapter boundary as
   they are today.
2. **Give it its own failure code.** `create_pr_not_called` rather than
   `unknown`, with a message that says a PR may exist and names the branch to
   check. It must **not** be added to `DELETABLE_FAILURE_CODES` — this
   incident proves a PR can exist on this path.
3. **Keep `tool_use` / `content` for create_pr runs.** `createPr` currently
   drops them; on an unexpected outcome they are the whole story.
4. **No fetch has a timeout.** Neither the dispatch, the `/progress` polls,
   nor `reconcilePr`'s calls pass an `AbortSignal`. A hung connection burns
   the route budget silently. Under Part 1 the dispatch becomes short-lived,
   so a tight timeout there is easy and worth adding.

---

## Part 4 — Smaller Hive fixes

### 4.1 `runIdPrefix` is wrong, so reconcile's GitHub channel cannot match

`reconcilePr` builds `head=<owner>:swarm/swarm-change-<runIdPrefix>`, and
#5055 sets `runIdPrefix: requestId` (the full id). The swarm actually names
branches:

```ts
// git_pr.ts:339
const name = `swarm/${segment}-${runId.slice(0, 8)}`;
```

The **first** 8 characters. Two corrections: use `requestId.slice(0, 8)`, and
confirm `runId === request_id` on the async path before relying on it.
GitHub's `head` filter is an exact match, so an approximate prefix yields
nothing rather than a near miss.

> **⚠️ Superseded (2026-08-19):** `runId !== request_id` — they are
> independent UUIDs, so no transformation of `requestId` can ever produce the
> branch name. The swarm's dispatch response now returns the exact branch as
> `pr_branch`; store that in the claim and use it verbatim.

### 4.2 The mock does not match production

- `mockPrResultStore.set(requestId, { ok: true, pr: prResult })` is then
  nested again as `result.pr`, giving `result.pr.pr` — where production has
  the `LandChangeSuccess` fields flat on `result.pr`. The adapter's
  `hardenPrResult` reads `url`/`branch`/`base`/`headSha`/`diff` off
  `landResult` directly, so the mock's shape and prod's shape cannot both be
  correct.
- The mock branch uses `requestId.slice(-8)`; the swarm uses `.slice(0, 8)`.

A mock that green-lights payloads production would reject is worse than no
mock. Worth an assertion test that pins the mock's envelope against the
`landChangeContract` types.

### 4.3 A way to clear a stuck claim

There is currently no path out of a non-deletable claim except generating a
fresh proposal (which does work — a new `proposalId` is unblocked — and is
the honest workaround today). An explicit "abandon this proposal" action that
deletes the claim after showing the operator the branch to check would be
better than leaving rows that nothing can resolve.

### 4.4 Leftovers from the #5055 review, never addressed

- **The two rate-limit buckets are one bucket.** `codechange:user:${userId}`
  and `codechange:${userId}:${payload.workspaceId}` are both keyed on the
  user with the same limit of 10/hr, so the second never binds. Presumably
  meant `codechange:ws:${workspaceId}`. Both `incr` before the claim, so
  failures and P2002 losers burn quota.
- **Post-dispatch transaction failure is swallowed.** If the step-6b
  `$transaction` fails after the PR exists, the claim has no
  `PULL_REQUEST` artifact, retry hits P2002 → permanent 409, and pr-monitor
  never sees the PR. Logged only.
- **Dead code in the success path.**
  `...(pr.pathSetVerified === false && pr.unapprovedPaths?.length ? {} : {})`
  spreads `{}` either way, so `unapprovedPaths` never reaches the UI even
  though the card warns about them. The `cc.failureCode` / `cc.failureMessage`
  branches in `ProposalCard` and `runProposalIntent` are unreachable —
  failures return `{ ok: false }` with no `result`. The P2002
  `winner.workspaceId !== payload.workspaceId` check cannot fire, since the
  query already filters on it.

### 4.5 `validatePrArgs` is defined and never called

`diffHygiene.ts` exports it — leading-dash rejection (a `-` prefix is read as
a git flag by `commit -F`), newline normalization, and length caps — and
nothing in `createPr` or `approveCodeChange` calls it. The propose tool
partially duplicates it (`title.replace(/[\r\n]+/g, " ").trim()`). Either
call it at the approval boundary or delete it.

### 4.6 `CODE_CHANGE_CAPABILITY_ORG_LOGINS` is missing from `env.example`

Both siblings are documented (`PROMPTS_CAPABILITY_ORG_LOGINS:261`,
`GRAPH_WRITE_CAPABILITY_ORG_LOGINS:265`). This is the only switch that
enables the feature, and it is the one that is undocumented.

---

## Rollout

**Recommendation: set `CODE_CHANGE_CAPABILITY_ORG_LOGINS` back to empty until
Part 2 lands.**

Hive's own guards are in place and were verified by the #5055 review — the
stored-transcript payload binding, the originator check, diff hygiene at the
approval boundary, claim-before-write. None of them help here, because the
bypass happens *after* dispatch, inside the swarm container. As it stands an
approval can land a PR that no guard on either side inspected, with no record
in Hive and no way to retry the proposal.

### Suggested order

1. **Part 2.1 + 2.3** (stakgraph) — refuse remote writes from `bash` on
   `create_pr` runs; fail closed when `prMode` cannot be armed. Restores the
   invariant the whole design rests on.
2. **Part 3** (Hive, small) — logging and a distinct failure code. Cheap, and
   makes the next surprise diagnosable in one pass instead of a source dive.
3. **Part 2.2** (stakgraph) — root-cause why `prMode` was absent. May be
   subsumed by 2.3, but the answer should be known rather than assumed.
4. **Part 2.4** (stakgraph) — stop preview runs dirtying the shared checkout.
5. **Part 1** (Hive) — webhook delivery. The largest change and the one users
   will feel; worth doing on a trustworthy payload rather than before one.
6. **Part 4** (Hive) — the small fixes, any time; 4.1 and 4.2 pair naturally
   with Part 1.

## Open questions

- ~~Does `runId === request_id` on the async `/repo/agent` path?~~
  **Answered: no** — independent UUIDs. 4.1 is now solved by the `pr_branch`
  dispatch-response field (see status section).
- ~~Why was `prMode` absent (2.2)?~~ **Not reproducible from current source**;
  most likely a pre-gating build on the container. Made moot by the shipped
  fail-closed behavior (2.3).
- ~~Should `create_pr` runs get `bash` at all?~~ **Resolved as proposed**: bash
  stays, but on confined runs it is the read-only variant — tokens blanked,
  `git push`/`commit`/`remote` and `gh` writes refused.
- The orphaned PR from this incident and its claim Task still need a manual
  decision: adopt the PR into Hive by attaching an artifact, or close it and
  re-run the proposal. **(Still open.)**
