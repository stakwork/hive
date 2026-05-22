import { randomBytes, randomUUID } from "node:crypto";

import {
  bytesToHex,
  encodeMacaroon,
  hexToBytes,
  signInvocation,
  signUserAuthorizationSingle,
  type Ed25519PubKey,
  type InvocationUnsigned,
  type UserAuthorizationUnsigned,
} from "gatekey";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

import {
  MACAROON_DEFAULT_MAX_COST_USD,
  MACAROON_DEFAULT_MAX_STEPS,
  MACAROON_DEFAULT_TTL_SECONDS,
  MACAROON_ISSUER_LOG_TAG,
} from "./constants";
import { ensureMacaroonOrgKeys } from "./macaroon-org-keys";
import { ensureMacaroonUserKeys } from "./macaroon-user-keys";
import { buildBifrostName } from "./reconciler";

/**
 * Phase-4/11 macaroon issuer.
 *
 * Custodial / phase-1 happy path:
 *
 * ```
 * org_id          ←  SourceControlOrg.macaroonOrgId  (e.g. "gh_stakwork")
 * org_sig         ←  signUserAuthorizationSingle(ua, orgPrivkey)
 * user_pubkey     ←  User.macaroonUserPubkey         (ed25519)
 * user_sig        ←  signInvocation(inv, userPrivkey)
 * agents          ←  [agentName]                     (the dim that ends up on logs.db)
 * run_id          ←  caller-supplied or fresh UUID
 * ```
 *
 * The minted macaroon goes into the `x-macaroon` HTTP header on
 * Bifrost-bound LLM calls. The gateway plugin verifies it, stamps
 * `agent-name` / `run-id` / `user-id` onto Bifrost's dimensions
 * map, and Bifrost's logging plugin records cost-per-dimension
 * into `logs.db` — that's the minimal-slice payoff: cost-per-agent
 * observability with no Redis accumulators yet.
 *
 * Phase-11 wire shape: `permissions` is gone (agents lifted to
 * top-level on UA), `invocation.realm` is gone, and no `budget`
 * block is emitted by this issuer — the swarm enforces only
 * `max_cost_usd` / `max_steps` per call. The swarm's self-identity
 * (`realm_id`) lives on the trust registry, set by the trust
 * reconciler from `Workspace.slug`; the issuer doesn't touch it.
 * See `gateway/plans/phases/phase-11-symmetric-recursive-authorization.md`.
 *
 * Failure posture: the issuer throws. Call sites wrap in a
 * `try`/`catch` and proceed without the header on failure (shadow
 * mode — see `enforce_macaroons` in the plugin config). Never let
 * a mint failure break an otherwise-healthy LLM call.
 */

export interface MintInvocationOptions {
  /**
   * `Workspace.id` — the immutable lookup key. Used to resolve the
   * owning `SourceControlOrg` so we know which org keypair to sign
   * with. Phase 11 dropped the `realm` field from the macaroon
   * wire shape, so the workspace's slug no longer travels on the
   * macaroon itself; the swarm's self-identity is registered on
   * the trust registry separately (see `trust-reconciler.ts`).
   */
  workspaceId: string;

  /** `User.id`. */
  userId: string;

  /**
   * The agent name that drives the `agent-name` dim. Pick names that
   * roughly match what an operator would want to see as a row in
   * "cost by agent" — `"ask-repo-agent"`, `"diagram-creator"`,
   * `"canvas-runner"`, etc. Currently free-form; a future phase
   * pins the legal set against the agent registry.
   */
  agentName: string;

  /**
   * Optional caller-supplied run id (e.g. a Hive `StakworkRun` id).
   * Auto-generates a UUID v4 when absent so every invocation gets a
   * unique handle for correlation.
   */
  runId?: string;

  /** Per-invocation budget cap. Defaults to {@link MACAROON_DEFAULT_MAX_COST_USD}. */
  maxCostUsd?: number;

  /** Per-invocation step cap. Defaults to {@link MACAROON_DEFAULT_MAX_STEPS}. */
  maxSteps?: number;

  /**
   * Macaroon lifetime in seconds — applies to BOTH the
   * `user_authorization.exp` and `invocation.exp`. Defaults to
   * {@link MACAROON_DEFAULT_TTL_SECONDS}. Keep short: a leaked
   * macaroon is bounded by this.
   */
  ttlSeconds?: number;
}

