/**
 * GET /api/workspaces/[slug]/documents/proxy?nodeId=<ref_id>
 *
 * Server-side proxy that fetches a DOCX file on behalf of the client,
 * avoiding CORS/authentication issues with the file host.
 *
 * Security controls (in order of execution):
 *   1. Workspace membership check (IDOR protection)
 *   2. Per-user/workspace token-bucket rate limiting (20 req/min)
 *   3. SSRF protection via protocol + hostname allowlist on the resolved fileUrl
 *   4. AbortSignal.timeout(5000) on the outbound fetch
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getSwarmVanityAddress } from "@/lib/constants";
import { getStakgraphUrl } from "@/lib/utils/stakgraph-url";
import { validateFileUrl } from "@/lib/docx-proxy/validate-file-url";

export const runtime = "nodejs";

const encryptionService = EncryptionService.getInstance();

// ---------------------------------------------------------------------------
// Graph node resolution (same logic as /documents/node)
// ---------------------------------------------------------------------------

async function resolveNodeFileUrl(
  workspaceId: string,
  nodeId: string,
): Promise<string | null> {
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: { name: true, swarmUrl: true, swarmApiKey: true },
  });

  if (!swarm?.swarmUrl || !swarm?.swarmApiKey) return null;

  let apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
  if (process.env.CUSTOM_SWARM_API_KEY) {
    apiKey = process.env.CUSTOM_SWARM_API_KEY;
  }

  const stakgraphUrl = getStakgraphUrl(getSwarmVanityAddress(swarm.name));
  const params = new URLSearchParams({ ref_ids: nodeId, output: "json" });

  const res = await fetch(`${stakgraphUrl}/graph?${params.toString()}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": apiKey,
    },
  });

  if (!res.ok) return null;

  const data = await res.json();
  const nodes: Array<{ properties?: Record<string, unknown> }> = data?.nodes ?? [];
  if (nodes.length === 0) return null;

  const fileUrl = nodes[0]?.properties?.file_url;
  return typeof fileUrl === "string" && fileUrl.length > 0 ? fileUrl : null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    // 1. IDOR check — must be an authenticated workspace member.
    const access = await resolveWorkspaceAccess(request, { slug });
    const ok = requireMemberAccess(access);
    if (ok instanceof NextResponse) return ok;

    const { userId, workspaceId } = ok;

    // 2. Rate limit — 20 requests per user per workspace per minute.
    const rlKey = `docx-proxy:${userId}:${workspaceId}`;
    const rl = await checkRateLimit(rlKey, 20, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: rl.retryAfter
            ? { "Retry-After": String(rl.retryAfter) }
            : undefined,
        },
      );
    }

    // 3. Resolve fileUrl from the graph node.
    const { searchParams } = new URL(request.url);
    const nodeId = searchParams.get("nodeId");
    if (!nodeId) {
      return NextResponse.json({ error: "nodeId required" }, { status: 400 });
    }

    const rawFileUrl = await resolveNodeFileUrl(workspaceId, nodeId);
    if (!rawFileUrl) {
      return NextResponse.json({ error: "No file URL on node" }, { status: 404 });
    }

    // 4. SSRF validation — reject non-https or un-allowlisted hosts.
    let validatedUrl: URL;
    try {
      validatedUrl = validateFileUrl(rawFileUrl);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid file URL" },
        { status: 400 },
      );
    }

    // 5. Proxy the file with a hard 5-second timeout.
    const upstream = await fetch(validatedUrl.toString(), {
      signal: AbortSignal.timeout(5000),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Upstream fetch failed" },
        { status: upstream.status },
      );
    }

    const body = await upstream.arrayBuffer();
    const contentType =
      upstream.headers.get("content-type") ??
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Prevent the browser from sniffing the content type.
        "X-Content-Type-Options": "nosniff",
        // Do not cache proxied documents.
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
