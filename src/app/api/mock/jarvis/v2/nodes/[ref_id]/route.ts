import { NextRequest, NextResponse } from "next/server";

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
 */
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
