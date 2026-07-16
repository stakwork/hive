import { NextRequest, NextResponse } from "next/server";

/**
 * Feature deprecated — the legal_benchmark_recursions table has been dropped.
 * Returns 410 Gone.
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json({ message: "Deprecated" }, { status: 410 });
}
