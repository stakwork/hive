/**
 * `createPr` — write adapter that lands an approved code-change diff as a PR
 * via the swarm's shipped `create_pr` contract.
 *
 * ## Identity
 *
 * Resolves credentials via `getGithubUsernameAndPAT(userId, workspaceSlug)`
 * (workspace-scoped, org-bound token).  If the workspace has no
 * `sourceControlOrg` the fallback is personal-OAuth, which is refused here
 * (`no_access`) because that token is not bound to the org's GitHub App
 * installation and could push outside the org's delegated boundary.
 *
 * Before spending a container, identity is verified directly against GitHub:
 * `GET /user` with the resolved token.  A login mismatch is refused as
 * `identity_mismatch` locally, and `username` is always forwarded in the
 * swarm request body so the swarm's own pre-flight comparison fires as a
 * fast-failing 400 if there is drift.
 *
 * ## Transport
 *
 * Plain `fetch` via the same pattern as `initiateRun` in `askTools.ts`.
 * `swarmCmdRequest`/`getSwarmCmdJwt` are NOT used — that path may set
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` process-wide (`SWARM_CMD_ALLOW_INSECURE`)
 * and a PAT must never ride an unverified TLS connection.
 *
 * ## Fidelity
 *
 * The approved diff bytes are re-verified against `diffSha256` before dispatch.
 * The agent is instructed to `apply_patch` them verbatim, then call
 * `create_pr` with the approved title and body, which ride the prompt as
 * labelled `TITLE:` / `BODY:` / `DIFF:` blocks (not inline quoted values, so
 * a quote character in either cannot corrupt the instruction).  PR title
 * always carries the `[Jamie]` prefix — the durable Jamie discriminator.
 *
 * ## URL validation
 *
 * Before any artifact is persisted, `pr.url` is parsed and required to have
 * host `github.com` with an `owner/repo` path matching the approved
 * `repositoryUrl` exactly.  A mismatch drops the delivery and refuses.
 *
 * ## Hardening
 *
 * `hardenPrResult()` shape-validates the raw swarm response against
 * `LandChangeResult`, re-applies byte/file caps, and re-runs the secret scan.
 * EVERY path that yields a success runs it — the fresh success and the
 * `already_landed` replay alike (see `_hardenAndBuild`), because both persist
 * a PR URL.  On `ok: false`, `pr.diff` and `error` are discarded at the
 * adapter boundary — only `{ failureCode, message }` propagates.
 *
 * ## Recovery
 *
 * `reconcilePr(claim)` resolves an outcome after a dropped connection without
 * re-dispatching:
 *   1. Re-read `GET /progress?request_id=...`
 *   2. `GET /repos/{owner}/{repo}/pulls?head=<owner>:<claim.prBranch>`
 *   3. Unknown outcome — never a second dispatch.
 */

import crypto from "crypto";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { refreshAndUpdateAccessTokens } from "@/lib/githubApp";
import { enforceDiffCaps, scanForSecrets } from "@/lib/github/diffHygiene";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import {
  isAlreadyLanded,
  landedPr,
  LAND_CHANGE_ERR_UNAUTH,
  LAND_CHANGE_ERR_MULTI_REPO,
  LAND_CHANGE_ERR_EMPTY_PAT,
  LAND_CHANGE_ERR_IDENTITY,
  LAND_CHANGE_ERR_NO_PUSH,
  LAND_CHANGE_ERR_RATE_LIMITED,
  type LandChangeResult,
  type LandChangeSuccess,
  type LandChangeFailureCode,
} from "@/services/swarm/landChangeContract";
import { logger } from "@/lib/logger";

// ─── Constants ────────────────────────────────────────────────────────────

/** PR title prefix — the durable Jamie discriminator. */
const JAMIE_PREFIX = "[Jamie] ";

/** Swarm branch naming convention (from the shipped swarm code). */
const SWARM_BRANCH_PREFIX = "swarm/swarm-change-";

// ─── Public result types ───────────────────────────────────────────────────

export type CreatePrSuccess = {
  ok: true;
  prUrl: string;
  prNumber: number;
  branch: string;
  baseBranch: string;
  headSha: string;
  filesChanged: number;
  repositoryUrl: string;
  /** Whether the file-path set in the returned diff matched the approved diff. */
  pathSetVerified: boolean;
  /** Paths present in the swarm result but absent from the approved diff (empty on perfect match). */
  unapprovedPaths: string[];
};

