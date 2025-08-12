import { NextRequest, NextResponse } from "next/server";
import { getQueryParam, runTest } from "./store";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const name = getQueryParam(req, "test");
  if (!name) {
    return NextResponse.json(
      { success: false, error: "Missing 'test' parameter" },
      { status: 400 },
    );
  }
  const result = runTest(name);
  return NextResponse.json(result);
}
