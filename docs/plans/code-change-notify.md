# Code-change notify: telling Jamie when a strut run settles

Status: proposed — 2026-09-23. Follows the two code-change-on-strut PRs
(#5336 preview, #5338 landing).

## 1. Problem

Both halves of the code-change flow are true dispatches: `propose_code_change`
launches a `code-change-propose` strut run and returns a pending card in the
same tool call; approval launches `code-change-land` and returns "PR pending".
The chat turn ends, the input stays open, and the user can keep talking to
Jamie while either run is in flight.

What never happens is Jamie hearing the result. Each completion handler
(`services/strut-runs/code-change-propose.ts`, `code-change-land.ts`) patches
the stored card in place and fires a Pusher nudge, so the browser re-renders
the card. That is the whole notification. Jamie sees the outcome only on the
next user message, because the patched tool output is what `toModelMessages`
replays into context — and even then nothing says it *changed* since the last
turn. Three consequences:

- a failed preview (no changes, too large, invalid diff, secrets, a strut
  error) sits on the card with nobody to retry or fall back to `propose_feature`;
- a `patch_conflict` at landing deletes the claim and the card says
  re-approvable, but re-approving applies the same bytes to the same moved
  base and fails again. The real recovery is re-propose, which only Jamie can do;
- Jamie's last words in the transcript ("generating a diff, the card will
  update") are stale the moment the card flips, and Jamie has no way to know.

The obvious fix — queue the result and inject it as a turn as soon as the
agent is idle, the way Claude Code surfaces background-task notifications —
has a cost we do not want: if the user has moved on to something else, the
thread jumps back to the code change and they lose their place. The
`dispatch_strut` wake (`canvas-strut-autoturn.ts`) already has this shape and
already needs a "default toward silence" instruction to stay bearable.

## 2. Principle: decouple *learning* from *speaking*

The naive design couples two things: Jamie learning the result and Jamie
saying something about it. Every notification becomes a visible turn. Split
them:

- **Learning is immediate, silent and unconditional.** Jamie's context is
  right the next time Jamie runs, whatever the user is doing. No turn.
- **Speaking is rare, and only when Jamie has a move the user cannot make
  with one click.** A ready diff and an opened PR need nothing from Jamie: the
  card *is* the notification and the next action is a click. Failures Jamie
  can act on (re-propose after `patch_conflict`, retry a preview with a
  sharper prompt, hand a too-large change to `propose_feature`) are the only
  reason to speak — and only while the user is still waiting for exactly this.

Nothing here is new machinery. The three pieces below reuse the transcript
patch, the existing auto-turn claim and gating, and the card's existing
`sendMessage` path.

## 3. Design

### 3.1 Learn: the "since your last turn" digest

At the start of every user turn in server-history mode
(`/api/ask/quick`, where `convertedMessages` is assembled from
`toModelMessages(stored)` plus the new user message), look up the
conversation's `StrutRun` rows of kind `code_change_propose` /
`code_change_land` that settled after the conversation's last stored turn.
If there are any, prepend a short block to the model copy of the user
message:

```
[Since your last turn]
- preview a1b2c3d4 ("Add retry to fetchUser"): ready — 3 files, awaiting approval
- landing e5f6a7b8 ("Rename Widget"): failed (patch_conflict) — base branch moved; re-propose to fix
```

One line per row, newest first, capped at five rows and 24 h of age. The
cursor is `SharedConversation.lastMessageAt` as read *before* this turn's rows
are appended — rows with `settledAt` past it are new. No new column and no
new state: a turn that fails simply sees the same digest again next time,
which is harmless.

The block goes into the `ModelMessage` only, never into the stored user row
(the route already persists `body.message` separately). It is not shown in
the UI. The system prompt gets one sentence: "A `[Since your last turn]`
block reports background code-change runs that settled while you were idle;
mention it only if it bears on what the user is asking."

The title comes from the card, not the row: resolve `proposalId` against the
stored transcript's `propose_code_change` output (the same walk
`patchStoredProposalPreview` does). The failure token comes from
`row.error` (landing) or the patched card's `failure` (preview).

