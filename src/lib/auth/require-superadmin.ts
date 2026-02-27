import { NextRequest, NextResponse } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";
import { db } from "@/lib/db";

/**
 * Server-side guard for /api/admin/* routes.
 * Reads user ID from middleware headers, verifies SUPER_ADMIN role from DB.
 * Returns { userId } on success or NextResponse with error on failure.
 */
export async function requireSuperAdmin(
  request: NextRequest
): Promise<{ userId: string } | NextResponse> {
  const userId = request.headers.get(MIDDLEWARE_HEADERS.USER_ID);
  
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { userId };
}