export type CreatePrFailure = {
  ok: false;
  failureCode: string;
  message: string;
};

export type CreatePrResult = CreatePrSuccess | CreatePrFailure;

/**
 * Successful dispatch of an async `create_pr` run. The terminal outcome
 * arrives later on the code-change webhook (or via the reconcile cron);
 * this only asserts the swarm accepted the run and returned identifiers.
 */
export type CreatePrDispatched = {
  ok: true;
  dispatched: true;
  requestId: string;
  /** Exact head branch from the dispatch response's `pr_branch` (null on older swarms). */
  prBranch: string | null;
};

export type CreatePrDispatchResult = CreatePrDispatched | CreatePrFailure;

export type ReconcileOutcome =
  | { outcome: "landed"; prUrl: string; prNumber: number }
  | { outcome: "unknown" };

// ─── Claim type (persisted on the Task at dispatch time) ──────────────────

export interface CreatePrClaim {
  requestId: string;
  repositoryUrl: string;
  /** The approving userId — used for GitHub authorship check during reconcile. */
  userId: string;
  workspaceSlug: string;
  /**
   * Exact head branch the swarm will push, from the dispatch response's
   * `pr_branch` field. Used VERBATIM in reconcile's GitHub `head` filter,
   * never derived: the swarm names branches from its own runId, which is
   * independent of `requestId`.
   */
  prBranch?: string;
  /**
   * Legacy pre-webhook claims only: `requestId` copied verbatim. The branch
   * is derived from an independent swarm-side runId, so this never matched
   * a real branch — kept solely so old persisted claims still parse.
   */
  runIdPrefix?: string;
  /** File paths of the approved diff, for path-set verification at completion. */
  approvedPaths?: string[];
  /** Conversation whose stored approvalResult row the terminal patch rewrites. */
  conversationId?: string;
  /** Proposal id keying that row's `approvalResult.proposalId`. */
  proposalId?: string;
}

// ─── Classification table ─────────────────────────────────────────────────

/**
 * Map every possible failure surface to a `{ failureCode, message }` pair.
 * Raw git stderr and the swarm's `error` string are NEVER passed through.
 */
function classify(
  failureCode: LandChangeFailureCode | string,
): { failureCode: string; message: string } {
  switch (failureCode) {
    case "patch_conflict":
      return {
        failureCode,
        message:
          "The patch could not be applied cleanly — the target files have " +
          "changed since the preview was generated. " +
          "Regenerate the preview to get a fresh diff.",
      };
    case "push_rejected":
      return {
        failureCode,
        message:
          "The branch push was rejected by GitHub. " +
          "Check branch protection rules and retry.",
      };
    case "pr_create_failed":
      return {
        failureCode,
        message:
          "The pull request could not be created. " +
          "The branch was pushed but the PR creation step failed. " +
          "Check your GitHub App permissions.",
      };
    case "base_repo_vanished":
      return {
        failureCode,
        message:
          "The target repository could not be reached during PR creation. " +
          "Verify the repository still exists and retry.",
      };
    case "no_changes":
      return {
        failureCode,
        message:
          "The patch produced no effective changes after applying — " +
          "the code may already be at the desired state.",
      };
    case "secrets_detected":
      return {
        failureCode,
        message:
          "The swarm's secret scanner detected a potential credential in the " +
          "diff. The PR was not created. Review the diff manually.",
      };
    case "change_too_large":
      return {
        failureCode,
        message:
          "The change exceeds the swarm's size limits. " +
          "Split the change into smaller pieces.",
      };
    case "identity_mismatch":
      return {
        failureCode,
        message:
          "The GitHub identity on the token does not match the expected username. " +
          "Re-authenticate via GitHub App and retry.",
      };
    case "no_push_permission":
      return {
        failureCode,
        message:
          "The token does not have push access to this repository. " +
          "Ensure the GitHub App installation covers the target repo.",
      };
    case "aborted":
      return {
        failureCode,
        message:
          "The PR creation was aborted by the swarm. " +
          "This may be a transient error — retry once.",
      };
    case "already_landed":
      return {
        failureCode,
        message:
          "The swarm indicates this change was already landed in a previous run.",
      };
    case "create_pr_not_called":
      return {
        failureCode,
        message:
          "The swarm run finished without calling the create_pr tool, so no " +
          "verified pull request was recorded. A branch or PR may still exist " +
          "on the repository — check it before retrying.",
      };
    // HTTP admission codes
    case "no_access":
      return {
        failureCode,
        message:
          "Only org-scoped GitHub App tokens are accepted for PR creation. " +
          "Connect the GitHub App to this workspace in Settings.",
      };
    case "rate_limited":
      return {
        failureCode,
        message:
          "The swarm has hit its PR creation rate limit. Retry in an hour.",
      };
    case "swarm_unauth":
      return {
        failureCode,
        message:
          "The swarm's API token is not configured. Contact your administrator.",
      };
    case "swarm_bad_request":
      return {
        failureCode,
        message:
          "The swarm rejected the request parameters. " +
          "This is a Hive bug — please report it.",
      };
    default:
      return {
        failureCode: "unknown",
        message: "An unexpected error occurred during PR creation.",
      };
  }
}

