import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ evalSetId: string; reqId: string }> };

/**
 * Mock routes are gated on NODE_ENV === "production" in src/middleware.ts, which
 * leaves them wide open on every preview/staging build — and this PUT reflects
 * arbitrary caller-supplied JSON straight back. Require the same flag the real
 * routes use to delegate here, so a deployed-but-not-mocked environment 404s.
 */
function mocksDisabled() {
  return process.env.USE_MOCKS !== "true";
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  if (mocksDisabled()) return notFound();

  const { evalSetId, reqId } = await params;
  const body = await request.json().catch(() => ({}));
  // The body spread already echoes `contested`, so the editor round-trips
  // against mocks with no field list to keep in sync here.
  return NextResponse.json({ success: true, data: { ref_id: reqId, evalSetId, ...body } });
}

export async function DELETE(_request: NextRequest, _ctx: RouteParams) {
  if (mocksDisabled()) return notFound();

  return NextResponse.json({ success: true });
}
