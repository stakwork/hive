import { NextRequest, NextResponse } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";
import { db } from "@/lib/db";

/**
 * Require superadmin access (UserRole.ADMIN) for API routes.
 * Reads x-middleware-user-id from request headers and verifies the user has ADMIN role.
 * 
 * @param request - The incoming Next.js request
 * @returns { userId: string } on success, NextResponse with 403 on failure
 * 
 * @example
 * ```ts
 * export async function GET(request: NextRequest) {
 *   const auth = await requireSuperAdmin(request);
 *   if (auth instanceof NextResponse) return auth;
 *   
 *   const { userId } = auth;
 *   // ... proceed with superadmin-only logic
 * }
 * ```
 */
export async function requireSuperAdmin(
  request: NextRequest
): Promise<{ userId: string } | NextResponse> {
  const userId = request.headers.get(MIDDLEWARE_HEADERS.USER_ID);

  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (user?.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    return { userId };
  } catch (_error) {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
