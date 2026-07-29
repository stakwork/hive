import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { createJanitorRun } from "@/services/janitor";
import { validateWorkspaceAccess } from "@/services/workspace";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    // Rate limiting: 3 requests per 300 seconds per user per workspace
    const rateLimit = await checkRateLimit(
      `lingo-extract:${slug}:${userId}`,
      3,
      300,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfter ?? 300) },
        },
      );
    }

    // Explicit early fast-fail: validate write access before any service work
    // Note: createJanitorRun re-validates internally — accepted tech debt
    const access = await validateWorkspaceAccess(slug, userId);
    if (!access.hasAccess || !access.canWrite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const run = await createJanitorRun(slug, userId, "LINGO_EXTRACTION", "MANUAL");

    return NextResponse.json({
      success: true,
      runs: [
        {
          id: run.id,
          janitorType: run.janitorType,
          status: run.status,
          triggeredBy: run.triggeredBy,
          createdAt: run.createdAt,
        },
      ],
    });
  } catch (error) {
    logger.error("Error triggering lingo extraction run:", undefined, error);

    if (error instanceof Error) {
      if (error.message.includes("not enabled")) {
        return NextResponse.json(
          {
            error:
              "Lingo extraction is not enabled for this workspace. Contact your admin to enable it.",
          },
          { status: 400 },
        );
      }
      if (error.message.includes("Insufficient permissions")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (error.message.includes("Invalid janitor type")) {
        return NextResponse.json(
          { error: "Invalid janitor type" },
          { status: 400 },
        );
      }
    }

    // Never echo error.message — may contain internal UUIDs or env-var signals
    return NextResponse.json(
      { error: "Extraction could not be started" },
      { status: 500 },
    );
  }
}
