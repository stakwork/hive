import { NextRequest, NextResponse } from "next/server";
import { MOCK_LIVE_TARGET_NODES } from "@/app/api/mock/jarvis/graph/fix-snapshot-fixtures";
import {
  buildAttemptCapNodes,
  buildConceptOnlyNodes,
  buildPlateauCapNodes,
  buildRecursionNodes,
} from "@/app/api/mock/jarvis/graph/recursion-fixture";

/**
 * Mock routes for /v2/nodes/{ref_id}
 *
 * POST — updateNodeV2 (merge node_data onto existing node)
 * GET  — readNodeByRef (fetch a single node by ref_id)
 *
 * Supports three scenarios via `_mock_scenario` in request body (POST) or
 * query param (GET):
 *   - "warning"  → 200 { status: "Warning", data: { ref_id } }
 *   - "fail"     → 200 { status: "fail", message }
 *   - default    → 200 { status: "success", ... }
 *
 * Known fixture ref_ids resolve to their REAL fixture node (recursion
 * scenarios + the fix-snapshot live-target concepts) so guards that check
 * node_type — e.g. the fix-chain route's EvalSet IDOR check via kgGetNode,
 * or the attempt report page's EvalTriggerOutput check — pass in mock mode,
 * and the fix reader's "open live node" peek shows real content. Unknown
 * ref_ids keep the original generic-Concept fallback.
 */

/** Lazy, memoized ref_id → fixture-node index across all fixture sources. */
let fixtureNodeIndex: Map<string, unknown> | null = null;
function lookupFixtureNode(refId: string): unknown | null {
  if (!fixtureNodeIndex) {
    fixtureNodeIndex = new Map<string, unknown>();
    for (const node of [
      ...buildRecursionNodes(),
      ...buildConceptOnlyNodes(),
      ...buildAttemptCapNodes(),
      ...buildPlateauCapNodes(),
    ]) {
      if (!fixtureNodeIndex.has(node.ref_id)) fixtureNodeIndex.set(node.ref_id, node);
    }
    for (const node of Object.values(MOCK_LIVE_TARGET_NODES)) {
      fixtureNodeIndex.set(node.ref_id, node);
    }
  }
  return fixtureNodeIndex.get(refId) ?? null;
}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ref_id: string }> },
): Promise<NextResponse> {
  const { ref_id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine
  }

  const scenario = (body._mock_scenario as string | undefined) ?? "success";

  if (scenario === "warning") {
    return NextResponse.json(
      {
        status: "Warning",
        message: "Duplicate node_key; merged",
        data: { ref_id },
      },
      { status: 200 },
    );
  }

  if (scenario === "fail") {
    return NextResponse.json(
      { status: "fail", message: "node_key collision: conflicting node_data" },
      { status: 200 },
    );
  }

  // Default: success
  return NextResponse.json(
    { status: "success", data: { ref_id } },
    { status: 200 },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ref_id: string }> },
): Promise<NextResponse> {
  const { ref_id } = await params;
  const scenario = req.nextUrl.searchParams.get("_mock_scenario") ?? "success";

  if (scenario === "not_found") {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  if (scenario === "fail") {
    return NextResponse.json(
      { status: "fail", message: "Lookup failed" },
      { status: 200 },
    );
  }

  // Known fixture ref_ids answer with their real node so node_type-checking
  // guards (EvalSet IDOR, EvalTriggerOutput report gate) pass in mock mode.
  const fixtureNode = lookupFixtureNode(ref_id);
  if (fixtureNode) {
    return NextResponse.json(
      { status: "success", nodes: [fixtureNode], edges: [] },
      { status: 200 },
    );
  }

  // Default: return a mock node in the deployed Jarvis shape
  // ({ nodes, edges, status } wrapper, mirroring stakgraph's graph_get).
  return NextResponse.json(
    {
      status: "success",
      nodes: [
        {
          ref_id,
          node_type: "Concept",
          properties: {
            name: "Mock Node",
            description: "A mock node for testing",
          },
        },
      ],
      edges: [],
    },
    { status: 200 },
  );
}
