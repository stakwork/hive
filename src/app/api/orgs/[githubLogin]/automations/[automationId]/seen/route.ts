import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { db } from "@/lib/db";

async function resolveOrg(githubLogin: string) {
  return db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
}

/**
 * POST /api/orgs/[githubLogin]/automations/[automationId]/seen
 *
 * Stamps `lastRunSeenAt = now()` on the automation so the inbox no
 * longer counts this run as unseen. Owner-only: scoped by userId from
 * the authenticated session (never from request body/params) so a
 * non-owner's call matches zero rows and returns 404 — IDOR-safe,
 * same pattern as the automation DELETE/PUT handlers' loadOwned helper.
 */
export async function POST(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ githubLogin: string; automationId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, automationId } = await params;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const org = await resolveOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // updateMany so a wrong org/user id matches zero rows rather than
    // throwing — report 404 when nothing was stamped (IDOR-safe: caller
    // cannot distinguish "not found" from "not yours").
    const { count } = await db.automation.updateMany({
      where: {
        id: automationId,
        sourceControlOrgId: org.id,
        userId: userOrResponse.id,
      },
      data: { lastRunSeenAt: new Date() },
    });

    if (count === 0) {
      return NextResponse.json({ error: "Automation not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[POST /api/orgs/[githubLogin]/automations/[automationId]/seen] Error:",
      error,
    );
    return NextResponse.json({ error: "Failed to mark seen" }, { status: 500 });
  }
}
