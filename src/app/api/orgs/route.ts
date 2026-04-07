import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getUserOrganizations } from "@/services/workspace";

export async function GET(request: NextRequest) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  try {
    const orgs = await getUserOrganizations(userOrResponse.id);
    return NextResponse.json(orgs);
  } catch (error) {
    console.error("[GET /api/orgs] Error:", error);
    return NextResponse.json({ error: "Failed to fetch organizations" }, { status: 500 });
  }
}
