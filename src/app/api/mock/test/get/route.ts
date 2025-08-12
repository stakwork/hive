import { NextRequest, NextResponse } from "next/server";
import { getQueryParam, getTest } from "../store";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const name = getQueryParam(req, "name");
  if (!name) {
    return NextResponse.json(
      { success: false, error: "Missing 'name' parameter" },
      { status: 400 },
    );
  }
  const t = await getTest(name);
  if (!t) {
    return NextResponse.json(
      { success: false, error: `Test not found: ${name}` },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true, text: t.text });
}
