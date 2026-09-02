/**
 * Org-scoped HTML page body proxy.
 *
 * GET /api/orgs/[githubLogin]/html-pages/[slug]
 *
 * Returns the raw bytes of an org's stored HTML page to signed-in org
 * members only. There is deliberately no public/unauthenticated path and
 * no redirect to a presigned S3 URL.
 *
 * The response is served as an **opaque download**, never as
 * `text/html`: a cookie-authenticated HTML response on Hive's own origin
 * is stored XSS the moment anyone navigates to it or uses it as an
 * iframe `src`. `HtmlArtifactFrame` is the only intended caller — it
 * fetches with credentials and renders the bytes from a blob URL inside
 * a locked sandbox.
 *
 * Authorization goes through `resolveAuthorizedOrgId` (shared with the
 * research/initiative/mcp-servers org-resource routes) rather than
 * `validateUserBelongsToOrg` — the two enforce the same membership rule,
 * but standardizing avoids growing a second convention across the HTML
 * route family (this proxy, `canvas/node/[liveId]`, and the share page
 * all now agree). `requireAdmin` is passed `false` explicitly:
 * `validateUserBelongsToOrg` has no admin notion, and any non-admin
 * member can read these pages today, so requiring admin here would be a
 * regression, not a fix.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { getHtmlPageBytes } from "@/services/html-pages";
import { htmlBodyProxyHeaders } from "@/lib/utils/html-body-proxy";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const fetchCache = "force-no-store";

// Body reads are S3 egress, and this proxy plus `get_html` are now both
// unmetered read surfaces onto the same objects — cap per-user request
// rate rather than leaving it open-ended.
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_SECS = 60;

/** Log a denial with pointer metadata only — never an HTML body. */
function denied(reason: string, githubLogin: string, slug: string) {
  console.warn("[html-pages] body proxy denied", { reason, githubLogin, slug });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; slug: string }> },
) {
  const { githubLogin, slug } = await params;

  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) {
    denied("unauthenticated", githubLogin, slug);
    return userOrResponse;
  }
  const userId = userOrResponse.id;

  // Rate limit per user — keyed off the authenticated user, not IP, since
  // the same session may traverse several IPs (proxies, mobile networks)
  // and we specifically want to bound per-account S3 egress. `getClientIp`
  // is folded in as a secondary key component so a compromised session
  // token can't be replayed from many hosts to multiply the quota.
  const rlKey = `html-pages-proxy:${userId}:${getClientIp(request)}`;
  const rl = await checkRateLimit(rlKey, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECS);
  if (!rl.allowed) {
    denied("rate_limited", githubLogin, slug);
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: rl.retryAfter ? { "Retry-After": String(rl.retryAfter) } : undefined,
      },
    );
  }

  // Membership is workspace-based (owner or member of a workspace linked
  // to the org) — not SourceControlToken, which would 404 members who can
  // already open the plan/task UI. `resolveAuthorizedOrgId` returns the
  // org id in the same call that verifies membership, so there is no
  // separate `sourceControlOrg.findFirst` round-trip.
  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, /* requireAdmin */ false);
  if (!orgId) {
    // Covers both "org doesn't exist" and "user isn't a member" —
    // deliberately indistinguishable so we don't leak org existence.
    denied("not-authorized", githubLogin, slug);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Scoped by (orgId, slug): a cross-org slug 404s rather than leaking
  // that the page exists somewhere else.
  const result = await getHtmlPageBytes(orgId, slug);
  if (!result) {
    denied("page-or-object-missing", githubLogin, slug);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: htmlBodyProxyHeaders(),
  });
}