function classifyHttpAdmission(
  status: number,
  body: Record<string, unknown>,
): CreatePrFailure {
  const errorField = (body.error as string | undefined) ?? "";
  const failureField = (body.failure as string | undefined) ?? "";

  if (status === 401 || errorField.includes(LAND_CHANGE_ERR_UNAUTH)) {
    return { ok: false, ...classify("swarm_unauth") };
  }
  if (status === 429 || failureField === LAND_CHANGE_ERR_RATE_LIMITED) {
    return { ok: false, ...classify("rate_limited") };
  }
  if (status === 403 || failureField === LAND_CHANGE_ERR_NO_PUSH) {
    return { ok: false, ...classify("no_push_permission") };
  }
  if (
    status === 400 &&
    (failureField === LAND_CHANGE_ERR_IDENTITY ||
      errorField.includes("identity_mismatch"))
  ) {
    return { ok: false, ...classify("identity_mismatch") };
  }
  if (
    status === 400 &&
    (errorField.includes(LAND_CHANGE_ERR_EMPTY_PAT) ||
      errorField.includes(LAND_CHANGE_ERR_MULTI_REPO))
  ) {
    return { ok: false, ...classify("swarm_bad_request") };
  }
  return { ok: false, ...classify("unknown") };
}

// ─── URL validation ────────────────────────────────────────────────────────

/**
 * Parse and validate a PR URL returned by the swarm before persisting it.
 * Requires host `github.com` and `owner/repo` matching the approved
 * `repositoryUrl` exactly.  Returns null on any mismatch.
 *
 * This is critical: the URL is later used by `pr-monitor.ts` to perform
 * branch writes with the workspace owner's token — a spoofed or wrong URL
 * becomes a write against an unrelated repo.
 */
function validatePrUrl(
  prUrl: string,
  approvedRepositoryUrl: string,
): boolean {
  try {
    const parsed = new URL(prUrl);
    if (parsed.hostname !== "github.com") return false;

    const { owner: approvedOwner, repo: approvedRepo } =
      parseGithubOwnerRepo(approvedRepositoryUrl);

    // Path is /owner/repo/pull/N
    const parts = parsed.pathname.replace(/^\/+/, "").split("/");
    if (parts.length < 4) return false;
    const [urlOwner, urlRepo] = parts;

    return (
      urlOwner.toLowerCase() === approvedOwner.toLowerCase() &&
      urlRepo.toLowerCase() === approvedRepo.toLowerCase()
    );
  } catch {
    return false;
  }
}

// ─── hardenPrResult ────────────────────────────────────────────────────────

/**
 * Shape-validate the raw swarm response, re-apply caps, and re-run the
 * secret scan.  Returns the hardened success or a failure.
 *
 * A cap/shape violation drops the delivery (does not truncate).
 * A secret hit flags but does not silently persist.
 */
