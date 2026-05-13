/**
 * Server-side helper for minting org-scope MCP JWTs.
 *
 * Pulled out of any HTTP route so it can be called from both:
 *
 *   1. The HTTP endpoint at `POST /api/mcp/org-token`, used by client
 *      flows (future voice-agent UI, etc.) that need a token without
 *      a server context.
 *   2. In-process callers like the plan-mode dispatcher
 *      (`feature-chat.ts`), which already has the validated `userId`
 *      and `orgId` and shouldn't pay the cost of a self-HTTP call to
 *      issue a token to itself.
 *
 * The function takes responsibility for:
 *   - Membership re-check (user must own or actively belong to a
 *     workspace under the requested org). Mirrors the use-time check
 *     in `verifyOrgJwt` so we never mint a token that would be
 *     rejected at first use.
 *   - Permission gating: `read` is granted whenever the user has any
 *     membership in the org; `write` additionally requires
 *     OWNER/ADMIN/PM in at least one workspace under the org.
 *   - Signing the JWT with the standard `JWT_SECRET`.
 *
 * It does NOT take responsibility for caller authentication. The
 * caller (HTTP route or service function) must have already
 * authenticated the user via NextAuth/session/etc.
 */

import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";
// Import from the dep-free `orgPermissions` module rather than
// `orgMcpTools` so this file does NOT pull `runCanvasAgent` (and its
// transitive `services/workspace.ts` chain) into the import graph at
// module load. That chain trips up unit tests that mock `@/config/env`
// — see the note at the top of `orgPermissions.ts`.
import {
  ORG_PERMISSIONS,
  type OrgPermission,
} from "@/lib/mcp/orgPermissions";

/**
 * Roles that authorize minting a `write` permission. PMs and above
 * are trusted to drive write-capable org agents; developers,
 * stakeholders, and viewers can mint read-only tokens only.
 *
 * Owners are handled separately (they don't have a WorkspaceMember
 * row — their authority comes from `Workspace.ownerId`).
 *
 * NOTE on the PM choice: this is INTENTIONALLY broader than the
 * existing `resolveAuthorizedOrgId` helper (which restricts admin
 * actions to ADMIN+owner). PMs are included here because the org
 * MCP agent's `write` surface — propose_* cards plus direct canvas/
 * research/initiative mutations — is the same surface PMs already
 * have through the org SidebarChat UI. Forbidding PMs from minting
 * a `write` org-token would create a weird asymmetry where they can
 * drive the writes in the browser but not via voice/automation.
 *
 * If you ever want to tighten this back to ADMIN-only, also revisit
 * what the org SidebarChat does for PMs.
 */
const WRITE_AUTHORIZING_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  WorkspaceRole.ADMIN,
  WorkspaceRole.PM,
]);

/**
 * Default token TTL: 4 hours. Matches the workspace JWTs minted by
 * /api/livekit-token; long enough for a plan-mode run (minutes) and
 * a voice-agent session (often a few hours) with margin.
 */
export const DEFAULT_ORG_TOKEN_TTL_SECONDS = 60 * 60 * 4;

export interface MintOrgTokenArgs {
  /** SourceControlOrg.id. */
  orgId: string;
  /** Acting user (re-checked for org membership before minting). */
  userId: string;
  /**
   * Requested permissions. `"read"` is always added if missing. Any
   * permission the user isn't authorized to mint is dropped silently
   * and reported in `granted` so callers can detect the downgrade.
   */
  requestedPermissions: OrgPermission[];
  /** Audit tag — e.g. "plan-mode", "voice-agent", "feature:<id>". */
  purpose: string;
  /** Optional TTL override (seconds). Defaults to 4h. */
  ttlSeconds?: number;
}

export interface MintOrgTokenResult {
  token: string;
  /** Permissions actually granted (after authorization filtering). */
  granted: OrgPermission[];
  /** JWT id, useful for audit log correlation with `verifyOrgJwt` logs. */
  jti: string;
  /** Unix expiry. */
  expiresAt: number;
}

