/**
 * POST /api/gateway/evals/:setId/requirements/:reqId/run
 *
 * Dispatch a Stakwork eval run for EACH HAS_TRIGGER trigger of the requirement.
 * Returns { project_ids: [...] }. Zero triggers → 404.
 *
 * Authenticated via workspace API key (Bearer / x-api-key).
 * Workspace is derived solely from the key — no path/body scope.
 *
 * The key's `createdById` is passed as `userId` into `dispatchEvalTriggerRun`
 * so Bifrost credentials are resolved correctly for Bifrost-enabled workspaces.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveGatewayAuth } from "@/lib/evals/gateway-auth";
import { dispatchEvalTriggerRun, fetchTriggerSource } from "@/lib/evals/dispatch-eval-trigger-run";
import type { EvalTriggerSource } from "@/lib/utils/eval-source";

type RouteParams = { params: Promise<{ setId: string; reqId: string }> };

interface TriggerNode {
  ref_id: string;
  node_type?: string;
  properties?: { source?: string };
  source?: string;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authOrResponse = await resolveGatewayAuth(request);
    if (authOrResponse instanceof NextResponse) return authOrResponse;

    const {
      workspaceId,
      workspaceSlug,
      userId,
      keyId,
      jarvisUrl,
      swarmApiKey,
      swarmUrl,
      swarmSecretAlias,
      swarmName,
    } = authOrResponse;

    const { setId, reqId } = await params;

    console.log(
      `[Gateway Evals Run POST] workspaceId=${workspaceId}, keyId=${keyId}, setId=${setId}, reqId=${reqId}, userId=${userId}`,
    );

    // ── Fetch requirement's HAS_TRIGGER triggers ──────────────────────────
    const edgeType = encodeURIComponent("['HAS_TRIGGER']");
    const nodeType = encodeURIComponent("['EvalTrigger']");
    const triggersRes = await fetch(
      `${jarvisUrl}/v2/nodes/${reqId}?expand=edges&edge_type=${edgeType}&node_type=${nodeType}&depth=1`,
      { headers: { "x-api-token": swarmApiKey } },
    );

    if (!triggersRes.ok) {
      console.error(
        `[Gateway Evals Run POST] Failed to fetch triggers from Jarvis: ${triggersRes.status}`,
        { workspaceId, reqId },
      );
      return NextResponse.json({ error: "Failed to fetch triggers" }, { status: 502 });
    }

    const triggersData = await triggersRes.json();
    const triggers: TriggerNode[] = (triggersData?.nodes ?? []).filter(
      (n: TriggerNode) =>
        n.ref_id !== reqId &&
        String(n.node_type ?? "").toLowerCase() === "evaltrigger",
    );

    if (triggers.length === 0) {
      console.warn(`[Gateway Evals Run POST] No triggers found for requirement`, { workspaceId, reqId });
      return NextResponse.json({ error: "No triggers found for this requirement" }, { status: 404 });
    }

    console.log(`[Gateway Evals Run POST] Dispatching ${triggers.length} trigger(s)`, { workspaceId, reqId });

    // ── Dispatch each trigger ─────────────────────────────────────────────
    const project_ids: Array<string | undefined> = [];
    const errors: string[] = [];

    for (const trigger of triggers) {
      try {
        // Resolve source from the trigger node itself if available, else fetch
        let triggerSource: EvalTriggerSource =
          (trigger.properties?.source ?? trigger.source ?? "") as EvalTriggerSource;

        if (!triggerSource || !["repo_agent", "provider_direct", "jamie_agent"].includes(triggerSource)) {
          const fetched = await fetchTriggerSource(jarvisUrl, swarmApiKey, trigger.ref_id);
          triggerSource = fetched.source;
        }

        const result = await dispatchEvalTriggerRun({
          triggerId: trigger.ref_id,
          reqId,
          evalSetId: setId,
          workspaceSlug,
          workspaceId,
          userId,
          swarmName,
          swarmApiKey,
          swarmUrl,
          swarmSecretAlias,
          triggerSource,
        });

        project_ids.push(result.project_id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[Gateway Evals Run POST] Failed to dispatch trigger ${trigger.ref_id}: ${msg}`,
          { workspaceId, reqId },
        );
        errors.push(msg);
      }
    }

    if (errors.length > 0 && project_ids.length === 0) {
      return NextResponse.json({ error: "Failed to trigger eval workflows" }, { status: 502 });
    }

    return NextResponse.json({ project_ids }, { status: 200 });
  } catch (error) {
    console.error("[Gateway Evals Run POST] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
