import { authOptions } from "@/lib/auth/nextauth";
import { runWorkspaceGraphQuery } from "@/services/graph/query";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Thin HTTP wrapper over `runWorkspaceGraphQuery` (src/services/graph/query.ts).
 *
 * Keeps only session auth and body parsing; the access/admin gates, query
 * validation, write guard, mock handling, swarm resolution, timeout, and
 * upstream forwarding all live in the shared service so a follow-on agent
 * tool can reuse the same authorization path.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const { slug } = await params;

    if (!session?.user) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Invalid user session" },
        { status: 401 },
      );
    }

    // Parse request body. A malformed body still surfaces as the pre-refactor
    // 500 via the catch below; every well-formed request takes the service
    // path where gate order is unchanged.
    const body = await request.json();
    const { query, limit } = body as { query?: string; limit?: number };

    const result = await runWorkspaceGraphQuery({ slug, userId, query, limit });

    if (!result.ok) {
      const payload: Record<string, unknown> = {
        success: false,
        message: result.message,
      };
      if ("details" in result) {
        payload.details = result.details;
      }
      return NextResponse.json(payload, { status: result.status });
    }

    return NextResponse.json(result.data, { status: 200 });
  } catch {
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
