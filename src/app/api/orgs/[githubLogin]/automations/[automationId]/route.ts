import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { db } from "@/lib/db";
import type { Automation, Prisma } from "@prisma/client";
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

/** Resolve org + load the caller-owned automation, or a NextResponse error. */
async function loadOwned(
  request: NextRequest,
  githubLogin: string,
  automationId: string,
): Promise<{ userId: string; automation: Automation } | NextResponse> {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const org = await resolveOrg(githubLogin);
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // findFirst scoped to org + owner; return 404 (not 403) on any miss so a
  // caller can't probe for automations they don't own.
  const automation = await db.automation.findFirst({
    where: {
      id: automationId,
      sourceControlOrgId: org.id,
      userId: userOrResponse.id,
    },
  });
  if (!automation) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  return { userId: userOrResponse.id, automation };
}

/**
 * PATCH /api/orgs/[githubLogin]/automations/[automationId]
 * Update an automation (name, prompt, timeOfDay, timezone, enabled).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; automationId: string }> },
) {
  const { githubLogin, automationId } = await params;
  const loaded = await loadOwned(request, githubLogin, automationId);
  if (loaded instanceof NextResponse) return loaded;
  const { automation } = loaded;

  try {
    const body = await request.json();
    const data: Prisma.AutomationUpdateInput = {};

    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      }
      data.name = name;
    }
    if (typeof body.prompt === "string") {
      const prompt = body.prompt.trim();
      if (!prompt) {
        return NextResponse.json({ error: "prompt cannot be empty" }, { status: 400 });
      }
      data.prompt = prompt;
    }

    // The effective schedule after this patch — used to recompute nextRunAt.
    let timeOfDay = automation.timeOfDay;
    let timezone = automation.timezone;
    let scheduleChanged = false;

    if (typeof body.timeOfDay === "string") {
      const t = body.timeOfDay.trim();
      if (!isValidTimeOfDay(t)) {
        return NextResponse.json(
          { error: "timeOfDay must be a 24-hour HH:MM string" },
          { status: 400 },
        );
      }
      data.timeOfDay = t;
      timeOfDay = t;
      scheduleChanged = true;
    }
    if (typeof body.timezone === "string") {
      const tz = body.timezone.trim();
      if (!isValidTimezone(tz)) {
        return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
      }
      data.timezone = tz;
      timezone = tz;
      scheduleChanged = true;
    }

    let enabling = false;
    if (typeof body.enabled === "boolean") {
      data.enabled = body.enabled;
      enabling = body.enabled && !automation.enabled;
    }

    // Re-arm nextRunAt when the schedule changed or we're re-enabling a
    // paused automation (so a stale past nextRunAt doesn't fire immediately).
    if (scheduleChanged || enabling) {
      data.nextRunAt = computeNextRunAt(timeOfDay, timezone);
    }

    const updated = await db.automation.update({
      where: { id: automation.id },
      data,
    });

    return NextResponse.json(toDTO(updated));
  } catch (error) {
    console.error("[PATCH /api/orgs/[githubLogin]/automations/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to update automation" }, { status: 500 });
  }
}

/**
 * DELETE /api/orgs/[githubLogin]/automations/[automationId]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; automationId: string }> },
) {
  const { githubLogin, automationId } = await params;
  const loaded = await loadOwned(request, githubLogin, automationId);
  if (loaded instanceof NextResponse) return loaded;

  try {
    await db.automation.delete({ where: { id: loaded.automation.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/orgs/[githubLogin]/automations/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to delete automation" }, { status: 500 });
  }
}
