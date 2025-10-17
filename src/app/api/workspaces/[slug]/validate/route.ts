import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserWorkspaceAccess } from "@/lib/auth/workspace-resolver";

// Prevent caching of user-specific data
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) {
      return NextResponse.json(
        {
          hasAccess: false,
          error: "Unauthorized",
          canRead: false,
          canWrite: false,
          canAdmin: false,
        },
        { status: 401 },
      );
    }

    const { slug } = await params;
    const session = { 
      user: { id: userOrResponse.id, email: userOrResponse.email, name: userOrResponse.name },
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };

    const resolvedSlug = await validateUserWorkspaceAccess(session, slug);

    if (resolvedSlug) {
      return NextResponse.json(
        {
          hasAccess: true,
          workspace: { slug: resolvedSlug },
          canRead: true,
          canWrite: true, // You can enhance this based on role
          canAdmin: false, // You can enhance this based on role
        },
        { status: 200 },
      );
    } else {
      return NextResponse.json(
        {
          hasAccess: false,
          error: "Access denied or workspace not found",
          canRead: false,
          canWrite: false,
          canAdmin: false,
        },
        { status: 403 },
      );
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to validate workspace access";
    return NextResponse.json(
      {
        hasAccess: false,
        error: message,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      },
      { status: 500 },
    );
  }
}
