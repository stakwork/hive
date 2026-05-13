/**
 * POST /api/mcp/org-token
 *
 * Mint a short-lived MCP JWT scoped to a SourceControlOrg. The token
 * authorizes a single tool — `org_agent` — through which the holder
 * can ask the Hive org canvas agent questions and (with `write`)
 * have it modify org state.
 *
 * Today's caller is forward-looking: in-process plan-mode dispatch
 * uses `mintOrgToken` directly without going through HTTP (see
 * `src/services/roadmap/feature-chat.ts`). This route exists for
 * client flows that need a token without server context — e.g. the
 * voice-agent frontend asking for a writable token before opening
 * its MCP session.
 *
 * Auth model:
 *   - Caller must be an authenticated NextAuth user (middleware-
 *     enforced; this route is in the protected default).
 *   - Caller must be a member of the requested org (any active
 *     workspace under it). Otherwise 404 (unified to avoid leaking
 *     org existence to non-members).
 *   - `write` permission is only granted to OWNER/ADMIN/PM members;
 *     others get a read-only token regardless of what they asked
 *     for. The response surfaces the actually-granted set so the
 *     client can detect the downgrade.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import {
  mintOrgToken,
  DEFAULT_ORG_TOKEN_TTL_SECONDS,
} from "@/lib/mcp/orgTokenMint";
import { ORG_PERMISSIONS } from "@/lib/mcp/orgMcpTools";

// Hard upper bound on the requested TTL. The default helper allows
// `ttlSeconds` overrides for callers like batch jobs that legitimately
// need longer-lived tokens, but the HTTP surface should never be able
// to mint a multi-day token without explicit signoff. 24h is the cap.
const MAX_HTTP_TOKEN_TTL_SECONDS = 60 * 60 * 24;

const requestSchema = z.object({
  orgId: z.string().min(1).describe("SourceControlOrg.id"),
  permissions: z
    .array(z.enum(ORG_PERMISSIONS as readonly ["read", "write"]))
    .default(["read"])
    .describe("Permissions to request. Unauthorized values are downgraded silently."),
  purpose: z
    .string()
    .min(1)
    .max(200)
    .describe("Audit tag, e.g. 'voice-agent', 'plan-mode'."),
  ttlSeconds: z
    .number()
    .int()
    .positive()
    .max(MAX_HTTP_TOKEN_TTL_SECONDS)
    .optional()
    .describe(
      `Optional TTL override (seconds). Default ${DEFAULT_ORG_TOKEN_TTL_SECONDS}, ` +
        `max ${MAX_HTTP_TOKEN_TTL_SECONDS}.`,
    ),
});

export async function POST(req: NextRequest) {
  const context = getMiddlewareContext(req);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  let parsed;
  try {
    const body = await req.json();
    parsed = requestSchema.parse(body);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body", details: String(error) },
      { status: 400 },
    );
  }

  const outcome = await mintOrgToken({
    orgId: parsed.orgId,
    userId: userOrResponse.id,
    requestedPermissions: parsed.permissions,
    purpose: parsed.purpose,
    ttlSeconds: parsed.ttlSeconds,
  });

  if (!outcome.ok) {
    switch (outcome.error) {
      case "JWT_SECRET_MISSING":
        return NextResponse.json(
          { error: "Server misconfigured" },
          { status: 500 },
        );
      case "ORG_MEMBERSHIP_REQUIRED":
        // Unified 404 to avoid leaking org existence to non-members.
        return NextResponse.json(
          { error: "Org not found or access denied" },
          { status: 404 },
        );
      case "INVALID_PERMISSIONS":
        return NextResponse.json(
          { error: "Invalid permission value" },
          { status: 400 },
        );
      default:
        // Exhaustiveness fallback — if `MintOrgTokenFailure` grows a
        // new variant and we forget to handle it here, this branch
        // catches it at runtime. (A compile-time `never` guard would
        // be stricter, but cleanly typing it tripped over the
        // discriminated-union narrowing of `outcome.error`.)
        return NextResponse.json(
          { error: "Unhandled mint error" },
          { status: 500 },
        );
    }
  }

  // Resolve the MCP URL the client should call. Mirrors
  // /api/livekit-token's resolution so deployments stay consistent.
  const mcpUrl = process.env.HIVE_MCP_URL || "https://hive.sphinx.chat/mcp";

  return NextResponse.json({
    token: outcome.token,
    mcpUrl,
    granted: outcome.granted,
    expiresAt: outcome.expiresAt,
    jti: outcome.jti,
  });
}
