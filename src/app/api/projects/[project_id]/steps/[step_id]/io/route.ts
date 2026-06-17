import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ project_id: string; step_id: string }>;
};

const UNAVAILABLE = { success: true, data: { inputs: null, outputs: null, unavailable: true } };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    const { project_id, step_id } = await params;

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

    // IDOR guard: verify the caller has access to the workspace that owns this
    // Stakwork project before proxying any upstream request.
    const projectIdNum = parseInt(project_id, 10);
    if (isNaN(projectIdNum)) {
      return NextResponse.json({ success: false, error: "Invalid project ID" }, { status: 400 });
    }

    const run = await db.stakworkRun.findFirst({
      where: { projectId: projectIdNum },
      select: {
        workspace: {
          select: {
            ownerId: true,
            members: {
              where: { userId, leftAt: null },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const isOwner = run.workspace.ownerId === userId;
    const isMember = run.workspace.members.length > 0;
    if (!isOwner && !isMember) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    // Dev mode: delegate to mock endpoint
    if (isDevelopmentMode()) {
      const origin = request.nextUrl.origin;
      try {
        const mockRes = await fetch(
          `${origin}/api/mock/projects/${project_id}/steps/${step_id}/io`,
        );
        if (mockRes.ok) {
          return NextResponse.json(await mockRes.json());
        }
      } catch {
        // fall through
      }
      return NextResponse.json(UNAVAILABLE);
    }

    // Prod: fetch from Stakwork
    let result: Record<string, unknown>;
    try {
      const upstream = await fetch(
        `${config.STAKWORK_BASE_URL}/api/v1/projects/${project_id}/steps/${step_id}/io`,
        {
          headers: {
            Authorization: `Token token=${config.STAKWORK_API_KEY}`,
          },
        },
      );

      if (!upstream.ok) {
        logger.error("[StepIO] upstream error", "STEP_IO", {
          status: upstream.status,
          project_id,
          step_id,
        });
        return NextResponse.json(UNAVAILABLE);
      }

      result = await upstream.json();
    } catch (err) {
      logger.error("[StepIO] failed to fetch or parse", "STEP_IO", {
        project_id,
        step_id,
        error: String(err),
      });
      return NextResponse.json(UNAVAILABLE);
    }

    const data = result.data as Record<string, unknown> | undefined;
    const inputs = data?.inputs ?? null;
    const outputs = data?.outputs ?? null;

    return NextResponse.json({ success: true, data: { inputs, outputs } });
  } catch (error) {
    logger.error("[StepIO] GET error", "STEP_IO", { error: String(error) });
    return NextResponse.json(UNAVAILABLE);
  }
}
