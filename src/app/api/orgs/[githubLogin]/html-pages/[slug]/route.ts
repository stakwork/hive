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
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { getHtmlPageBytes } from "@/services/html-pages";
import { htmlBodyProxyHeaders } from "@/lib/utils/html-body-proxy";

export const fetchCache = "force-no-store";

/** Log a denial with pointer metadata only — never an HTML body. */
function denied(reason: string, githubLogin: string, slug: string) {
  console.warn("[html-pages] body proxy denied", { reason, githubLogin, slug });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; slug: string }> },
) {
  const { githubLogin, slug } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    denied("unauthenticated", githubLogin, slug);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Membership is workspace-based (owner or member of a workspace linked to
  // the org) — not SourceControlToken, which would 404 members who can
  // already open the plan/task UI.
  const isMember = await validateUserBelongsToOrg(githubLogin, session.user.id);
  if (!isMember) {
    denied("non-member", githubLogin, slug);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const org = await db.sourceControlOrg.findFirst({
    where: { githubLogin },
    select: { id: true },
  });
  if (!org) {
    denied("org-not-found", githubLogin, slug);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Scoped by (orgId, slug): a cross-org slug 404s rather than leaking
  // that the page exists somewhere else.
  const result = await getHtmlPageBytes(org.id, slug);
  if (!result) {
    denied("page-or-object-missing", githubLogin, slug);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: htmlBodyProxyHeaders(),
  });
}
