import { NextRequest, NextResponse } from "next/server";
import { getMockGraphSearch } from "./fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const types = request.nextUrl.searchParams.get("types") ?? "";
  return NextResponse.json(getMockGraphSearch(q, types), { status: 200 });
}
