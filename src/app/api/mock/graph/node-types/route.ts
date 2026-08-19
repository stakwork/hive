import { NextResponse } from "next/server";
import { getMockNodeTypes } from "./fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getMockNodeTypes(), { status: 200 });
}
