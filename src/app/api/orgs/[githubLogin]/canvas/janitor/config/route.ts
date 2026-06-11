import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";

export async function GET(
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

    const config = await db.canvasJanitorConfig.upsert({
      where: { orgId },
      create: { orgId },
      update: {},
    });

    return NextResponse.json(config);
  } catch (error) {
    console.error("[GET /canvas/janitor/config] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    // Admin required for PATCH
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json() as Record<string, unknown>;
    const { enabled, scheduleIntervalDays } = body;

    const updateData: Record<string, unknown> = {};

    if (typeof enabled === "boolean") {
      updateData.enabled = enabled;
    }

    if (scheduleIntervalDays !== undefined) {
      const days = Number(scheduleIntervalDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return NextResponse.json(
          { error: "scheduleIntervalDays must be an integer between 1 and 365" },
          { status: 400 },
        );
      }
      updateData.scheduleIntervalDays = days;
    }

    const config = await db.canvasJanitorConfig.upsert({
      where: { orgId },
      create: { orgId, ...updateData },
      update: updateData,
    });

    return NextResponse.json(config);
  } catch (error) {
    console.error("[PATCH /canvas/janitor/config] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