### 3.2 Speak: a failure-only, waiting-only wake

Sort the outcomes. Only the rows marked **wake** ever produce a turn.

| Run | Outcome | Jamie's move | Wake? |
| --- | --- | --- | --- |
| propose | SUCCESS, card `ready` | none — the user reviews and clicks Approve | no |
| propose | CANCELLED | none — the user pressed Stop | no |
| propose | hygiene failure: no changes, invalid diff | retry once with a sharper prompt | **wake** |
| propose | hygiene failure: too large | re-issue as `propose_feature` | **wake** |
| propose | hygiene failure: secrets detected | report only; never retry the same prompt | no |
| propose | ERROR / LOST (strut failed, run lost) | retry once | **wake** |
| land | SUCCESS, PR opened | none — the PR link is on the card | no |
| land | `patch_conflict` (claim deleted) | re-propose against the moved base | **wake** |
| land | `no_push_permission` (claim deleted) | none — a token/permissions problem for the user | no |
| land | `push_rejected`, `pr_create_failed`, `diff_mismatch` (claim kept) | none — the card offers Abandon; a PR may exist | no |
| land | CANCELLED / LOST | none | no |

**The "still waiting" gate.** Wake only if the user has not moved on: the
assistant message that dispatched this run (the row whose `toolCalls[]`
holds the `propose_code_change` output for this `proposalId`, or whose
`approvalResult` names it for a landing) is the *last* message in the stored
transcript — no user message after it. If the user has sent anything since,
do not wake: the outcome is in the digest (§3.1) and on the card (§3.3), and
the user decides when to come back to it. The check is one walk over the
stored `messages` array under the same row lock `claimAutoTurn` takes.

**Mechanics.** A new `services/canvas-code-change-autoturn.ts`, a sibling of
`canvas-strut-autoturn.ts` and deliberately as thin:

- called by both completion handlers *after* the card patch and the
  active-run clear, wrapped so a wake failure never fails the delivery
  (the webhook must still answer 200);
- `claimAutoTurn(conversationId, row.id)` is the exactly-once gate; output
  rows carry the `autoturn-<row.id>-` id prefix so a replayed callback or a
  reconcile re-run cannot produce a second turn;
- honours `CANVAS_AUTONOMOUS_TURNS_ENABLED=false`. It does **not** require
  the per-user `canvasAutonomousTurns` opt-in: this wake never widens the
  task — it only retries or re-proposes what the user already asked for,
  and only while they are waiting for it. (If that is too bold for a first
  release, gate it behind the opt-in and flip the default after a week of
  logs; nothing else changes.)
- **retry budget: one.** Count `propose_code_change` calls in the transcript
  tail back to the last human message, exactly like
  `countTrailingStrutDispatches`. Past one automatic retry, do not wake;
  the card button (§3.3) takes over. This is the loop breaker: a preview
  that fails the same way twice is a prompt problem, not a transient;
- the wake message is a `user`-role tail, never persisted, naming the
  proposal, the outcome and the *one* move allowed for that outcome, plus
  `stay_silent`. The toolset is the normal canvas toolset (the move needs
  `propose_code_change` / `propose_feature`) — no new tools;
- the reply is an ordinary assistant message at the tail. Because the gate
  guarantees the dispatching turn was the tail, the tail is the user's
  place, and the reply lands exactly where they are looking.

Sketch of the wake message for the highest-value case:

```
You were invoked because the pull request for proposal e5f6a7b8 ("Rename
Widget"), which the user approved, could not be opened: the diff no longer
applies on `main` (patch_conflict) — the base branch moved after the preview
was generated. The claim has been released.

Do exactly one of:
- Re-propose: call `propose_code_change` with the same repositoryUrl, title,
  body and prompt, so a fresh diff is generated against the current base. Say
  one line about why.
- Stay silent: call `stay_silent` if the user has already said not to.

Do not widen the change. Do not re-approve on the user's behalf.
```

