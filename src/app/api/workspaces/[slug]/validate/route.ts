import { auth } from "@/lib/auth/auth";
import { NextRequest, NextResponse } from "next/server";
import { validateUserWorkspaceAccess } from "@/lib/auth/workspace-resolver";

// Prevent caching of user-specific data
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user || !(session.user as { id?: string }).id) {
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
