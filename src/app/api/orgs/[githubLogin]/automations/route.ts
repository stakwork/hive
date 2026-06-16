import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { db } from "@/lib/db";
import type { Automation } from "@prisma/client";
import {
  computeNextRunAt,
  describeSchedule,
  isValidTimeOfDay,
  isValidTimezone,
} from "@/lib/automations/schedule";
import type { AutomationDTO } from "@/types/automation";

async function resolveOrg(githubLogin: string) {
  return db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
}

function toDTO(a: Automation): AutomationDTO {
  return {
    id: a.id,
    name: a.name,
    prompt: a.prompt,
    timeOfDay: a.timeOfDay,
    timezone: a.timezone,
    enabled: a.enabled,
    schedule: describeSchedule(a.timeOfDay, a.timezone),
    nextRunAt: a.nextRunAt?.toISOString() ?? null,
    lastRunAt: a.lastRunAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * GET /api/orgs/[githubLogin]/automations
 * List the calling user's automations for this org.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const org = await resolveOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const automations = await db.automation.findMany({
      where: { sourceControlOrgId: org.id, userId: userOrResponse.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ items: automations.map(toDTO) });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/automations] Error:", error);
    return NextResponse.json({ error: "Failed to list automations" }, { status: 500 });
  }
}

/**
 * POST /api/orgs/[githubLogin]/automations
 * Create a recurring automation.
 * Body: { name, prompt, timeOfDay ("HH:MM"), timezone? (IANA) }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const org = await resolveOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const timeOfDay = typeof body.timeOfDay === "string" ? body.timeOfDay.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (!isValidTimeOfDay(timeOfDay)) {
      return NextResponse.json(
        { error: "timeOfDay must be a 24-hour HH:MM string" },
        { status: 400 },
      );
    }

    // Default to the user's saved timezone, falling back to UTC.
    let timezone =
      typeof body.timezone === "string" && body.timezone.trim()
        ? body.timezone.trim()
        : null;
    if (!timezone) {
      const user = await db.user.findUnique({
        where: { id: userOrResponse.id },
        select: { timezone: true },
      });
      timezone = user?.timezone || "UTC";
    }
    if (!isValidTimezone(timezone)) {
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
    }

    const nextRunAt = computeNextRunAt(timeOfDay, timezone);

    const created = await db.automation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: userOrResponse.id,
        name,
        prompt,
        timeOfDay,
        timezone,
        enabled: true,
        nextRunAt,
      },
    });

    return NextResponse.json(toDTO(created), { status: 201 });
  } catch (error) {
    console.error("[POST /api/orgs/[githubLogin]/automations] Error:", error);
    return NextResponse.json({ error: "Failed to create automation" }, { status: 500 });
  }
}
