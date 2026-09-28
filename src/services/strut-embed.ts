/**
 * Mints the strut lab embed URL for a resolved `StrutTarget` — the shared
 * code path behind both the org embed (`/org/[login]/strut`, purpose
 * `"embed"`) and the workspace embed (`/w/[slug]/strut`, purpose
 * `"workspace_embed"`).
 *
 *  1. POST `{mcp}/mint-token` with the decrypted swarm API key (never
 *     leaves the server) and the user's actor string as `sub`. mcp
 *     returns a short-lived JWT.
 *  2. Push the standing Bifrost delegation (`ensureStrutDelegation`) and
 *     the org's Hive callback key (`ensureStrutHiveKey`) — both run only
 *     after a successful mint, and neither throws nor blocks the embed.
 *  3. Build `{mcp}/lab/?key=<jwt>` — the trailing slash matters (mcp 308s
 *     a bare `/lab` there, dropping `?key=`).
 *
 * Errors returned to the client are always GENERIC — no upstream body, no
 * raw decrypt text. Server logs get the detail (`workspaceSlug`, `swarmId`,
 * status, at most 200 chars of the upstream body); never the swarm key,
 * the `x-api-token` header, the JWT, or any delegation value.
 */

import { logger } from "@/lib/logger";
import { ensureStrutDelegation } from "@/services/bifrost/strut-delegation";
import { ensureStrutHiveKey } from "@/services/strut-hive-key";
import type { StrutTarget, StrutTargetError } from "@/services/strut-target";

const MINT_TIMEOUT_MS = 10_000;
const LOG_TAG = "STRUT_EMBED";

export interface MintStrutEmbedUrlArgs {
  userId: string;
  host: string;
  /** How long the minted mcp token (and the embed session) lives, e.g. `"8h"` / `"1h"`. */
  ttlSeconds: number;
}

export type MintStrutEmbedUrlResult =
  | { ok: true; url: string; expiresInSeconds: number }
  | { ok: false; status: number; error: string };

/** `ttlSeconds` → mcp's `expires_in` string, e.g. `3600` → `"1h"`. */
function toMintTtl(ttlSeconds: number): string {
  if (ttlSeconds % 3600 === 0) return `${ttlSeconds / 3600}h`;
  if (ttlSeconds % 60 === 0) return `${ttlSeconds / 60}m`;
  return `${ttlSeconds}s`;
}

export async function mintStrutEmbedUrl(
  target: StrutTarget,
  args: MintStrutEmbedUrlArgs,
): Promise<MintStrutEmbedUrlResult> {
  const { userId, host, ttlSeconds } = args;
  const apiToken = target.swarmApiKey;
  const baseUrl = target.mcpBase;
  const actor = target.actor;

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/mint-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiToken,
      },
      body: JSON.stringify({ expires_in: toMintTtl(ttlSeconds), sub: actor }),
      cache: "no-store",
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
  } catch (err) {
    const isTimeout = (err as Error).name === "TimeoutError";
    logger.warn(
      isTimeout ? "Strut token mint timed out" : "Strut token mint threw",
      LOG_TAG,
      {
        workspaceSlug: target.workspaceSlug,
        swarmId: target.swarmId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return {
      ok: false,
      status: 502,
      error: isTimeout ? "Strut token mint timed out" : "Strut token mint failed",
    };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    logger.warn("Strut token mint failed", LOG_TAG, {
      workspaceSlug: target.workspaceSlug,
      swarmId: target.swarmId,
      status: resp.status,
      body: text.slice(0, 200),
    });
    return { ok: false, status: 502, error: `Strut token mint failed (${resp.status})` };
  }

  const body = (await resp.json()) as { token?: string };
  if (!body?.token) {
    logger.warn("Strut token mint returned no token", LOG_TAG, {
      workspaceSlug: target.workspaceSlug,
      swarmId: target.swarmId,
    });
    return { ok: false, status: 502, error: `Strut token mint failed (${resp.status})` };
  }

  if (!target.orgId) {
    logger.warn("Skipping strut delegation push: workspace has no sourceControlOrgId", LOG_TAG, {
      workspaceSlug: target.workspaceSlug,
      swarmId: target.swarmId,
    });
  }

  // Neither throws: a failed push is logged and the embed goes ahead.
  await Promise.all([
    target.orgId
      ? ensureStrutDelegation(
          { workspaceId: target.workspaceId, workspaceSlug: target.workspaceSlug, userId },
          { swarmUrl: target.swarmUrl, swarmApiKey: apiToken },
          { actor },
        )
      : Promise.resolve(),
    ensureStrutHiveKey(
      {
        swarmId: target.swarmId,
        workspaceId: target.workspaceId,
        orgId: target.orgId,
        lab: { labBase: target.labBase, swarmApiKey: apiToken },
      },
      { publicBaseUrl: host, userId },
    ),
  ]);

  // Trailing slash matters: the UI's relative `./assets/...` URLs resolve
  // under `/lab/`, and mcp 308s a bare `/lab` there — dropping the `?key=`.
  const url = new URL("/lab/", baseUrl);
  url.searchParams.set("key", body.token);

  return { ok: true, url: url.toString(), expiresInSeconds: ttlSeconds };
}

/** Maps a `resolveStrutTarget` miss to the status code + generic message a route returns. */
export function strutTargetErrorResponse(error: StrutTargetError): { status: number; error: string } {
  switch (error.type) {
    case "DECRYPT_FAILED":
      logger.error("Failed to decrypt swarm credentials", LOG_TAG, { message: error.message });
      return { status: 500, error: "Failed to decrypt swarm credentials" };
    case "SWARM_NOT_CONFIGURED":
      return { status: 503, error: "Swarm is missing swarmUrl or swarmApiKey" };
    case "SWARM_NOT_ACTIVE":
      return { status: 409, error: `The workspace swarm is not active (${error.status})` };
    case "WORKSPACE_NOT_FOUND":
    case "ACCESS_DENIED":
      return { status: 404, error: "Workspace not found or access denied" };
    case "NO_ORG_SWARM":
      return { status: 404, error: "No swarm configured for any workspace in this org" };
  }
}
