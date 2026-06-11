import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { runCanvasJanitorForOrg } from "@/services/canvas-janitor";
import { JanitorStatus } from "@prisma/client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Check for in-progress run
    const inProgress = await db.canvasJanitorRun.findFirst({
      where: {
        config: { orgId },
        status: { in: [JanitorStatus.PENDING, JanitorStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (inProgress) {
      return NextResponse.json(
        { error: "A janitor run is already in progress" },
        { status: 409 },
      );
    }

    // Upsert config
    const config = await db.canvasJanitorConfig.upsert({
      where: { orgId },
      create: { orgId },
      update: {},
    });

    const { cardsCreated } = await runCanvasJanitorForOrg(
      orgId,
      config.id,
      userId,
      "MANUAL",
    );

    // Fetch the run that was just completed
    const latestRun = await db.canvasJanitorRun.findFirst({
      where: { configId: config.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    return NextResponse.json({ runId: latestRun?.id ?? null, cardsCreated });
  } catch (error) {
    console.error("[POST /canvas/janitor/run] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
