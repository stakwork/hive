import { NextRequest, NextResponse } from "next/server";

/**
 * Mock POST /v2/edges — Jarvis single-edge create
 *
 * Supports three scenarios via `_mock_scenario` in the request body:
 *   - "warning"  → 200 { status: "Warning", edges: [{ ref_id }] }  (duplicate edge)
 *   - "fail"     → 200 { status: "fail", message }                  (Jarvis-level rejection)
 *   - default    → 200 { status: "success", edges: [{ ref_id }] }
 *
 * Also validates that `create_schema_if_missing` is never `true` in the body —
 * the server-side helper hardcodes it to `false`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine
  }

  // Safety check: create_schema_if_missing must never be true
  if (body.create_schema_if_missing === true) {
    return NextResponse.json(
      { status: "fail", message: "create_schema_if_missing must not be true" },
      { status: 400 },
    );
  }

  const scenario = (body._mock_scenario as string | undefined) ?? "success";
  const mockRefId = "mock-edge-ref-001";

  if (scenario === "warning") {
    return NextResponse.json(
      {
        status: "Warning",
        message: "Edge already exists",
        edges: [{ ref_id: mockRefId }],
        data: { ref_id: mockRefId },
      },
      { status: 200 },
    );
  }

  if (scenario === "fail") {
    return NextResponse.json(
      { status: "fail", message: "Edge type not found in schema" },
      { status: 200 },
    );
  }

  // Default: success
  return NextResponse.json(
    {
      status: "success",
      edges: [{ ref_id: mockRefId }],
      data: { ref_id: mockRefId },
    },
    { status: 200 },
  );
}
