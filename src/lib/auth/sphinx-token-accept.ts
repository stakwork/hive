import type { NextRequest } from "next/server";
import { isSphinxBoundTokenRequired } from "@/config/env";
import { logger } from "@/lib/logger";
import { verifySphinxToken, verifySphinxTokenBound, type SphinxTokenPurpose } from "@/lib/auth/sphinx-verify";

/**
 * Which Sphinx tokens a route takes (docs/plans/sphinx-token-binding.md).
 * `sphinx-verify.ts` is the crypto; this is the policy over it: every route
 * takes the bound token, and the bare one until `SPHINX_TOKEN_REQUIRE_BOUND`.
 */

export type SphinxTokenFormat = "bare" | "bound";

export type AcceptedSphinxToken = { valid: true; format: SphinxTokenFormat } | { valid: false; reason: string };

export const BARE_TOKEN_REFUSED = "Bare Sphinx tokens are no longer accepted: sign the bound form (hive sphinx token v2)";

export interface SphinxTokenContext {
  /** Hive's host (`sphinxTokenHost`). */
  host: string;
  purpose: SphinxTokenPurpose;
  /**
   * The k1 the request names, "" on a route that has none, or null when the
   * request can carry no bound token (the token exchange without a challenge).
   */
  challenge: string | null;
}

/**
 * Hive's host as a bound token names it: the `host=` the sign-in QR carries
 * (`NEXTAUTH_URL`'s host, port included, as /api/auth/sphinx/challenge builds
 * it). The request's host only when Hive has none configured.
 */
export function sphinxTokenHost(request: NextRequest): string {
  const configured = process.env.NEXTAUTH_URL;
  if (configured) {
    try {
      return new URL(configured).host;
    } catch {
      // Unparseable: the request's host below.
    }
  }
  return request.nextUrl.host;
}

/**
 * Accept a Sphinx token for `pubkey`: the bare form (a signature over the
 * timestamp alone) unless the flag refuses it, else the bound form for this
 * host, purpose and challenge. Logs which form was used, never the token.
 * When neither verifies, the reason is the bare verifier's, or the bound
 * one's once the flag is on.
 */
export function acceptSphinxToken(token: string, pubkey: string, context: SphinxTokenContext): AcceptedSphinxToken {
  const requireBound = isSphinxBoundTokenRequired();

  const bare = verifySphinxToken(token, pubkey);
  if (bare.valid) {
    if (requireBound) {
      logger.warn("Bare Sphinx token refused", "SPHINX_AUTH", { purpose: context.purpose });
      return { valid: false, reason: BARE_TOKEN_REFUSED };
    }
    return accepted("bare", context.purpose);
  }
  if (context.challenge === null) return bare;

  const bound = verifySphinxTokenBound(token, pubkey, {
    host: context.host,
    purpose: context.purpose,
    challenge: context.challenge,
  });
  if (bound.valid) return accepted("bound", context.purpose);
  return requireBound ? bound : bare;
}

function accepted(format: SphinxTokenFormat, purpose: SphinxTokenPurpose): AcceptedSphinxToken {
  logger.info("Sphinx token accepted", "SPHINX_AUTH", { purpose, format });
  return { valid: true, format };
}
