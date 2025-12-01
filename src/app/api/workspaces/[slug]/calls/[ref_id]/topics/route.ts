import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Endpoint for call summary topics
 * Proxies to the mock endpoint with workspace validation
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; ref_id: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, ref_id } = await params;

    if (!slug) {
      return NextResponse.json({ error: "Workspace slug is required" }, { status: 400 });
    }

    if (!ref_id) {
      return NextResponse.json({ error: "Call ref_id is required" }, { status: 400 });
    }

    // Verify workspace access
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      include: {
        members: {
          where: {
            userId: userOrResponse.id,
            leftAt: null,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (workspace.ownerId !== userOrResponse.id && workspace.members.length === 0) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Call the mock endpoint with workspaceSlug as a query parameter
    const baseUrl = request.nextUrl.origin;
    const mockUrl = new URL(`/api/mock/calls/${ref_id}/topics`, baseUrl);
    mockUrl.searchParams.set("workspaceSlug", slug);

    const mockResponse = await fetch(mockUrl.toString(), {
      headers: {
        Cookie: request.headers.get("cookie") || "",
      },
    });

    if (!mockResponse.ok) {
      const errorData = await mockResponse.json();
      return NextResponse.json(errorData, { status: mockResponse.status });
    }

    const data = await mockResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching topics:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
