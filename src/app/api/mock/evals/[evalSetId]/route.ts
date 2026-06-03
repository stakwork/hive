import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ evalSetId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { evalSetId } = await params;
  const body = await request.json().catch(() => ({}));
  return NextResponse.json({ success: true, data: { ref_id: evalSetId, ...body } });
}

export async function DELETE(_request: NextRequest, _ctx: RouteParams) {
  return NextResponse.json({ success: true });
}
