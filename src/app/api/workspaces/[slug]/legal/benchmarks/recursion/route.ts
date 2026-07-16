import { NextRequest, NextResponse } from "next/server";

/**
 * Feature deprecated — the legal_benchmark_recursions table has been dropped.
 * All endpoints return 410 Gone.
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json({ error: "Feature deprecated" }, { status: 410 });
}

export async function GET(_request: NextRequest) {
  return NextResponse.json({ error: "Feature deprecated" }, { status: 410 });
}
