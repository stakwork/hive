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
// successful (200) HTTP response whose `ok` field is `false`. They are
// DISTINCT from HTTP-level admission errors (see below).
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

// ─── Union ────────────────────────────────────────────────────────────────

export type LandChangeResult = LandChangeSuccess | LandChangeFailure;

// ─── HTTP admission errors (separate channel from LandChangeResult) ───────
//
// These arrive as non-200 HTTP responses BEFORE the `create_pr` handler
// runs — they are not part of LandChangeResult and never appear in its
// `failure` field.
//
// Status → canonical body string:
//   401  → LAND_CHANGE_ERR_UNAUTH        (API_TOKEN not set on swarm)
//   400  → LAND_CHANGE_ERR_MULTI_REPO    (comma-separated / missing repo_url)
//   400  → LAND_CHANGE_ERR_EMPTY_PAT     (non-empty pat required)
//   400  → LAND_CHANGE_ERR_IDENTITY      (identity_mismatch admission check)
//   403  → LAND_CHANGE_ERR_NO_PUSH       (no_push_permission admission check)
//   429  → LAND_CHANGE_ERR_RATE_LIMITED  (rate_limited — never in LandChangeFailureCode)

export const LAND_CHANGE_ERR_UNAUTH =
  "API_TOKEN is not set" as const;

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