export interface MintedMacaroon {
  /** Base64url-encoded macaroon. Send as `x-macaroon: <token>`. */
  token: string;
  /** Resolved org_id (e.g. `"gh_stakwork"`). */
  orgId: string;
  /**
   * The immutable `User.id` (cuid). Echoed back for caller-side
   * logging and as the key for any Hive-side bookkeeping. Distinct
   * from {@link macaroonUserId} below: this is the lookup handle;
   * the macaroon claim is the human-readable form.
   */
  userId: string;
  /**
   * The `user_authorization.user_id` that ended up on the wire —
   * `{githubLogin}-{userId}` when we have a login, otherwise the
   * bare `userId`. Matches `buildBifrostName` so the same identifier
   * shape appears in Bifrost admin UI, `logs.db` dimensions, and
   * macaroon claims. Use this when grepping logs.
   */
  macaroonUserId: string;
  /** Echoed back for caller-side logging. */
  agentName: string;
  /** Either the caller-supplied or auto-generated run id. */
  runId: string;
  /** UTC RFC3339 timestamp for the macaroon's `exp`. Caller logs this. */
  expiresAt: string;
}

export class MacaroonIssuerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MacaroonIssuerError";
  }
}

/**
 * Mint a complete invocation macaroon for one LLM call.
 *
 * Three DB reads + two keygens-or-decrypts in the worst case (first
 * call for a given user/org); two DB reads + two decrypts in the
 * steady state. The two key reads run concurrently — see
 * `Promise.all` below — so the wall-clock cost is dominated by a
 * single round-trip's worth of latency.
 *
 * Pure function from the caller's perspective: no side effects other
 * than the one-time key autogen if missing.
 */
export async function mintInvocationMacaroon(
  opts: MintInvocationOptions,
): Promise<MintedMacaroon> {
  const {
    workspaceId,
    userId,
    agentName,
    runId = randomUUID(),
    maxCostUsd = MACAROON_DEFAULT_MAX_COST_USD,
    maxSteps = MACAROON_DEFAULT_MAX_STEPS,
    ttlSeconds = MACAROON_DEFAULT_TTL_SECONDS,
  } = opts;

  if (!workspaceId) throw new MacaroonIssuerError("workspaceId is required");
  if (!userId) throw new MacaroonIssuerError("userId is required");
  if (!agentName) throw new MacaroonIssuerError("agentName is required");

  // 1. Resolve workspace → source-control org, and pull the user's
  // GitHub login alongside so we can mint a human-readable
  // `user_authorization.user_id`. Mirrors the lookup in
  // `ensureBifrostTrust` so the two stay in sync about which org
  // owns which workspace, and the lookup in `reconciler.ts` for the
  // login (same `buildBifrostName` shape ends up on the wire in
  // both places).
  const [ws, userRow] = await Promise.all([
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, sourceControlOrgId: true },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: {
        githubAuth: { select: { githubUsername: true } },
      },
    }),
  ]);
  if (!ws) {
    throw new MacaroonIssuerError(`Workspace ${workspaceId} not found`);
  }
  if (!ws.sourceControlOrgId) {
    throw new MacaroonIssuerError(
      `Workspace ${workspaceId} has no sourceControlOrgId; cannot mint macaroon`,
    );
  }

  // `{login}-{userId}` when we have a login, otherwise bare `userId`.
  // The trailing cuid is what makes the claim immutable and unique
  // forever; the leading login is a grep-friendly display label so
  // operators reading `logs.db` can eyeball who spent what. Identity-
  // keyed bookkeeping (key lookup, locks, DB writes) stays on the
  // raw `userId` — see `ensureMacaroonUserKeys` below.
  const macaroonUserId = buildBifrostName(
    userId,
    userRow?.githubAuth?.githubUsername ?? null,
  );

  // 2. Fetch (or autogen) org + user keypairs in parallel. Both are
  // idempotent and individually locked; running them concurrently
  // shaves one round-trip off the first call for a new (org, user)
  // pair.
  const [orgKeys, userKeys] = await Promise.all([
    ensureMacaroonOrgKeys(ws.sourceControlOrgId),
    ensureMacaroonUserKeys(userId),
  ]);

  // We need the org privkey bytes too — `ensureMacaroonOrgKeys` only
  // returns the pubkey + id (the privkey stays inside that module).
  // Re-read + decrypt here so the secret is only in memory across one
  // signing call.
  const orgPrivkey = await fetchAndDecryptOrgPrivkey(ws.sourceControlOrgId);

  // 3. Build + sign the `user_authorization` layer (org → user).
  // `iat`/`exp` cover the full macaroon lifetime; in phase 1 (no
  // pre-signed UAs) every mint produces a fresh one so the lifetimes
  // happen to align. Phase 2+ will pre-sign UAs at user onboarding
  // and re-use them across many invocations — `iat` will then be
  // weeks earlier than the invocation's.
  const now = new Date();
  const expDate = new Date(now.getTime() + ttlSeconds * 1000);
  const iat = now.toISOString();
  const exp = expDate.toISOString();

  const userEd25519Pubkey: Ed25519PubKey = {
    alg: "ed25519",
    key: userKeys.userPubkey,
  };

  const uaUnsigned: UserAuthorizationUnsigned = {
    // Human-readable on the wire (`{login}-{userId}`); the raw cuid
    // remains the key for everything Hive-side. See `MintedMacaroon.userId`
    // vs. `macaroonUserId` for the split.
    user_id: macaroonUserId,
    user_pubkey: userEd25519Pubkey,
    // Phase 11: `agents` is top-level on the UA (no more `permissions`
    // wrapper). Narrow exactly to what this invocation needs — no
    // reason to grant broader permissions on a custodial UA we
    // control end-to-end. No `budget` block: this issuer mints
    // simple-deployment macaroons (single-swarm, per-call caps via
    // `invocation.max_cost_usd`, no UA-cumulative or per-realm caps).
    agents: [agentName],
    iat,
    exp,
    nonce: randomNonceHex(),
  };
  const ua = signUserAuthorizationSingle(uaUnsigned, orgPrivkey);

  // 4. Build + sign the `invocation` layer (user → run).
  // Phase 11 dropped the singular `realm` field. The swarm enforces
  // its own self-identity via the trust registry (see
  // `trust-reconciler.ts`); the macaroon no longer carries one.
  const invUnsigned: InvocationUnsigned = {
    agents: [agentName],
    run_id: runId,
    max_cost_usd: maxCostUsd,
    max_steps: maxSteps,
    iat,
    exp,
    nonce: randomNonceHex(),
  };
  const invocation = signInvocation(invUnsigned, userKeys.userPrivkey);

  // 5. Assemble + base64url-encode.
  const token = encodeMacaroon({
    v: 1,
    org_id: orgKeys.macaroonOrgId,
    user_authorization: ua,
    invocation,
    attenuations: [],
  });

  logger.debug?.("Minted macaroon", MACAROON_ISSUER_LOG_TAG, {
    workspaceId,
    userId,
    macaroonUserId,
    agentName,
    runId,
    orgId: orgKeys.macaroonOrgId,
    expiresAt: exp,
    // Token is NOT logged — it's a bearer credential.
    tokenLen: token.length,
  });

  return {
    token,
    orgId: orgKeys.macaroonOrgId,
    userId,
    macaroonUserId,
    agentName,
    runId,
    expiresAt: exp,
  };
}

