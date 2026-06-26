import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

// Public endpoint — no session required.
// The opaque callKey (24-char cryptographically random hex) acts as the
// bearer secret; possessing it is sufficient authorisation to fetch the
// corresponding hiveToken. Uses GET (not GETDEL) so Jamie can re-exchange
// on rejoin during the same call session.
export async function GET(request: NextRequest) {
  const callKey = request.nextUrl.searchParams.get("callKey");

  if (!callKey || callKey.trim() === "") {
    return NextResponse.json({ error: "callKey is required" }, { status: 400 });
  }

  const hiveToken = await redis.get("call-token:" + callKey);

  if (!hiveToken) {
    console.warn("[exchange-token] Cache miss or expired for callKey:", callKey);
    return NextResponse.json(
      { error: "Token not found or expired" },
      { status: 401 },
    );
  }

  return NextResponse.json({ hiveToken }, { status: 200 });
}
