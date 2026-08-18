import { NextRequest, NextResponse } from "next/server";

/**
 * Mock POST /v2/nodes — Jarvis single-node create
 *
 * Supports three scenarios via `_mock_scenario` in the request body:
 *   - "warning"  → 200 { status: "Warning", data: { ref_id } }  (duplicate / already-exists)
 *   - "fail"     → 200 { status: "fail", message }               (Jarvis-level rejection)
 *   - default    → 200 { status: "success", data: { ref_id } }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine
  }

  const scenario = (body._mock_scenario as string | undefined) ?? "success";
  const mockRefId = "mock-node-ref-001";

  if (scenario === "warning") {
    return NextResponse.json(
      {
        status: "Warning",
        message: "Node already exists",
        data: { ref_id: mockRefId },
        status_messages: ["Node already exists"],
      },
      { status: 200 },
    );
  }

  if (scenario === "fail") {
    return NextResponse.json(
      { status: "fail", message: "node_key collision: node_data conflict" },
      { status: 200 },
    );
  }

  // Default: success
  return NextResponse.json(
    {
      status: "success",
      data: { ref_id: mockRefId },
    },
    { status: 200 },
  );
}
