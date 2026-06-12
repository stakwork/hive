import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({ success: true, project_id: "mock-eval-run-1" });
}
