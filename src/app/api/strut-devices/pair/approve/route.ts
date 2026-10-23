import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { decidePairing, findPairing } from "@/lib/strut-devices";
import { pairableOrgs } from "@/services/strut-device-peers";

/**
 * GET /api/strut-devices/pair/approve?code=BCDF-GHJK
 *
 * The pairing the signed-in person is asked about, and the orgs approving it
 * would connect (`/pair`'s page).
 *
 * 200: { pairing: { userCode, deviceName, createdAt, expiresAt, status, decidedByYou }, orgs: [{ githubLogin, name }] }
 * 404: no pairing with that code
 */
export async function GET(request: NextRequest) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const pairing = await findPairing(request.nextUrl.searchParams.get("code") ?? "", userOrResponse.id);
  if (!pairing) return NextResponse.json({ error: "No pairing with that code" }, { status: 404 });
  return NextResponse.json({ pairing, orgs: await pairableOrgs(userOrResponse.id) });
}

/**
 * POST /api/strut-devices/pair/approve
 *
 * Body: { code: string, action: "approve" | "deny" }
 * 200: { status: "approved" | "denied" }
 * 404: no pairing with that code · 410: expired · 409: already approved or denied
 */
export async function POST(request: NextRequest) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const body = (await request.json().catch(() => ({}))) as { code?: unknown; action?: unknown } | null;
  if (typeof body?.code !== "string" || (body.action !== "approve" && body.action !== "deny")) {
    return NextResponse.json({ error: 'Expected { code, action: "approve" | "deny" }' }, { status: 400 });
  }

  const decided = await decidePairing({ code: body.code, userId: userOrResponse.id, approve: body.action === "approve" });
  if (decided.ok) return NextResponse.json({ status: decided.status });
  switch (decided.error) {
    case "not_found":
      return NextResponse.json({ error: "No pairing with that code" }, { status: 404 });
    case "expired":
      return NextResponse.json({ error: "This code has expired; start pairing again on the device" }, { status: 410 });
    case "already_decided":
      return NextResponse.json({ error: "This pairing was already approved or denied" }, { status: 409 });
  }
}