### 3.3 The card button: the user's own trigger

Every failed card gets one button whose label names the move — "Re-propose
with Jamie" after `patch_conflict`, "Retry with Jamie" after a preview
failure. It is the path when the user was not waiting (§3.2 did not fire) or
the retry budget is spent. The button sends an ordinary user message through
the card's existing `sendMessage` (the same call Approve and Reject make in
`ProposalCard.tsx`), with the failure folded into the text so Jamie can
adjust:

```
Re-propose "Rename Widget": the base branch moved and the approved diff no
longer applies (patch_conflict).
```

Nothing server-side is new: it is a user turn, Jamie sees the digest and the
card in context, and acts. The message being visible is the point — the user
chose to divert.

## 4. Not in this plan

- **Threaded replies under the card.** The nicest rendering for a wake's
  reply is an annotation attached to the card rather than a message at the
  tail, so the main thread never moves. The canvas chat has no threading
  model; adding one is a larger change than everything above and only pays
  off once wakes fire when the user is *not* waiting — which this plan
  avoids by design. Revisit if the waiting-gate proves too conservative.
- **Wakes on success.** Tempting ("the diff is ready — 3 files, here's the
  gist"), but it is noise next to a card that already shows the diff, and it
  would fire on every proposal. The digest covers the case where Jamie
  should know.
- **Auto-re-approval.** Jamie never approves. After a re-propose the user
  clicks Approve again.

## 5. Adjacent fixes (small, independent)

Two phase-1 warts interact with "keep chatting while it runs" and are worth
fixing alongside, in their own PRs:

1. **Stop is conversation-scoped.** `/api/ask/abort` cancels every PENDING
   `StrutRun` in the conversation. A user who kept chatting and presses Stop
   on a later `repo_agent` turn also kills the in-flight preview. Scope the
   strut cancel to runs whose dispatching turn is the one being stopped
   (`turnId` is already in the abort body), and keep the cancel-everything
   behaviour only for an explicit "stop all".
2. **The initiator loses the Stop button.** `useSendCanvasChatMessage` forces
   `runActive` false at stream end (twice: on clean finish and in `finally`),
   after the dispatch's Pusher `CANVAS_RUN_ACTIVE: true` already landed. Other
   participants keep the button; the person who asked does not. Skip the
   local clear when the turn dispatched a strut run (the tool output's
   `preview: "pending"` is the signal), and let the completion's Pusher
   `false` clear it.

## 6. Order of work

Each step ships on its own and is useful alone.

1. **Digest** (§3.1). Pure function `sinceLastTurnDigest(rows, stored)` with
   unit tests over the outcome table; one call site in `/api/ask/quick`; one
   sentence in the system prompt. Verify the `lastMessageAt` cursor is read
   before this turn's rows are appended.
2. **Card buttons** (§3.3). `ProposalCard.tsx` only, plus a test that the
   sent message carries the failure text.
3. **Wake** (§3.2). `canvas-code-change-autoturn.ts` with the waiting gate,
   the retry budget and the claim; one call from each handler. Unit tests:
   fires only for the wake rows of the table, only when the dispatching turn
   is the tail, at most once per proposal, never on a replayed callback;
   the wake message names the right move.
4. **Adjacent fixes** (§5), separately.

## 7. Open questions

- Opt-in gating for the wake (§3.2): ship ungated with the retry budget and
  the waiting gate as the safety, or behind `canvasAutonomousTurns` first?
  Recommendation: ungated — the wake only ever does what the user already
  asked for.
- Should the digest also cover `dispatch_strut` settlements that did not
  wake (the strut chat's loop breaker skipped them)? Same mechanism, one more
  row kind; cheap to add once the digest exists.
