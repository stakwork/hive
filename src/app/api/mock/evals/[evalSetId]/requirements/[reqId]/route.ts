import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ evalSetId: string; reqId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  if (process.env.USE_MOCKS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { evalSetId, reqId } = await params;
  const body = await request.json().catch(() => ({}));
  return NextResponse.json({ success: true, data: { ref_id: reqId, evalSetId, ...body } });
}

export async function DELETE(_request: NextRequest, _ctx: RouteParams) {
  if (process.env.USE_MOCKS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