export type MintOrgTokenFailure =
  | { ok: false; error: "JWT_SECRET_MISSING" }
  | { ok: false; error: "ORG_MEMBERSHIP_REQUIRED" }
  | { ok: false; error: "INVALID_PERMISSIONS" };

export type MintOrgTokenOutcome =
  | ({ ok: true } & MintOrgTokenResult)
  | MintOrgTokenFailure;

/**
 * Mint an org-scope MCP JWT for `userId` against `orgId`. The token
 * shape and verification path are defined in `handler.ts`
 * (`verifyOrgJwt`) and consumed by `orgMcpTools.ts`.
 *
 * Returns a discriminated-union outcome rather than throwing, so HTTP
 * callers can map errors to status codes without try/catch noise. The
 * only thrown error path is a bug — e.g. an unexpected DB error —
 * which the caller's outer handler will catch as a 500.
 */
export async function mintOrgToken(
  args: MintOrgTokenArgs,
): Promise<MintOrgTokenOutcome> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return { ok: false, error: "JWT_SECRET_MISSING" };

  // Reject obviously-wrong permission strings up front. The handler
  // would tolerate unknown values (it silently filters them), but at
  // mint time we'd rather fail loud than silently downgrade a
  // requested permission to nothing.
  const requested = args.requestedPermissions ?? [];
  for (const p of requested) {
    if (!(ORG_PERMISSIONS as readonly string[]).includes(p)) {
      return { ok: false, error: "INVALID_PERMISSIONS" };
    }
  }

  // Determine the user's authority level in this org. One DB call
  // gets us both the membership fact (`read` authority) and the
  // highest-privileged workspace (`write` authority).
  //
  // `findFirst` with our WRITE_AUTHORIZING_ROLES probe is cheaper
  // than fetching all memberships — we just need to know whether
  // ONE write-authorizing position exists. If it doesn't, we fall
  // back to a generic membership check for `read`.
  const writeQualifying = await db.workspace.findFirst({
    where: {
      sourceControlOrgId: args.orgId,
      deleted: false,
      OR: [
        // Owners always qualify for write.
        { ownerId: args.userId },
        // Or an active member with a write-authorizing role.
        {
          members: {
            some: {
              userId: args.userId,
              leftAt: null,
              role: { in: Array.from(WRITE_AUTHORIZING_ROLES) },
            },
          },
        },
      ],
    },
    select: { id: true },
  });

  const canWrite = writeQualifying !== null;

  // If we already passed the write probe, the user trivially has
  // read authority too. Otherwise do a cheaper read-only membership
  // check.
  let canRead = canWrite;
  if (!canRead) {
    const readQualifying = await db.workspace.findFirst({
      where: {
        sourceControlOrgId: args.orgId,
        deleted: false,
        OR: [
          { ownerId: args.userId },
          { members: { some: { userId: args.userId, leftAt: null } } },
        ],
      },
      select: { id: true },
    });
    canRead = readQualifying !== null;
  }

  if (!canRead) {
    return { ok: false, error: "ORG_MEMBERSHIP_REQUIRED" };
  }

  // Build the granted permission set. Always include `read`
  // (membership was just proven). Include `write` iff requested AND
  // the user is authorized.
  const granted: OrgPermission[] = ["read"];
  if (requested.includes("write") && canWrite) {
    granted.push("write");
  }

  const ttlSeconds = args.ttlSeconds ?? DEFAULT_ORG_TOKEN_TTL_SECONDS;
  const jti = randomUUID();
  const token = jwt.sign(
    {
      scope: "org",
      orgId: args.orgId,
      userId: args.userId,
      permissions: granted,
      purpose: args.purpose,
      jti,
    },
    jwtSecret,
    { expiresIn: ttlSeconds },
  );

  // Compute expiry approximately so callers can pass it to clients
  // without re-parsing the JWT. Acceptable to be off by a few ms.
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

  return {
    ok: true,
    token,
    granted,
    jti,
    expiresAt,
  };
}