/**
 * Pull the encrypted org privkey out of the DB and decrypt it. Kept
 * private to this module so the decrypted secret lives only in this
 * file's stack frame, never in module scope.
 *
 * We re-read + re-decrypt here (rather than threading the secret out
 * of `ensureMacaroonOrgKeys`) for the same reason
 * `ensureMacaroonUserKeys` does it: the privkey leaving the
 * autogen module's signature would force every other consumer of
 * `MacaroonOrgKeys` to acknowledge a secret they don't want.
 *
 * If `ensureMacaroonOrgKeys` ever grows a "return privkey too" option,
 * this helper goes away.
 */
async function fetchAndDecryptOrgPrivkey(
  sourceControlOrgId: string,
): Promise<Uint8Array> {
  const row = await db.sourceControlOrg.findUnique({
    where: { id: sourceControlOrgId },
    select: { macaroonOrgPrivkey: true },
  });
  if (!row?.macaroonOrgPrivkey) {
    // Should not happen — `ensureMacaroonOrgKeys` ran above and would
    // have populated the field. Defensive.
    throw new MacaroonIssuerError(
      `SourceControlOrg ${sourceControlOrgId} has no macaroonOrgPrivkey after ensureMacaroonOrgKeys`,
    );
  }

  // Lazy import to avoid a top-of-module circular dep through
  // `@/lib/encryption` → DB → ... (matches the import shape used in
  // `macaroon-org-keys.ts`).
  const { EncryptionService } = await import("@/lib/encryption");
  const encryption = EncryptionService.getInstance();
  let privHex: string;
  try {
    privHex = encryption.decryptField(
      "macaroonOrgPrivkey",
      row.macaroonOrgPrivkey,
    );
  } catch (err) {
    throw new MacaroonIssuerError(
      `Failed to decrypt macaroon org privkey for ${sourceControlOrgId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return hexToBytes(privHex);
}

/**
 * 16-byte random nonce, hex-encoded (32 chars). Matches the Go
 * plugin's expected nonce shape (`validateNonce` in
 * `gateway/internal/auth/admin.go`). Re-used for every layer of
 * every mint.
 */
function randomNonceHex(): string {
  return bytesToHex(randomBytes(16));
}
