/**
 * GET /api/w/[slug]/doc-proxy?url=<encoded-url>&filename=<optional>
 *
 * Server-side proxy that fetches a DOCX (or any allowlisted) file on behalf
 * of the client, attaching GitHub credentials when needed.
 *
 * Security controls (in order of execution):
 *   1. Session check — 401 for unauthenticated callers.
 *   2. Workspace membership check — 403 for non-members (IDOR protection).
 *   3. SSRF guard — reject non-HTTPS scheme (400) and un-allowlisted hostnames (400).
 *   4. Outbound fetch with GitHub token for github.com / raw.githubusercontent.com.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// Strict hostname allowlist for SSRF protection.
// S3/CDN domain derived from env so operators can configure it.
const ALLOWED_GITHUB_HOSTS = new Set(["raw.githubusercontent.com", "github.com"]);

function buildAllowedHosts(): Set<string> {
  const hosts = new Set(ALLOWED_GITHUB_HOSTS);
  // Allow the app's own S3/CDN domain if configured.
  const s3Domain = process.env.S3_UPLOAD_DOMAIN ?? process.env.NEXT_PUBLIC_S3_DOMAIN;
  if (s3Domain) hosts.add(s3Domain);
  return hosts;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  // 1. Authentication check.
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Workspace membership check (IDOR protection).
  // We perform this BEFORE any external fetch or secret access.
  // Reject null/undefined email explicitly — passing `undefined` to Prisma's
  // `where` silently drops the condition, which would match any workspace member.
  const callerEmail = session.user.email;
  if (!callerEmail) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { slug } = await params;
  const member = await db.workspaceMember.findFirst({
    where: {
      workspace: { slug },
      user: { email: callerEmail },
    },
    select: { id: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3. SSRF guard — validate the `url` parameter.
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "url parameter required" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (target.protocol !== "https:") {
    console.warn(`[doc-proxy] Blocked non-HTTPS request to domain: ${target.hostname}`);
    return NextResponse.json({ error: "Only HTTPS URLs are allowed" }, { status: 400 });
  }

  const allowedHosts = buildAllowedHosts();
  if (!allowedHosts.has(target.hostname)) {
    console.warn(`[doc-proxy] Blocked request to disallowed domain: ${target.hostname}`);
    return NextResponse.json(
      { error: `Domain not allowed: ${target.hostname}` },
      { status: 400 },
    );
  }

  // 4. Fetch the upstream resource, attaching GitHub auth for github.com / raw.githubusercontent.com.
  const headers: Record<string, string> = {};
  if (ALLOWED_GITHUB_HOSTS.has(target.hostname)) {
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { headers });
  } catch (err) {
    console.error(`[doc-proxy] Upstream fetch failed for domain ${target.hostname}:`, err);
    return NextResponse.json({ error: "Failed to fetch upstream resource" }, { status: 502 });
  }

  if (!upstream.ok) {
    console.error(
      `[doc-proxy] Upstream returned ${upstream.status} for domain ${target.hostname}`,
    );
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
  }

  const body = await upstream.arrayBuffer();
  const contentType =
    upstream.headers.get("content-type") ??
    "application/octet-stream";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
