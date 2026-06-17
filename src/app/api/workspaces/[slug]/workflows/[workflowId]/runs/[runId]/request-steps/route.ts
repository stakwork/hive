import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";
import { logger } from "@/lib/logger";
import {
  normalizeTransitions,
  isLlmStep,
  extractStepFromTransition,
} from "@/lib/stakwork/transitions";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ slug: string; workflowId: string; runId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    const { slug, workflowId, runId } = await params;

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

    // IDOR guard — same pattern as the runs route
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

    // Validate workflowId and runId are integers
    const workflowIdNum = parseInt(workflowId, 10);
    if (isNaN(workflowIdNum)) {
      return NextResponse.json({ success: false, error: "Invalid workflow ID" }, { status: 400 });
    }

    const runIdNum = parseInt(runId, 10);
    if (isNaN(runIdNum)) {
      return NextResponse.json({ success: false, error: "Invalid run ID" }, { status: 400 });
    }

    // Dev mode: delegate to mock endpoint
    if (isDevelopmentMode()) {
      const origin = request.nextUrl.origin;
      try {
        const mockRes = await fetch(
          `${origin}/api/mock/stakwork/workflows/${workflowIdNum}/runs/${runIdNum}/request-steps`,
        );
        if (mockRes.ok) {
          return NextResponse.json(await mockRes.json());
        }
      } catch {
        // fall through to empty response
      }
      return NextResponse.json({ success: true, data: { steps: [] } }, { status: 200 });
    }

    // Prod: fetch project JSON from Stakwork
    let projectData: unknown;
    try {
      const projectRes = await fetch(
        `${config.STAKWORK_BASE_URL}/projects/${runIdNum}.json`,
        {
          headers: {
            Authorization: `Token token=${config.STAKWORK_API_KEY}`,
          },
        },
      );

      if (!projectRes.ok) {
        const bodyText = await projectRes.text().catch(() => "(unreadable)");
        logger.error("[RequestSteps] upstream error fetching project JSON", "REQUEST_STEPS", {
          status: projectRes.status,
          workflowId: workflowIdNum,
          runId: runIdNum,
          body: bodyText,
        });
        return NextResponse.json(
          { success: true, data: { steps: [], unavailable: true } },
          { status: 200 },
        );
      }

      projectData = await projectRes.json();
    } catch (err) {
      logger.error("[RequestSteps] failed to fetch or parse project JSON", "REQUEST_STEPS", {
        workflowId: workflowIdNum,
        runId: runIdNum,
        error: String(err),
      });
      return NextResponse.json(
        { success: true, data: { steps: [], unavailable: true } },
        { status: 200 },
      );
    }

    const transitions = normalizeTransitions(projectData);

    if (transitions.length === 0 && typeof projectData === "object" && projectData !== null) {
      logger.warn("[RequestSteps] normalizeTransitions resolved empty — possible wrapper drift", "REQUEST_STEPS", {
        workflowId: workflowIdNum,
        runId: runIdNum,
        topLevelKeys: Object.keys(projectData as Record<string, unknown>),
      });
    }

    const steps = transitions.filter(isLlmStep).map(extractStepFromTransition);

    if (steps.length === 0 && transitions.length > 0) {
      logger.warn("[RequestSteps] non-empty transitions yielded zero LLM steps — possible shape drift", "REQUEST_STEPS", {
        workflowId: workflowIdNum,
        runId: runIdNum,
        transitionCount: transitions.length,
      });
    }

    return NextResponse.json({ success: true, data: { steps } });
  } catch (error) {
    logger.error("[RequestSteps] GET error", "REQUEST_STEPS", { error: String(error) });
    return NextResponse.json(
      { success: true, data: { steps: [], unavailable: true } },
      { status: 200 },
    );
  }
}
