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

    // IDOR guard — same pattern as stats endpoint
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
      try {
        const mockRes = await fetch(
          `${origin}/api/mock/stakwork/workflows/${workflowIdNum}/runs`,
        );
        if (mockRes.ok) {
          const mockData = await mockRes.json();
          return NextResponse.json(mockData);
        }
      } catch {
        // fall through to empty response
      }
      return NextResponse.json({ success: true, data: { runs: [] } }, { status: 200 });
    }

    // Prod: proxy to Stakwork runs API
    try {
      const runsRes = await fetch(
        `${config.STAKWORK_BASE_URL}/workflows/${workflowIdNum}/runs`,
        {
          headers: {
            Authorization: `Token token=${config.STAKWORK_API_KEY}`,
          },
        },
      );

      if (!runsRes.ok) {
        const bodyText = await runsRes.text().catch(() => "(unreadable)");
        console.error("[Workflow Runs] upstream error", {
          status: runsRes.status,
          statusText: runsRes.statusText,
          workflowId: workflowIdNum,
          body: bodyText,
          env: process.env.NODE_ENV,
        });
        return NextResponse.json({ success: true, data: { runs: [] } }, { status: 200 });
      }

      const runsData = await runsRes.json();
      const runs = (runsData.data ?? []).map((run: Record<string, unknown>) => ({
        id: run.id,
        name: run.name,
        status: run.workflow_state,
        started_at: run.started_at ?? null,
        finished_at: run.finished_at ?? null,
      }));

      return NextResponse.json({ success: true, data: { runs } });
    } catch (err) {
      console.error("[Workflow Runs] upstream fetch failed", {
        error: err instanceof Error ? err.message : String(err),
        workflowId: workflowIdNum,
        env: process.env.NODE_ENV,
      });
      return NextResponse.json({ success: true, data: { runs: [] } }, { status: 200 });
    }
  } catch (error) {
    console.error("[Workflow Runs] GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch workflow runs" },
      { status: 500 },
    );
  }
}
