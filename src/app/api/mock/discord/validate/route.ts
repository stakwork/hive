import { NextResponse } from "next/server";

export async function POST() {
  if (process.env.USE_MOCKS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ valid: true, botUsername: "HiveTestBot", clientId: "1234567890" });
}