function hardenPrResult(
  raw: unknown,
  approvedRepositoryUrl: string,
): { ok: true; hardened: LandChangeSuccess } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "Response is not an object." };
  }
  const r = raw as Record<string, unknown>;

  // Required string fields
  for (const key of ["url", "branch", "base", "headSha", "diff"] as const) {
    if (typeof r[key] !== "string") {
      return { ok: false, reason: `Missing or non-string field: ${key}` };
    }
  }
  if (typeof r.number !== "number") {
    return { ok: false, reason: "Missing or non-number field: number" };
  }
  if (typeof r.filesChanged !== "number") {
    return {
      ok: false,
      reason: "Missing or non-number field: filesChanged",
    };
  }

  const diff = r.diff as string;

  // Re-apply caps to pr.diff
  const capsResult = enforceDiffCaps(diff);
  if (!capsResult.ok) {
    return {
      ok: false,
      reason: `Returned diff exceeds size limits (${capsResult.code}).`,
    };
  }

  // Re-run secret scan over the returned diff
  const secretsResult = scanForSecrets(diff);
  if (!secretsResult.ok) {
    return {
      ok: false,
      reason:
        "Returned diff contains patterns matching known credentials. " +
        "The PR was created but the diff artifact is withheld.",
    };
  }

  // URL validation
  const url = r.url as string;
  if (!validatePrUrl(url, approvedRepositoryUrl)) {
    return {
      ok: false,
      reason:
        `PR URL '${url}' does not match the approved repository ` +
        `'${approvedRepositoryUrl}'. Dropping delivery.`,
    };
  }

  return {
    ok: true,
    hardened: {
      ok: true,
      url,
      number: r.number as number,
      branch: r.branch as string,
      base: r.base as string,
      headSha: r.headSha as string,
      diff,
      filesChanged: r.filesChanged as number,
    },
  };
}

// ─── File-path set comparison ─────────────────────────────────────────────

function extractFilePaths(diff: string): Set<string> {
  const paths = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim().replace(/^b\//, "");
      if (path !== "/dev/null") paths.add(path);
    } else if (line.startsWith("--- ")) {
      const path = line.slice(4).trim().replace(/^a\//, "");
      if (path !== "/dev/null") paths.add(path);
    }
  }
  return paths;
}

// ─── Swarm credential resolution ─────────────────────────────────────────

async function resolveSwarmCredentials(
  workspaceSlug: string,
  userId: string,
): Promise<{
  swarmUrl: string;
  swarmApiKey: string;
  workspaceId: string;
  hasSourceControlOrg: boolean;
} | null> {
  const workspace = await db.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: {
      id: true,
      sourceControlOrg: { select: { id: true } },
      swarm: { select: { swarmUrl: true, swarmApiKey: true } },
      members: {
        where: { userId },
        select: { userId: true },
      },
    },
  });
  if (!workspace?.swarm?.swarmUrl || !workspace.swarm.swarmApiKey) {
    return null;
  }

  // Authorization: the caller must be a member of this workspace before
  // swarm credentials (which include encrypted API keys) are decrypted.
  if (workspace.members.length === 0) {
    return null;
  }

  const encSvc = EncryptionService.getInstance();
  const swarmApiKey = encSvc.decryptField(
    "swarmApiKey",
    workspace.swarm.swarmApiKey,
  );
  const swarmUrlRaw = workspace.swarm.swarmUrl;
  const swarmUrlObj = new URL(swarmUrlRaw);
  const swarmUrl = swarmUrlRaw.includes("localhost")
    ? "http://localhost:3355"
    : `https://${swarmUrlObj.hostname}:3355`;

  return {
    swarmUrl,
    swarmApiKey,
    workspaceId: workspace.id,
    hasSourceControlOrg: !!workspace.sourceControlOrg,
  };
}

// ─── createPr ─────────────────────────────────────────────────────────────

/**
 * Dispatch an approved code-change diff to the swarm's `create_pr` and
 * RETURN — the terminal result is delivered to `webhookUrl` by the swarm
 * (`postTerminalWebhook`), processed by `/api/code-change/webhook`, with the
 * reconcile cron as the backstop for a webhook that never arrives. There is
 * no in-process result poll: the approval HTTP request is no longer held
 * open for the life of the PR run.
 *
 * @param userId         — The approving user's NextAuth id.
 * @param workspaceSlug  — Target workspace slug.
 * @param repositoryUrl  — Validated repository URL (must match DB).
 * @param title          — PR title (without [Jamie] prefix — added here).
 * @param body           — PR body.
 * @param approvedDiff   — The diff bytes approved by the user.
 * @param diffSha256     — SHA-256 hex of the approved diff for re-verification.
 * @param webhookUrl     — Swarm-reachable terminal-callback URL. Carries the
 *                         per-claim bearer token in its query string (the
 *                         swarm sends no custom headers) — NEVER log it.
 */
