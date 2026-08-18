// Mirrors mcp/src/repo/git_pr.ts (stakwork/stakgraph). Keep in sync manually.
// When the upstream file changes, update LandChangeSuccess, LandChangeFailureCode,
// and LandChangeFailure here to match.

// ─── Success result ────────────────────────────────────────────────────────

export type LandChangeSuccess = {
  ok: true;
  url: string;
  number: number;
  branch: string;
  base: string;
  headSha: string;
  diff: string;
  filesChanged: number;
};

// ─── Failure codes ─────────────────────────────────────────────────────────
//
// These are payload-level codes that travel inside the JSON body of a
// successful (200) HTTP response. They are DISTINCT from HTTP-level
// admission errors (see below).
//
// Every code here except `already_landed` arrives with `ok: false`.
// `already_landed` is the exception and can arrive with `ok: true` — see the
// already-landed replay section below before narrowing on `ok`.
//
// `rate_limited` is NOT in this enum — it only ever arrives as an HTTP 429
// and is never embedded in a LandChangeFailure body.

export type LandChangeFailureCode =
  | "patch_conflict"
  | "push_rejected"
  | "pr_create_failed"
  | "base_repo_vanished"
  | "no_changes"
  | "secrets_detected"
  | "change_too_large"
  | "identity_mismatch"
  | "no_push_permission"
  | "aborted"
  | "already_landed";

// ─── Failure result ────────────────────────────────────────────────────────

export type LandChangeFailure = {
  ok: false;
  failure: LandChangeFailureCode;
  diff: string;
  error: string;
};

// ─── Already-landed replay ────────────────────────────────────────────────
//
// `landChange` caches each run's result and, on a second call for the same
// runId, returns `{ ...prior, failure: "already_landed" }`. Upstream asserts
// that value `as LandChangeFailure`, but the spread preserves the prior
// result's own fields, so the shape actually returned depends on how the
// FIRST call ended:
//
//   first call succeeded → { ok: TRUE, ...success fields, failure: "already_landed" }
//                          No `error` field. `ok` stays true.
//   first call failed    → { ok: false, failure: "already_landed", diff, error }
//                          A normal LandChangeFailure.
//
// Consequences for consumers:
//
//   1. `ok === false` is NOT a sufficient test for "this did not land". A
//      replayed success passes `ok === true` and must not be counted as a
//      second PR — reuse `url`/`number` instead of landing again.
//   2. On the failure replay the ORIGINAL failure code is overwritten by
//      `already_landed` and is unrecoverable from the response. Capture the
//      first response if the specific cause matters.
//
// Use `isAlreadyLanded` rather than hand-rolling either check.

/**
 * A replay of a run whose first `landChange` call succeeded. Structurally a
 * `LandChangeSuccess` carrying an extra `failure` marker — NOT a failure,
 * despite the field name. The PR named by `url`/`number` really exists.
 */
export type LandChangeAlreadyLandedSuccess = LandChangeSuccess & {
  failure: "already_landed";
};

// ─── Union ────────────────────────────────────────────────────────────────

export type LandChangeResult =
  | LandChangeSuccess
  | LandChangeAlreadyLandedSuccess
  | LandChangeFailure;

/**
 * Whether this response is a replay of a run that already called `landChange`.
 *
 * True for both replay shapes — the success replay (`ok: true`) and the
 * failure replay (`ok: false`). Check this BEFORE branching on `ok`: a true
 * result means no new work happened on this call, whatever `ok` says.
 */
export function isAlreadyLanded(
  result: LandChangeResult,
): result is LandChangeAlreadyLandedSuccess | LandChangeFailure {
  return "failure" in result && result.failure === "already_landed";
}

/**
 * The PR this response refers to, or null if no PR was opened.
 *
 * Collapses the fresh-success and already-landed-success shapes, which is the
 * question callers actually have ("is there a PR?") — unlike `ok`, which
 * conflates "a PR exists" with "this call created it".
 */
export function landedPr(
  result: LandChangeResult,
): LandChangeSuccess | null {
  return result.ok ? result : null;
}

// ─── HTTP admission errors (separate channel from LandChangeResult) ───────
//
// These arrive as non-200 HTTP responses BEFORE the `create_pr` handler
// runs — they are not part of LandChangeResult and never appear in its
// `failure` field.
//
// IMPORTANT — the body field each constant matches differs by check.
//
// Matched VERBATIM against the body's `error` field. These responses carry
// no `failure` field:
//   401  → LAND_CHANGE_ERR_UNAUTH        (API_TOKEN not set on swarm)
//   400  → LAND_CHANGE_ERR_MULTI_REPO    (comma-separated / missing repo_url)
//   400  → LAND_CHANGE_ERR_EMPTY_PAT     (non-empty pat required)
//
// Matched against the body's `failure` field. The `error` field on these is a
// longer — and for identity, dynamic — message ("no_push_permission: PAT does
// not have push access to this repo", "rate_limited: too many PRs landed in
// this hour", "Token login 'x' does not match supplied username 'y'"). Never
// compare `error` for equality on these three:
//   400  → LAND_CHANGE_ERR_IDENTITY      (identity_mismatch admission check)
//   403  → LAND_CHANGE_ERR_NO_PUSH       (no_push_permission admission check)
//   429  → LAND_CHANGE_ERR_RATE_LIMITED  (rate_limited — never in LandChangeFailureCode)
//
// Two further admission responses have no constant here because they carry
// dynamic text: 400 "create_pr: repo_url must be in owner/repo form" and
// 500 "create_pr admission failed: <reason>".

export const LAND_CHANGE_ERR_UNAUTH =
  "create_pr requires API_TOKEN to be configured" as const;

export const LAND_CHANGE_ERR_MULTI_REPO =
  "create_pr requires exactly one explicit repo_url (no comma-separated list, no omission)" as const;

export const LAND_CHANGE_ERR_EMPTY_PAT =
  "create_pr requires a non-empty pat" as const;

export const LAND_CHANGE_ERR_IDENTITY = "identity_mismatch" as const;

export const LAND_CHANGE_ERR_NO_PUSH = "no_push_permission" as const;

export const LAND_CHANGE_ERR_RATE_LIMITED = "rate_limited" as const;

export type LandChangeHttpError =
  | typeof LAND_CHANGE_ERR_UNAUTH
  | typeof LAND_CHANGE_ERR_MULTI_REPO
  | typeof LAND_CHANGE_ERR_EMPTY_PAT
  | typeof LAND_CHANGE_ERR_IDENTITY
  | typeof LAND_CHANGE_ERR_NO_PUSH
  | typeof LAND_CHANGE_ERR_RATE_LIMITED;
