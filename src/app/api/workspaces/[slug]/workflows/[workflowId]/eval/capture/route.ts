import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { config } from "@/config/env";
import { logger } from "@/lib/logger";
import {
  normalizeTransitions,
  inferProvider,
  extractStepFromTransition,
} from "@/lib/stakwork/transitions";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ slug: string; workflowId: string }> };

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] ?? { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/** Attempt to find an existing EvalSet node by its stable id. */
async function findOrCreateEvalSet(
  jarvisConfig: { jarvisUrl: string; apiKey: string },
  workflowId: string,
): Promise<{ ref_id: string; created: boolean }> {
  const evalSetId = `evalset-${workflowId}`;

  try {
    const lookupRes = await fetch(`${jarvisConfig.jarvisUrl}/node?id=${encodeURIComponent(evalSetId)}`, {
      headers: { "x-api-token": jarvisConfig.apiKey },
    });

    if (lookupRes.ok) {
      const data = await lookupRes.json();
      const nodes: Array<{ ref_id: string }> =
        data?.nodes ?? (data?.ref_id ? [data] : []);
      if (nodes.length > 0 && nodes[0].ref_id) {
        logger.info(`[EvalCapture] EvalSet found, ref_id: ${nodes[0].ref_id}`);
        return { ref_id: nodes[0].ref_id, created: false };
      }
    }
  } catch {
    // fall through to create
  }

  // Not found — create it
  const createResult = await addNode(
    { jarvisUrl: jarvisConfig.jarvisUrl, apiKey: jarvisConfig.apiKey },
    {
      node_type: "EvalSet",
      node_data: {
        id: evalSetId,
        name: `Workflow ${workflowId} Evals`,
      },
    },
  );

  if (!createResult.success || !createResult.ref_id) {
    throw new Error(`Failed to create EvalSet: ${createResult.error}`);
  }

  logger.info(`[EvalCapture] EvalSet created, ref_id: ${createResult.ref_id}`);
  return { ref_id: createResult.ref_id, created: true };
}

/** Look up a Run/AgentSession node by stakwork project id for the EVALUATED edge. */
async function lookupRunNode(
  jarvisConfig: { jarvisUrl: string; apiKey: string },
  runId: string,
): Promise<string | null> {
  try {
    const url = `${jarvisConfig.jarvisUrl}/v2/nodes?type=AgentSession&project_id=${encodeURIComponent(runId)}`;
    const res = await fetch(url, {
      headers: { "x-api-token": jarvisConfig.apiKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const nodes: Array<{ ref_id: string }> = data?.nodes ?? [];
    return nodes[0]?.ref_id ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Auth — middleware-based (same as flag-as-eval)
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, workflowId } = await params;

    // Swarm access check (also verifies workspace membership)
    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      logger.warn("[EvalCapture] Swarm access denied", swarmAccessResult.error.type);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    // Parse and validate body
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const {
      run_id,
      step_id,
      requirement,
      reason,
      desirable_cases,
      undesirable_cases,
      check,
      body: clientBody,
    } = body as {
      run_id?: string;
      step_id?: string;
      requirement?: string;
      reason?: string;
      desirable_cases?: string[];
      undesirable_cases?: string[];
      check?: { type: string; want: boolean };
      /** Client-supplied replay body snapshot built from already-loaded runTransitions */
      body?: {
        prompt_change: string | null;
        model: string | null;
        response_raw: string | null;
        output_text: string | null;
        finish_reason: string | null;
      };
    };

    if (!requirement?.trim()) {
      return NextResponse.json({ error: "requirement is required" }, { status: 400 });
    }

    // Dev mode — delegate to mock
    if (process.env.NODE_ENV === "development") {
      const origin = request.nextUrl.origin;
      try {
        const mockRes = await fetch(
          `${origin}/api/mock/workspaces/${slug}/workflows/${workflowId}/eval/capture`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (mockRes.ok) {
          return NextResponse.json(await mockRes.json());
        }
      } catch {
        // fall through
      }
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const jarvisConfig = { jarvisUrl, apiKey: swarmApiKey };
    const nodeConfig = { jarvisUrl, apiKey: swarmApiKey };

    // ── 1. Find-or-create EvalSet ────────────────────────────────────────────
    const { ref_id: evalSetRef } = await findOrCreateEvalSet(jarvisConfig, workflowId);

    // ── 2. Create EvalRequirement ────────────────────────────────────────────
    const reqResult = await addNode(nodeConfig, {
      node_type: "EvalRequirement",
      node_data: {
        id: randomUUID(),
        name: requirement.trim(),
        desirable_cases: desirable_cases ?? [],
        undesirable_cases: undesirable_cases ?? [],
      },
    });

    if (!reqResult.success || !reqResult.ref_id) {
      logger.error("[EvalCapture] Failed to create EvalRequirement", reqResult.error);
      return NextResponse.json({ error: "Failed to create requirement" }, { status: 502 });
    }
    const requirementRef = reqResult.ref_id;
    logger.info(`[EvalCapture] EvalRequirement created, ref_id: ${requirementRef}`);

    // ── 3. Snapshot step → EvalTrigger ──────────────────────────────────────
    let model: string | null = null;
    let provider: string | null = null;
    let endpoint_url: string | null = null;
    let prompt_snapshot: string = "[]";
    let tool_call_trace: string | null = null;
    let stepName: string = step_id ?? "unknown_step";

    if (run_id && step_id) {
      try {
        const projectRes = await fetch(
          `${config.STAKWORK_BASE_URL}/projects/${run_id}.json`,
          { headers: { Authorization: `Token token=${config.STAKWORK_API_KEY}` } },
        );

        if (projectRes.ok) {
          const projectData = await projectRes.json();
          const transitions = normalizeTransitions(projectData);
          const transition = transitions.find(
            (t) => (t.unique_id ?? t.id) === step_id,
          );

          if (transition) {
            const extracted = extractStepFromTransition(transition);
            stepName = extracted.name || step_id;
            model = extracted.model;
            provider = extracted.provider;
            endpoint_url = extracted.endpoint_url;
            prompt_snapshot = JSON.stringify(extracted.messages);

            // Snapshot tools if present (from raw_input_params)
            const topAttrs = transition?.attributes as Record<string, unknown> | undefined;
            const stepAttrs = (transition?.step as Record<string, unknown> | undefined)
              ?.attributes as Record<string, unknown> | undefined;
            const rawInputParams = (topAttrs?.raw_input_params ??
              stepAttrs?.raw_input_params) as Record<string, unknown> | undefined;
            const tools = rawInputParams?.tools ?? null;
            tool_call_trace = tools !== null ? JSON.stringify(tools) : null;
          }
        }
      } catch (err) {
        logger.warn("[EvalCapture] Failed to fetch project JSON for snapshot", String(err));
        // Non-fatal — proceed with defaults
      }
    }

    const triggerResult = await addNode(nodeConfig, {
      node_type: "EvalTrigger",
      node_data: {
        id: randomUUID(),
        agent: stepName,
        environment: String(workflowId),
        start_point: `step:${step_id ?? ""}`,
        end_point: `step:${step_id ?? ""}`,
        change_type: "prompt",
        model,
        provider,
        endpoint_url,
        prompt_snapshot,
        tool_call_trace,
        feedback_note: reason ?? null,
        check: check ?? null,
        // Client-supplied replay body blob (no extra fetch required on the server)
        body: clientBody ?? null,
      },
    });

    if (!triggerResult.success || !triggerResult.ref_id) {
      logger.error("[EvalCapture] Failed to create EvalTrigger", triggerResult.error);
      return NextResponse.json({ error: "Failed to create trigger" }, { status: 502 });
    }
    const triggerRef = triggerResult.ref_id;
    logger.info(`[EvalCapture] EvalTrigger created, ref_id: ${triggerRef}`);

    // ── 4. Wire edges ────────────────────────────────────────────────────────
    // EvalSet -[HAS_REQUIREMENT]-> EvalRequirement
    await addEdge(nodeConfig, {
      edge: { edge_type: "HAS_REQUIREMENT" },
      source: { ref_id: evalSetRef },
      target: { ref_id: requirementRef },
    });
    logger.info("[EvalCapture] HAS_REQUIREMENT edge created");

    // EvalRequirement -[HAS_TRIGGER]-> EvalTrigger
    await addEdge(nodeConfig, {
      edge: { edge_type: "HAS_TRIGGER" },
      source: { ref_id: requirementRef },
      target: { ref_id: triggerRef },
    });
    logger.info("[EvalCapture] HAS_TRIGGER edge created");

    // EvalTrigger -[EVALUATED]-> Run (optional — skip if not found)
    if (run_id) {
      const runNodeRef = await lookupRunNode(jarvisConfig, run_id);
      if (runNodeRef) {
        await addEdge(nodeConfig, {
          edge: { edge_type: "EVALUATED" },
          source: { ref_id: triggerRef },
          target: { ref_id: runNodeRef },
        });
        logger.info(`[EvalCapture] EVALUATED edge created, run ref_id: ${runNodeRef}`);
      } else {
        logger.info("[EvalCapture] No Run node found for EVALUATED edge — skipping");
      }
    }

    return NextResponse.json({
      success: true,
      data: { evalSetRef, requirementRef, triggerRef },
    });
  } catch (error) {
    logger.error("[EvalCapture] Unexpected error", String(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
