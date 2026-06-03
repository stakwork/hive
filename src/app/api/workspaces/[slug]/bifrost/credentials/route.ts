import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import {
  BifrostConfigError,
  resolveBifrost,
} from "@/services/bifrost";
import { validateWorkspaceAccess } from "@/services/workspace";

/**
 * GET /api/workspaces/[slug]/bifrost/credentials
 *
 * Returns the Bifrost dashboard URL + admin user + admin password
 * (plaintext, decrypted) so the frontend can render a "visit your
 * LLM dashboard" card with a copy-to-clipboard password.
 *
 * Auth: workspace ADMIN or higher. The endpoint returns secrets in
 * plaintext to the caller's browser — workspace members below ADMIN
 * (developer / viewer / stakeholder) get 403.
 *
 * Idempotency: if the swarm row is missing admin creds, this triggers
 * the same lazy bootstrap as the phase-1 reconciler (see
 * `resolveBifrost`). After this call the encrypted admin credentials
 * are guaranteed to be cached on `swarm.bifrostAdminPassword`.
 *
 * Cache headers: `Cache-Control: private, no-store` — passwords must
 * never land in a shared cache or proxy.
 *
 * See gateway/plans/phases/phase-3-swarm-handoff.md §B2.3.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;

  const access = await validateWorkspaceAccess(slug, session.user.id);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  if (!access.canAdmin) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  // Resolve workspace.id -> we have it on `access.workspace.id`, but
  // resolveBifrost looks up by workspaceId. validateWorkspaceAccess
  // already loaded the workspace; reuse it.
  const workspaceId = access.workspace?.id;
  if (!workspaceId) {
    // Defensive: hasAccess true should imply workspace is set.
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // Quick existence check so the error surface is "no LLM gateway
  // yet" vs "credentials fetch failed" — better UX than a raw 500
  // when the swarm hasn't been provisioned at all.
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: { id: true, swarmUrl: true },
  });
  if (!swarm || !swarm.swarmUrl) {
    return NextResponse.json(
      { error: "LLM gateway not provisioned for this workspace yet" },
      { status: 404 },
    );
  }

  try {
    const { baseUrl, adminUser, adminPassword } = await resolveBifrost(
      workspaceId,
    );

    return new NextResponse(
      JSON.stringify({
        dashboardUrl: baseUrl,
        adminUser,
        adminPassword,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          // Browsers must not cache plaintext credentials, even per-user.
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (err) {
    if (err instanceof BifrostConfigError) {
      // 502 because the gateway is misconfigured / unreachable —
      // it's not the client's fault, but it isn't the credentials
      // route's fault either.
      return NextResponse.json(
        {
          error: "LLM gateway credentials unavailable",
          detail: err.message,
        },
        { status: 502 },
      );
    }
    console.error(
      "[bifrost/credentials] unexpected error resolving creds",
      err,
    );
    return NextResponse.json(
      { error: "Internal error resolving LLM gateway credentials" },
      { status: 500 },
    );
  }
}
