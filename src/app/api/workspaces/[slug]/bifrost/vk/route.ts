import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import {
  BifrostConfigError,
  MacaroonIssuerError,
  mintInvocationMacaroon,
  reconcileBifrostVK,
} from "@/services/bifrost";
import { validateWorkspaceAccess } from "@/services/workspace";

/**
 * Per-call cap for the dev macaroon minted alongside the VK on this
 * route. Intentionally tiny ($2) — this token is meant to be copy-
 * pasted into a terminal for one-off curls, not threaded through a
 * real agent run. Real agents mint their own macaroons via
 * `getBifrostForLLM` with the workspace-configured cap.
 */
const DEV_MACAROON_MAX_COST_USD = 2;

/**
 * `agent-name` dim stamped onto the dev macaroon. Shows up in
 * `logs.db` so operators can tell spend that came from a developer
 * curling the gateway apart from real agent traffic.
 */
const DEV_MACAROON_AGENT_NAME = "coding-agent";

/**
 * GET /api/workspaces/[slug]/bifrost/vk[?model=<name>]
 *
 * Returns the caller's per-(workspace,user) Bifrost Virtual Key so a
 * developer can hit the gateway manually with `Authorization: Bearer
 * <vkValue>` from curl / Postman / etc.
 *
 * `?model=` is an optional shortcut (`"sonnet"`, `"gpt"`, `"gemini"`,
 * `"kimi"`, or a full model id) that determines the per-provider
 * suffix on the returned `baseUrl` (`/anthropic/v1`, `/openai/v1`,
 * `/genai/v1beta`). Defaults to anthropic — the most common case.
 *
 * Auth: workspace ADMIN or higher. The VK is the caller's own token
 * — but exposing it in a copyable form is still a privileged action
 * (it bypasses the lazy-reconcile path that normally runs inside
 * askTools). Workspace developers / viewers get 403.
 *
 * Idempotency: triggers `reconcileBifrostVK`, which is itself
 * idempotent — first call provisions the Customer + VK on the
 * gateway, subsequent calls hit the cached VK on `WorkspaceMember`.
 *
 * Cache headers: `Cache-Control: private, no-store` — VKs are
 * bearer tokens, treat them like passwords.
 *
 * See gateway/plans/phase-1-reconciler.md for the reconciler contract.
 */
export async function GET(
  request: NextRequest,
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

  const workspaceId = access.workspace?.id;
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // Quick existence check so the error surface is clearer than a
  // raw 500 when the swarm hasn't been provisioned at all.
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

  // Optional `?model=` query so the returned `baseUrl` is suffixed
  // for the provider the developer plans to curl against.
  const model = request.nextUrl.searchParams.get("model") ?? undefined;

  try {
    const result = await reconcileBifrostVK(workspaceId, session.user.id, {
      model,
    });

    // Mint a small-budget dev macaroon alongside the VK so the same
    // dev-log surface can curl the gateway end-to-end (Bearer VK +
    // `x-macaroon` header). Failures here are non-fatal: the VK
    // alone is still useful for shadow-mode gateway calls. Mirrors
    // the orchestrator's posture (`mintMacaroonHeader` swallows mint
    // failures rather than breaking the LLM call).
    let macaroon: Awaited<ReturnType<typeof mintInvocationMacaroon>> | null =
      null;
    let macaroonError: string | null = null;
    try {
      macaroon = await mintInvocationMacaroon({
        workspaceId,
        userId: session.user.id,
        agentName: DEV_MACAROON_AGENT_NAME,
        maxCostUsd: DEV_MACAROON_MAX_COST_USD,
      });
    } catch (err) {
      // Don't fail the route — the caller can still use the VK in
      // shadow mode. Surface the reason so the dev-log can show it.
      macaroonError =
        err instanceof MacaroonIssuerError
          ? err.message
          : err instanceof Error
          ? err.message
          : String(err);
      console.warn(
        "[bifrost/vk] macaroon mint failed; returning VK without macaroon",
        macaroonError,
      );
    }

    return new NextResponse(
      JSON.stringify({
        baseUrl: result.baseUrl,
        vkValue: result.vkValue,
        vkId: result.vkId,
        customerId: result.customerId,
        userId: result.userId,
        // Surface whether this call created the VK (vs hit the cache)
        // so a developer can tell whether they tripped the slow path.
        created: result.created,
        // Dev macaroon — small per-call cap, `agent-name=coding-agent`.
        // `null` when minting failed (e.g. workspace not yet wired
        // up to a SourceControlOrg); `macaroonError` carries the
        // reason in that case.
        macaroon: macaroon
          ? {
              token: macaroon.token,
              orgId: macaroon.orgId,
              macaroonUserId: macaroon.macaroonUserId,
              agentName: macaroon.agentName,
              runId: macaroon.runId,
              expiresAt: macaroon.expiresAt,
              maxCostUsd: DEV_MACAROON_MAX_COST_USD,
            }
          : null,
        macaroonError,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (err) {
    if (err instanceof BifrostConfigError) {
      return NextResponse.json(
        {
          error: "LLM gateway not reachable; cannot provision VK",
          detail: err.message,
        },
        { status: 502 },
      );
    }
    console.error("[bifrost/vk] unexpected error reconciling VK", err);
    return NextResponse.json(
      { error: "Internal error reconciling Bifrost VK" },
      { status: 500 },
    );
  }
}
