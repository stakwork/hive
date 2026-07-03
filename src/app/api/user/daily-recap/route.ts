import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";

/**
 * GET /api/user/daily-recap
 *
 * Returns the authenticated user's most recent completed daily-recap result.
 * `userId` is always sourced from the session — never from query params.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await db.stakworkRun.findFirst({
    where: {
      userId: session.user.id,
      type: StakworkRunType.DAILY_RECAP,
      status: WorkflowStatus.COMPLETED,
      result: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { result: true, createdAt: true },
  });

  return NextResponse.json({
    recap: run?.result ?? null,
    generatedAt: run?.createdAt?.toISOString() ?? null,
  });
}
