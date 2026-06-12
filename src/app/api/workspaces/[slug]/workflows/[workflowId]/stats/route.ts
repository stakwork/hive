import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ slug: string; workflowId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    const { slug, workflowId } = await params;

    let userId = (session?.user as { id?: string })?.id ?? null;

    if (!userId) {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET! });
      if (token?.id && typeof token.id === "string") {
        userId = token.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // IDOR guard — same pattern as versions endpoint
    const workspace = await db.workspace.findFirst({
      where: { slug, deleted: false },
      include: {
        members: {
          where: { userId, leftAt: null },
          select: { role: true },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;
    if (!isOwner && !isMember) {
      return NextResponse.json(
        { success: false, error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    // Validate workflowId is a valid integer
    const workflowIdNum = parseInt(workflowId, 10);
    if (isNaN(workflowIdNum)) {
      return NextResponse.json({ success: false, error: "Invalid workflow ID" }, { status: 400 });
    }

    // Dev mode: delegate to mock endpoint
    if (isDevelopmentMode()) {
      const origin = request.nextUrl.origin;
      const mockRes = await fetch(
        `${origin}/api/mock/stakwork/workflows/${workflowIdNum}/stats`,
      );
      if (mockRes.ok) {
        const mockData = await mockRes.json();
        return NextResponse.json(mockData);
      }
      return NextResponse.json(
        { success: true, data: { available: false } },
        { status: 200 },
      );
    }

    // Prod: proxy to Stakwork stats API
    try {
      const stakworkRes = await fetch(
        `${config.STAKWORK_BASE_URL}/workflows/${workflowIdNum}/stats`,
        {
          headers: {
            Authorization: `Token token=${config.STAKWORK_API_KEY}`,
          },
        },
      );

      if (!stakworkRes.ok) {
        return NextResponse.json({ success: true, data: { available: false } }, { status: 200 });
      }

      const statsData = await stakworkRes.json();
      return NextResponse.json({
        success: true,
        data: {
          available: true,
          last_run_at: statsData.last_run_at ?? null,
          total_runs: statsData.total_runs ?? 0,
          active_runs: statsData.active_runs ?? 0,
          error_rate: statsData.error_rate ?? 0,
        },
      });
    } catch {
      // Network error or parse failure — return graceful unavailable state
      return NextResponse.json({ success: true, data: { available: false } }, { status: 200 });
    }
  } catch (error) {
    console.error("[Workflow Stats] GET error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch workflow stats" }, { status: 500 });
  }
}
