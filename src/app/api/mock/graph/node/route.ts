import { NextRequest, NextResponse } from "next/server";
import { getMockGraphNode } from "./fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const refId = request.nextUrl.searchParams.get("ref_id") ?? "mock_concept_ref_id";
  return NextResponse.json(getMockGraphNode(refId), { status: 200 });
}
