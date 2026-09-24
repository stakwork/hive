/**
 * Per-ACTOR secrets on a strut (strut `plans/code-change.md` §3.2) — the
 * twin of `ensureStrutDelegation` for credentials.
 *
 * A strut run's `input` is persisted on `run.start`, so a credential must
 * never ride in it. Instead hive pushes the user's token to the target
 * strut as THAT actor's secret before every dispatch:
 *
 *     PUT {lab}/actors/{actor}/secrets/{NAME}  { value }
 *
 * Strut binds the run's `secrets` to its principal (the actor), so a step
 * reading `secrets.get("GITHUB_TOKEN")` — `git/checkout` — gets the user's
 * token first, the deployment's next, env last. Push-before-dispatch is
 * what handles rotation; it is per target and idempotent (an overwrite).
 *
 * Same headers as the delegation routes: mcp's lab gate reads
 * `x-api-token`, strut's `requireApiKey` reads the bearer, both the swarm
 * API key. NEVER throws and never blocks a dispatch: a failed push is
 * logged (status only — never the value) and the run goes ahead; a private
 * clone then fails inside the run, honestly, as an `error` run.
 */

import { logger } from "@/lib/logger";
import { STRUT_DELEGATION_HTTP_TIMEOUT_MS } from "@/services/bifrost/constants";
import type { StrutLabTarget } from "@/services/bifrost/strut-delegation";

export const STRUT_ACTOR_SECRET_LOG_TAG = "STRUT_ACTOR_SECRET";

/** Strut's rule for a secret name (`isValidSecretName`). */
const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type EnsureStrutActorSecretStatus =
  /** No value to push (the user has no such credential). */
  | "skipped"
  | "pushed"
  /** The lab has no `/actors` routes (older strut). */
  | "unsupported"
  /** Attempted and failed; logged. The caller proceeds regardless. */
  | "failed";

export async function ensureStrutActorSecret(
  target: StrutLabTarget,
  actor: string,
  name: string,
  value: string | null | undefined,
): Promise<EnsureStrutActorSecretStatus> {
  if (!value) return "skipped";
  if (!SECRET_NAME_RE.test(name)) {
    logger.warn("Refusing to push an actor secret with an invalid name", STRUT_ACTOR_SECRET_LOG_TAG, { actor, name });
    return "failed";
  }
  try {
    const res = await fetch(`${target.labBase}/actors/${encodeURIComponent(actor)}/secrets/${name}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": target.swarmApiKey,
        Authorization: `Bearer ${target.swarmApiKey}`,
      },
      body: JSON.stringify({ value }),
      cache: "no-store",
      signal: AbortSignal.timeout(STRUT_DELEGATION_HTTP_TIMEOUT_MS),
    });
    if (res.status === 404) {
      logger.info("Strut lab has no actor-secret routes; skipping the push", STRUT_ACTOR_SECRET_LOG_TAG, {
        actor,
        name,
        labBase: target.labBase,
      });
      return "unsupported";
    }
    if (!res.ok) {
      logger.warn("Actor secret push failed; proceeding without it", STRUT_ACTOR_SECRET_LOG_TAG, {
        actor,
        name,
        status: res.status,
      });
      return "failed";
    }
    return "pushed";
  } catch (err) {
    logger.warn("Actor secret push threw; proceeding without it", STRUT_ACTOR_SECRET_LOG_TAG, {
      actor,
      name,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/** Push several secrets for one actor. Entries with no value are skipped. */
export async function ensureStrutActorSecrets(
  target: StrutLabTarget,
  actor: string,
  secrets: Record<string, string | null | undefined>,
): Promise<Record<string, EnsureStrutActorSecretStatus>> {
  const out: Record<string, EnsureStrutActorSecretStatus> = {};
  for (const [name, value] of Object.entries(secrets)) {
    out[name] = await ensureStrutActorSecret(target, actor, name, value);
  }
  return out;
}
