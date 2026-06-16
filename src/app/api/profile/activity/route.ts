/**
 * GET /api/profile/activity
 *
 * Returns a unified reverse-chronological feed of the authenticated user's
 * recent activity across all orgs and workspaces:
 *   - SharedConversation rows (dashboard / org-canvas / logs-agent)
 *   - ChatMessage rows with featureId → plan chat activity (deduplicated per feature)
 *   - ChatMessage rows with taskId → task chat activity (deduplicated per task)
 *   - Tasks created by the user
 *   - Features created by the user
 *
 * Query params:
 *   days     — integer 1–30, default 30 (clamped to range)
 *   cursor   — ISO timestamp string; exclusive upper bound for pagination
 *   limit    — integer 1–50, default 20
 *   category — "task" | "plan" | "chat" | "milestone"; omit = all
 *   q        — title search (case-insensitive contains); empty/whitespace = no-op
 *
 * Returns { items: ActivityItem[], nextCursor: string | null }.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getUserActivityFeed } from "@/services/roadmap/user-activity";

export type { ActivityItem } from "@/services/roadmap/user-activity";

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(value, MIN_LIMIT), MAX_LIMIT);
}

export async function GET(request: NextRequest) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const userId = userOrResponse.id;

  const params = request.nextUrl.searchParams;

  const daysParam = params.get("days");
  const days = daysParam ? Number.parseInt(daysParam, 10) : undefined;

  const cursorParam = params.get("cursor");
  const cursor = cursorParam ? new Date(cursorParam) : null;

  const limitParam = params.get("limit");
  const limit = clampLimit(limitParam ? Number.parseInt(limitParam, 10) : DEFAULT_LIMIT);

  const categoryParam = params.get("category");
  const category =
    categoryParam === "task" ||
    categoryParam === "plan" ||
    categoryParam === "chat" ||
    categoryParam === "milestone"
      ? categoryParam
      : null;

  const qRaw = params.get("q") ?? "";
  const q = qRaw.trim();

  const items = await getUserActivityFeed({ userId, category, q, limit, days, cursor });

  const nextCursor = items.length === limit ? items[items.length - 1].timestamp : null;

  return NextResponse.json({ items, nextCursor });
}