export async function createPr(params: {
  userId: string;
  workspaceSlug: string;
  repositoryUrl: string;
  title: string;
  body: string;
  approvedDiff: string;
  diffSha256: string;
  webhookUrl: string;
  /**
   * Invoked once, the moment the swarm returns a `request_id`. The claim must
   * be durably recorded before `createPr` returns: the terminal webhook can
   * arrive at any moment after dispatch, and the receiver resolves the claim
   * by the receipt this persists.
   *
   * Awaited, and a throw here is fatal to the dispatch by design — a claim we
   * failed to record is exactly the unrecoverable state this exists to
   * prevent.
   */
  onDispatch?: (claim: CreatePrClaim) => Promise<void> | void;
}): Promise<CreatePrDispatchResult> {
  const {
    userId,
    workspaceSlug,
    repositoryUrl,
    title,
    body,
    approvedDiff,
    diffSha256,
    webhookUrl,
    onDispatch,
  } = params;

  // ── 1. Re-verify diff integrity ─────────────────────────────────────
  const actualSha = crypto
    .createHash("sha256")
    .update(approvedDiff, "utf8")
    .digest("hex");
  if (actualSha !== diffSha256) {
    logger.error("[createPr] diffSha256 mismatch — refusing dispatch", "createPr", {
      userId,
      workspaceSlug,
      repositoryUrl,
    });
    return {
      ok: false,
      failureCode: "patch_conflict",
      message:
        "The approved diff does not match the recorded checksum. " +
        "Regenerate the preview and approve again.",
    };
  }

  // ── 2. Swarm credentials ────────────────────────────────────────────
  const swarmCreds = await resolveSwarmCredentials(workspaceSlug, userId);
  if (!swarmCreds) {
    return {
      ok: false,
      failureCode: "swarm_unauth",
      message: "Swarm not configured for this workspace.",
    };
  }
  const { swarmUrl, swarmApiKey, hasSourceControlOrg } = swarmCreds;

  // ── 3. Identity — refuse personal-OAuth fallback ────────────────────
  // `getGithubUsernameAndPAT` returns the workspace-scoped org token when
  // `workspace.sourceControlOrg` is set, otherwise falls back to the user's
  // personal OAuth token. We detect and refuse the fallback case.
  if (!hasSourceControlOrg) {
    return { ok: false, ...classify("no_access") };
  }

  const githubProfile = await getGithubUsernameAndPAT(userId, workspaceSlug);
  if (!githubProfile) {
    return { ok: false, ...classify("no_access") };
  }

  // Attempt a transparent token refresh via the GitHub App refresh flow so
  // an expired token is not surfaced as `no_access`.
  let { username, token: pat } = githubProfile;
  try {
    const refreshed = await refreshAndUpdateAccessTokens(userId);
    if (refreshed) {
      // Re-fetch the updated token.
      const updated = await getGithubUsernameAndPAT(userId, workspaceSlug);
      if (updated) pat = updated.token;
    }
  } catch {
    // Non-fatal: proceed with the existing token.
  }

  // ── 4. Verify identity against GitHub ──────────────────────────────
  // Call `GET /user` with the resolved token and refuse locally if the
  // returned login doesn't match the stored `githubUsername`. This fires
  // BEFORE spending a container.
  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (userRes.ok) {
      const userData = (await userRes.json()) as { login?: string };
      const tokenLogin = (userData.login ?? "").toLowerCase();
      const storedLogin = username.toLowerCase();
      if (tokenLogin && tokenLogin !== storedLogin) {
        logger.warn("[createPr] GitHub login mismatch — refusing", "createPr", {
          userId,
          workspaceSlug,
          tokenLogin,
          storedLogin,
        });
        return { ok: false, ...classify("identity_mismatch") };
      }
    }
  } catch {
    // Non-fatal: let the swarm's own identity check catch drift.
  }

  // ── 5. PR title with [Jamie] prefix + body ─────────────────────────
  const normalizedTitle = title.replace(/[\r\n]+/g, " ").trim();
  const prTitle = normalizedTitle.startsWith(JAMIE_PREFIX)
    ? normalizedTitle
    : `${JAMIE_PREFIX}${normalizedTitle}`;
  // The approved body is forwarded verbatim (CRLF normalized only). Both
  // ride the prompt as labelled blocks rather than inline quoted values —
  // a title or body containing a double quote must not corrupt the
  // instruction the swarm-side agent parses.
  const prBody = body.replace(/\r\n/g, "\n").trimEnd();

  // ── 6. Dispatch to swarm via plain fetch ───────────────────────────
  // `create_pr` is registered in `toolsConfig` so the swarm's `repo_agent`
  // activates it.  The `username` is sent in the body so the swarm's own
  // pre-flight identity check fires as a fast-failing 400 if there is drift.
  const requestBody = {
    repo_url: repositoryUrl,
    username,
    pat, // Never logged — redacted at the adapter boundary on any error path.
    // Terminal fan-back: the swarm POSTs `{ request_id, status, result|error }`
    // here on completion/failure (3 attempts, plus boot-time orphan sweep).
    // The URL embeds the per-claim token — never logged.
    webhookUrl,
    prompt:
      `Apply the following unified diff verbatim using apply_patch, ` +
      `then call create_pr with exactly the title and body given below.\n\n` +
      `TITLE:\n${prTitle}\n\n` +
      `BODY:\n${prBody}\n\n` +
      `DIFF:\n${approvedDiff}`,
    toolsConfig: {
      create_pr: true,
    },
  };

  let dispatchResponse: Response;
  let requestId: string;
  try {
    dispatchResponse = await fetch(`${swarmUrl}/repo/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": swarmApiKey,
      },
      body: JSON.stringify(requestBody),
      // Admission is fast (pre-flight checks only) — a hung connection here
      // must not silently burn the route budget.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    logger.error("[createPr] Network error dispatching to swarm", "createPr", {
      userId,
      workspaceSlug,
      repositoryUrl,
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      ok: false,
      failureCode: "unknown",
      message: "Network error reaching the swarm. Retry once.",
    };
  }

  if (!dispatchResponse.ok) {
    let bodyJson: Record<string, unknown> = {};
    try {
      bodyJson = await dispatchResponse.json();
    } catch {
      /* empty body */
    }
    return classifyHttpAdmission(dispatchResponse.status, bodyJson);
  }

  const dispatchData = (await dispatchResponse.json()) as {
    request_id?: string;
    pr_branch?: string;
  };
  requestId = dispatchData.request_id ?? "";
  if (!requestId) {
    return {
      ok: false,
      failureCode: "unknown",
      message: "Swarm did not return a request_id.",
    };
  }

  // The exact head branch the run will push — the swarm derives it from its
  // own runId (independent of `request_id`), so this response field is the
  // ONLY way to know it. Stored verbatim in the claim for reconcile's GitHub
  // `head` filter; null on a swarm build predating the field.
  const prBranch =
    typeof dispatchData.pr_branch === "string" && dispatchData.pr_branch
      ? dispatchData.pr_branch
      : null;

  // ── 6b. Persist the claim receipt, then return ──────────────────────
  // The terminal webhook can arrive at any moment from here on. The receiver
  // resolves the claim by this receipt, so it must be durable before we
  // return.
  if (onDispatch) {
    try {
      await onDispatch({
        requestId,
        repositoryUrl,
        userId,
        workspaceSlug,
        ...(prBranch ? { prBranch } : {}),
        approvedPaths: [...extractFilePaths(approvedDiff)],
      });
    } catch (e) {
      logger.error("[createPr] onDispatch failed after dispatch", "createPr", {
        userId,
        workspaceSlug,
        repositoryUrl,
        error: e instanceof Error ? e.message : String(e),
      });
      return {
        ok: false,
        failureCode: "unknown",
        message:
          "The PR request was dispatched but could not be recorded. " +
          "Check the repository for a new pull request before retrying.",
      };
    }
  }

  return { ok: true, dispatched: true, requestId, prBranch };
}

// ─── Result processing ────────────────────────────────────────────────────

/**
 * Diagnostic shape summary for a non-success swarm result. `pr.diff` and
 * `error` stay discarded at the adapter boundary; keys and tool names carry
 * no payload but would have named this incident's cause (`bash`, no
 * `create_pr`) in one log line.
 */
function _logResultShape(
  branch: string,
  raw: Record<string, unknown> | null,
  landResult: Record<string, unknown> | null,
  ctx?: { requestId?: string },
): void {
  const toolUse = raw?.tool_use;
  logger.warn("[createPr] Non-success swarm result", "createPr", {
    branch,
    requestId: ctx?.requestId,
    rawKeys: raw ? Object.keys(raw) : null,
    landResultKeys: landResult ? Object.keys(landResult) : null,
    sessionId: typeof raw?.sessionId === "string" ? raw.sessionId : undefined,
    toolUse: Array.isArray(toolUse)
      ? toolUse
          .map((t) =>
            t && typeof t === "object" && "name" in (t as object)
              ? String((t as { name: unknown }).name)
              : typeof t === "string"
                ? t
                : "?",
          )
          .slice(0, 50)
      : toolUse !== undefined
        ? typeof toolUse
        : undefined,
  });
}

function _processCompletedResult(
  result: unknown,
  approvedPaths: ReadonlySet<string> | null,
  repositoryUrl: string,
  ctx?: { requestId?: string },
): CreatePrResult {
  if (!result || typeof result !== "object") {
    _logResultShape("empty-result", null, null, ctx);
    return {
      ok: false,
      failureCode: "unknown",
      message: "Swarm returned an empty result.",
    };
  }

  const raw = result as Record<string, unknown>;

  // Extract the LandChangeResult from nested `result.pr` if present,
  // otherwise treat the top level as the result.
  const landResult = (raw.pr ?? raw) as Record<string, unknown>;

  // Check `already_landed` BEFORE branching on `ok` — see contract comments.
  const typed = landResult as unknown as LandChangeResult;
  if (isAlreadyLanded(typed)) {
    if (landedPr(typed)) {
      // already_landed success replay — reuse the prior PR. This path
      // persists a PR URL exactly like a fresh success does, so it must
      // clear the same shape / URL / cap / secret checks: `hardenPrResult`
      // is what stops a wrong-repo URL from later becoming a branch write
      // by `pr-monitor.ts` under the workspace owner's token.
      return _hardenAndBuild(landResult, approvedPaths, repositoryUrl);
    }
    // already_landed failure replay.
    return { ok: false, ...classify("already_landed") };
  }

  // Normal result dispatch.
  if (!("ok" in landResult)) {
    _logResultShape("missing-ok", raw, landResult, ctx);
    return {
      ok: false,
      failureCode: "unknown",
      message: "Swarm result missing `ok` field.",
    };
  }

  if (!landResult.ok) {
    // Failure — discard `pr.diff` and `error` at the adapter boundary.
    const failureCode = (landResult.failure as LandChangeFailureCode) ?? "unknown";
    _logResultShape(`failure:${failureCode}`, raw, landResult, ctx);
    return { ok: false, ...classify(failureCode) };
  }

  // Success
  return _hardenAndBuild(landResult, approvedPaths, repositoryUrl);
}

/**
 * Harden a raw swarm success payload, then build the adapter result.
 *
 * Every path that yields a `CreatePrSuccess` — fresh success and
 * already-landed replay alike — goes through here, so no path can persist
 * a PR URL that skipped shape validation, the byte/file caps, the secret
 * re-scan, or `validatePrUrl`.
 */
function _hardenAndBuild(
  landResult: Record<string, unknown>,
  approvedPaths: ReadonlySet<string> | null,
  repositoryUrl: string,
): CreatePrResult {
  const harden = hardenPrResult(landResult, repositoryUrl);
  if (!harden.ok) {
    logger.warn("[createPr] hardenPrResult failed", "createPr", {
      reason: harden.reason,
      repositoryUrl,
    });
    return {
      ok: false,
      failureCode: "pr_create_failed",
      message: `PR created but result validation failed: ${harden.reason}`,
    };
  }

  return _buildSuccess(harden.hardened, approvedPaths, repositoryUrl);
}

function _buildSuccess(
  pr: LandChangeSuccess,
  // null ⇒ the approved path set is unavailable (legacy claim) — skip the
  // comparison rather than reporting every path as unapproved.
  approvedPaths: ReadonlySet<string> | null,
  repositoryUrl: string,
): CreatePrResult {
  const returnedPaths = extractFilePaths(pr.diff);
  const unapprovedPaths: string[] = [];
  if (approvedPaths) {
    for (const p of returnedPaths) {
      if (!approvedPaths.has(p)) unapprovedPaths.push(p);
    }
  }
  const pathSetVerified = unapprovedPaths.length === 0;

  if (!pathSetVerified) {
    logger.warn("[createPr] Returned diff contains unapproved paths", "createPr", {
      unapprovedPaths,
      repositoryUrl,
    });
  }

  return {
    ok: true,
    prUrl: pr.url,
    prNumber: pr.number,
    branch: pr.branch,
    baseBranch: pr.base,
    headSha: pr.headSha,
    filesChanged: pr.filesChanged,
    repositoryUrl,
    pathSetVerified,
    unapprovedPaths,
  };
}

// ─── reconcilePr ─────────────────────────────────────────────────────────

/**
 * Recover the outcome of a PR creation whose webhook never arrived.
 *
 * Never re-dispatches. Three resolution channels in priority order:
 *   1. `GET /progress?request_id=...` — swarm's own result cache.
 *   2. `GET /repos/{owner}/{repo}/pulls?head=<owner>:<claim.prBranch>` —
 *      GitHub direct query using the EXACT branch from the dispatch
 *      response. Skipped for legacy claims without `prBranch` (their
 *      `runIdPrefix` never matched a real branch — the swarm derives the
 *      branch from its own runId, not from `request_id`).
 *   3. Unknown outcome — caller must surface this to the user.
 */
export async function reconcilePr(claim: CreatePrClaim): Promise<ReconcileOutcome> {
  const { requestId, repositoryUrl, userId, workspaceSlug, prBranch } = claim;
  const approvedPaths = Array.isArray(claim.approvedPaths)
    ? new Set(claim.approvedPaths)
    : null;

  // ── 1. Re-read swarm progress ───────────────────────────────────────
  const swarmCreds = await resolveSwarmCredentials(workspaceSlug, userId);
  if (swarmCreds) {
    try {
      const progressRes = await fetch(
        `${swarmCreds.swarmUrl}/progress?request_id=${encodeURIComponent(requestId)}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": swarmCreds.swarmApiKey,
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (progressRes.ok) {
        const data = (await progressRes.json()) as {
          status: string;
          result?: unknown;
        };
        if (data.status === "completed" && data.result) {
          const prResult = _processCompletedResult(
            data.result,
            approvedPaths,
            repositoryUrl,
            { requestId },
          );
          if (prResult.ok) {
            return { outcome: "landed", prUrl: prResult.prUrl, prNumber: prResult.prNumber };
          }
        }
      }
    } catch {
      /* continue to GitHub fallback */
    }
  }

  // ── 2. GitHub direct query (requires the exact branch) ─────────────
  try {
    if (!prBranch || !prBranch.startsWith(SWARM_BRANCH_PREFIX)) {
      // Legacy claim (no pr_branch recorded) or an unexpected branch shape —
      // GitHub's `head` filter is an exact match, so guessing yields nothing.
      throw new Error("No usable prBranch on claim");
    }
    const githubProfile = await getGithubUsernameAndPAT(userId, workspaceSlug);
    if (!githubProfile) throw new Error("No profile");

    const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);
    const headFilter = `${owner}:${prBranch}`;
    const searchUrl =
      `https://api.github.com/repos/${encodeURIComponent(owner)}/` +
      `${encodeURIComponent(repo)}/pulls?head=${encodeURIComponent(headFilter)}&state=open&per_page=5`;

    const searchRes = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${githubProfile.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (searchRes.ok) {
      const pulls = (await searchRes.json()) as Array<{
        number: number;
        html_url: string;
        head: { ref: string };
        user: { login: string };
      }>;

      for (const pull of pulls) {
        // Validate branch naming and URL before persisting.
        if (!pull.head.ref.startsWith(SWARM_BRANCH_PREFIX)) continue;
        if (!validatePrUrl(pull.html_url, repositoryUrl)) continue;

        return {
          outcome: "landed",
          prUrl: pull.html_url,
          prNumber: pull.number,
        };
      }
    }
  } catch {
    /* fall through to unknown */
  }

  // ── 3. Unknown outcome — never a failure, never a second dispatch ───
  return { outcome: "unknown" };
}

// Re-exported for the webhook/reconcile completion path and tests:
// pure functions over a swarm payload / diff.
export { hardenPrResult, _processCompletedResult, extractFilePaths };
