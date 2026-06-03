/**
 * Server-side helper for minting workspace-scope MCP JWTs.
 *
 * Pulled out of any HTTP route so it can be called from in-process
 * callers like the plan-mode dispatcher (`feature-chat.ts`), which
 * already has the validated `userId` and `workspaceId` and shouldn't
 * pay the cost of a self-HTTP call to issue a token to itself.
 *
 * The JWT shape mirrors the workspace token minted by
 * `POST /api/livekit-token`:
 *
 *   { slug: string, userId: string, iat, exp }
 *
 * This is the shape `verifyJwt` (in `handler.ts`) expects for the
 * workspace-scope branch — `slug` is the workspace lookup key,
 * `userId` is re-checked for workspace membership at use time. We do
 * NOT carry any toolFilter in the JWT; the tool-allow-list rides on
 * the URL `?tools=` query param and the `McpServerConfig.toolFilter`
 * the caller assembles around this token.
 *
 * The function is responsible for:
 *   - Re-checking that `userId` still owns or is an active member of
 *     `workspaceId`. Mirrors the use-time check in `verifyJwt` so we
 *     never mint a token that would be rejected at first use.
 *   - Signing the JWT with the standard `JWT_SECRET`.
 *
 * It does NOT take responsibility for caller authentication. The
 * caller (HTTP route or service function) must have already
 * authenticated the user via NextAuth/session/etc.
 */

import jwt from "jsonwebtoken";
import { db } from "@/lib/db";

/**
 * Default token TTL: 4 hours. Matches the workspace JWTs minted by
 * /api/livekit-token; long enough for a plan-mode run (minutes) with
 * margin for retries.
 */
export const DEFAULT_WORKSPACE_TOKEN_TTL_SECONDS = 60 * 60 * 4;

export interface MintWorkspaceTokenArgs {
  /** Workspace.id (re-resolved to slug here so callers can pass either id or slug). */
  workspaceId: string;
  /** Acting user (re-checked for workspace membership before minting). */
  userId: string;
  /** Audit tag — e.g. "plan-mode:<featureId>", "voice-agent". */
  purpose: string;
  /** Optional TTL override (seconds). Defaults to 4h. */
  ttlSeconds?: number;
}

export type MintWorkspaceTokenResult =
  | {
      ok: true;
      token: string;
      slug: string;
      expiresAt: number;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Mint a workspace-scope MCP JWT for the plan-mode (and future
 * automation) callback flows.
 *
 * Failure modes are returned as `{ ok: false, error }` rather than
 * thrown — the caller (plan-mode dispatch) treats the callback as
 * best-effort and runs without it on any mint failure, so a thrown
 * exception would be over-aggressive.
 */
export async function mintWorkspaceToken(
  args: MintWorkspaceTokenArgs,
): Promise<MintWorkspaceTokenResult> {
  const {
    workspaceId,
    userId,
    purpose,
    ttlSeconds = DEFAULT_WORKSPACE_TOKEN_TTL_SECONDS,
  } = args;

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return { ok: false, error: "JWT_SECRET not configured" };
  }

  // Resolve slug + re-check membership in one round-trip. The use-time
  // verifier (`verifyJwt`) does the same check; doing it here too means
  // we never mint a token that would 401 on first use.
  let workspace: { id: string; slug: string; ownerId: string } | null;
  try {
    workspace = await db.workspace.findFirst({
      where: { id: workspaceId, deleted: false },
      select: { id: true, slug: true, ownerId: true },
    });
  } catch (err) {
    console.error("[mintWorkspaceToken] workspace lookup failed:", err);
    return { ok: false, error: "workspace lookup failed" };
  }
  if (!workspace) {
    return { ok: false, error: "workspace not found" };
  }

  const isOwner = workspace.ownerId === userId;
  if (!isOwner) {
    try {
      const membership = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId,
          },
        },
        select: { leftAt: true },
      });
      if (!membership || membership.leftAt) {
        return { ok: false, error: "user is not a member of workspace" };
      }
    } catch (err) {
      console.error("[mintWorkspaceToken] membership check failed:", err);
      return { ok: false, error: "membership check failed" };
    }
  }

  const token = jwt.sign(
    { slug: workspace.slug, userId },
    jwtSecret,
    { expiresIn: ttlSeconds },
  );

  // `expiresIn: ttlSeconds` (number) is interpreted as seconds.
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

  console.log(
    `[mintWorkspaceToken] minted workspace token: slug=${workspace.slug} ` +
      `userId=${userId} purpose=${purpose} expiresAt=${expiresAt}`,
  );

  return { ok: true, token, slug: workspace.slug, expiresAt };
}
